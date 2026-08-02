import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArticleUrlNormalizationError,
  normalizeArticleUrl,
} from '@annotated/shared/url-normalization';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
  isActiveTabContextMessage,
  type ActiveTabContext,
} from '../../utils/active-tab-context';
import {
  extractSelectionFromPage,
  type CaptureState,
  type SelectionExtractionResult,
} from '../../utils/selection-capture';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ExtensionAuthError } from '../../utils/auth-callback';
import { signInWithGoogle } from '../../utils/extension-auth';
import { getSupabaseClient } from '../../utils/supabase';
import {
  getWebAppOrigin,
  WebAppUrlConfigurationError,
} from '../../utils/web-app-url';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

const RECONNECT_MESSAGE =
  'Click the Annotated toolbar icon on this page to reconnect, then try again.';
const RESTRICTED_PAGE_MESSAGE = 'Annotated cannot capture text from this page.';
const UNEXPECTED_CAPTURE_MESSAGE =
  'Something went wrong while capturing the passage. Try again.';

type PageSource = {
  title: string;
  hostname: string;
  url: string;
  classification: 'YouTube' | 'Web page';
};

type SourceState =
  | { status: 'loading' }
  | { status: 'connected'; source: PageSource }
  | { status: 'refreshing' }
  | { status: 'not-connected' }
  | { status: 'different-tab' }
  | { status: 'reconnect-required' }
  | { status: 'unsupported'; url?: string }
  | { status: 'unexpected-error'; message: string };

type RefreshFeedback = 'idle' | 'success';

type AccountDetails = {
  name: string;
  email: string;
  avatarUrl: string | null;
};

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | {
      status: 'signed-in';
      account: AccountDetails;
      profileError: string | null;
    }
  | { status: 'error'; message: string };

type PublishState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'error'; message: string }
  | { status: 'success'; publicUrl: string; pageOpened: boolean };

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

function isClosedTabError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    /no tab with id/i.test(message) ||
    /invalid tab id/i.test(message) ||
    /tab (?:was|is) closed/i.test(message)
  );
}

function isSameOrigin(firstUrl: string, secondUrl: string) {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

function isRestrictedPageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /cannot access|cannot be scripted|missing host permission|extensions gallery|no frame with id|frame with id.*(?:removed|not found)|chrome:\/\/|edge:\/\/|about:/i.test(
    message,
  );
}

function getSourceState(title: string, urlValue: string): SourceState {
  const tabUrl = urlValue.trim();

  try {
    const url = new URL(tabUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'unsupported', url: tabUrl };
    }

    return {
      status: 'connected',
      source: {
        title: title.trim() || 'Untitled page',
        hostname: url.hostname,
        url: tabUrl,
        classification: YOUTUBE_HOSTS.has(url.hostname) ? 'YouTube' : 'Web page',
      },
    };
  } catch {
    return { status: 'unsupported', url: tabUrl || undefined };
  }
}

function getCapturedHostname(canonicalUrl: string, sourceHostname: string) {
  try {
    const canonical = new URL(canonicalUrl);

    if (canonical.protocol === 'http:' || canonical.protocol === 'https:') {
      return canonical.hostname || sourceHostname;
    }
  } catch {
    // The extractor already validates canonical URLs; retain a safe fallback.
  }

  return sourceHostname;
}

function getExtractionErrorMessage(
  reason: Exclude<SelectionExtractionResult, { ok: true }>['reason'],
) {
  switch (reason) {
    case 'NO_SELECTION':
      return 'Highlight a passage on the page, then try again.';
    case 'SELECTION_TOO_LONG':
      return 'Selections can contain up to 2,000 characters. Choose a shorter passage and try again.';
    case 'INVALID_PAGE':
      return RESTRICTED_PAGE_MESSAGE;
  }
}

function getMetadataText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getSafeAvatarUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function getAccountInitial(account: AccountDetails) {
  return (account.name.trim() || account.email.trim()).slice(0, 1).toUpperCase() || 'A';
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function getPublishErrorMessage(error: unknown) {
  if (error instanceof ArticleUrlNormalizationError) {
    return 'The captured source URL is not a valid web address. Refresh the source and capture the passage again.';
  }

  if (error instanceof WebAppUrlConfigurationError) {
    return import.meta.env.DEV
      ? 'The public web app is not configured. Set WXT_WEB_APP_URL to an HTTP or HTTPS origin in apps/extension/.env.local.'
      : 'The public annotation page is temporarily unavailable. Try again later.';
  }

  const message = error instanceof Error ? error.message : '';

  if (/auth|jwt|session|signed in/i.test(message)) {
    return 'Your session could not be verified. Sign in again, then retry publishing.';
  }

  if (/selected text/i.test(message)) {
    return 'The captured passage is invalid. Capture a passage between 1 and 2,000 characters and try again.';
  }

  if (/commentary/i.test(message)) {
    return 'Your commentary must contain between 1 and 2,000 characters.';
  }

  return 'The annotation could not be published. Your passage and commentary are still here—check your connection and try again.';
}

async function verifyProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<AuthState> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const profileError = error
    ? 'Your Annotated profile could not be verified. Try again.'
    : !profile
      ? import.meta.env.DEV
        ? 'Development error: authentication succeeded, but the profiles trigger did not create a profile for this user.'
        : 'Your Annotated profile is not available. Please contact support.'
      : null;

  const metadataName =
    getMetadataText(user.user_metadata.full_name) ||
    getMetadataText(user.user_metadata.name);
  const profileName = getMetadataText(profile?.display_name);
  const email = user.email ?? 'Email unavailable';

  return {
    status: 'signed-in',
    account: {
      name: profileName || metadataName || email,
      email,
      avatarUrl:
        getSafeAvatarUrl(profile?.avatar_url) ??
        getSafeAvatarUrl(user.user_metadata.avatar_url) ??
        getSafeAvatarUrl(user.user_metadata.picture),
    },
    profileError,
  };
}

function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [sourceState, setSourceState] = useState<SourceState>({ status: 'loading' });
  const [captureState, setCaptureState] = useState<CaptureState>({ status: 'idle' });
  const [commentary, setCommentary] = useState('');
  const [publishState, setPublishState] = useState<PublishState>({
    status: 'idle',
  });
  const [refreshFeedback, setRefreshFeedback] =
    useState<RefreshFeedback>('idle');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const connectedContextRef = useRef<ActiveTabContext | null>(null);
  const captureRevisionRef = useRef(0);
  const authRevisionRef = useRef(0);
  const authMountedRef = useRef(false);
  const publishInFlightRef = useRef(false);

  const applyAuthenticatedUser = useCallback(async (user: User | null) => {
    const revision = authRevisionRef.current + 1;
    authRevisionRef.current = revision;

    if (!user) {
      if (authMountedRef.current) {
        setAuthState({ status: 'signed-out' });
      }
      return;
    }

    const nextState = await verifyProfile(getSupabaseClient(), user);

    if (authMountedRef.current && authRevisionRef.current === revision) {
      setAuthState(nextState);
    }
  }, []);

  const beginGoogleSignIn = useCallback(async () => {
    setAuthState({ status: 'signing-in' });

    try {
      const user = await signInWithGoogle(getSupabaseClient());
      await applyAuthenticatedUser(user);
    } catch (error) {
      const message =
        error instanceof ExtensionAuthError
          ? error.message
          : import.meta.env.DEV
            ? 'Authentication is not configured correctly. Check apps/extension/.env.local.'
            : 'Google sign-in could not be completed. Please try again.';

      if (authMountedRef.current) {
        setAuthState({ status: 'error', message });
      }
    }
  }, [applyAuthenticatedUser]);

  const retryAuthentication = useCallback(async () => {
    setAuthState({ status: 'loading' });

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      if (data.session?.user) {
        await applyAuthenticatedUser(data.session.user);
      } else {
        await beginGoogleSignIn();
      }
    } catch {
      if (authMountedRef.current) {
        setAuthState({
          status: 'error',
          message: 'Authentication could not be restored. Please try again.',
        });
      }
    }
  }, [applyAuthenticatedUser, beginGoogleSignIn]);

  const signOut = useCallback(async () => {
    setIsSigningOut(true);

    try {
      const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });

      if (error) {
        throw error;
      }

      if (authMountedRef.current) {
        setAuthState({ status: 'signed-out' });
      }
    } catch {
      if (authMountedRef.current) {
        setAuthState({
          status: 'error',
          message: 'Sign-out did not finish. Please try again.',
        });
      }
    } finally {
      if (authMountedRef.current) {
        setIsSigningOut(false);
      }
    }
  }, []);

  const clearCapture = useCallback(() => {
    captureRevisionRef.current += 1;
    setCaptureState({ status: 'idle' });
    setCommentary('');
    setPublishState({ status: 'idle' });
  }, []);

  const enterReconnectRequired = useCallback(() => {
    captureRevisionRef.current += 1;
    setCommentary('');
    setCaptureState({
      status: 'reconnect-required',
      message: RECONNECT_MESSAGE,
    });
    setSourceState({ status: 'reconnect-required' });
    setRefreshFeedback('idle');
    setLastRefreshedAt(null);
  }, []);

  const showStoredContext = useCallback(
    (context: ActiveTabContext | null) => {
      const previousContext = connectedContextRef.current;
      const sourceChanged =
        previousContext !== null &&
        (context === null ||
          previousContext.tabId !== context.tabId ||
          previousContext.url !== context.url);

      if (sourceChanged) {
        clearCapture();
      }

      connectedContextRef.current = context;
      setSourceState(
        context
          ? getSourceState(context.title, context.url)
          : { status: 'not-connected' },
      );
      setRefreshFeedback('idle');
      setLastRefreshedAt(null);
    },
    [clearCapture],
  );

  const loadSource = useCallback(async () => {
    setRefreshFeedback('idle');
    setLastRefreshedAt(null);
    setSourceState({ status: 'refreshing' });

    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];

      if (!isActiveTabContext(context)) {
        clearCapture();
        connectedContextRef.current = null;
        setSourceState({ status: 'not-connected' });
        return;
      }

      const [activeTab] = await chrome.tabs.query({
        active: true,
        windowId: context.windowId,
      });

      if (!activeTab) {
        clearCapture();
        setSourceState({ status: 'not-connected' });
        return;
      }

      if (activeTab.id !== context.tabId) {
        clearCapture();
        setSourceState({ status: 'different-tab' });
        return;
      }

      let freshTab: Browser.tabs.Tab;

      try {
        freshTab = await chrome.tabs.get(context.tabId);
      } catch (error) {
        if (!isClosedTabError(error)) {
          throw error;
        }

        clearCapture();
        connectedContextRef.current = null;
        await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        setSourceState({ status: 'not-connected' });
        return;
      }

      if (typeof freshTab.url !== 'string' || typeof freshTab.title !== 'string') {
        enterReconnectRequired();
        return;
      }

      if (freshTab.url !== context.url && !isSameOrigin(context.url, freshTab.url)) {
        enterReconnectRequired();
        return;
      }

      if (freshTab.url !== context.url) {
        clearCapture();

        const refreshedContext: ActiveTabContext = {
          ...context,
          title: freshTab.title,
          url: freshTab.url,
        };

        connectedContextRef.current = refreshedContext;
        await chrome.storage.session.set({
          [ACTIVE_TAB_CONTEXT_KEY]: refreshedContext,
        });
      }

      const nextSourceState = getSourceState(freshTab.title, freshTab.url);

      if (nextSourceState.status === 'unsupported') {
        clearCapture();
      }

      setSourceState(nextSourceState);

      if (nextSourceState.status === 'connected') {
        setLastRefreshedAt(Date.now());
        setRefreshFeedback('success');
      }
    } catch (error) {
      console.error('Failed to refresh source:', error);
      setSourceState({
        status: 'unexpected-error',
        message: 'Unable to refresh the connected source. Try again.',
      });
    }
  }, [clearCapture, enterReconnectRequired]);

  const captureSelection = useCallback(async () => {
    const captureRevision = captureRevisionRef.current + 1;
    captureRevisionRef.current = captureRevision;
    setCaptureState({ status: 'capturing' });

    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const storedContext = stored[ACTIVE_TAB_CONTEXT_KEY];

      if (!isActiveTabContext(storedContext)) {
        if (captureRevisionRef.current === captureRevision) {
          connectedContextRef.current = null;
          setCommentary('');
          setCaptureState({ status: 'idle' });
          setSourceState({ status: 'not-connected' });
        }
        return;
      }

      const connectedTabId = storedContext.tabId;
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (captureRevisionRef.current !== captureRevision) {
        return;
      }

      if (activeTab?.id !== connectedTabId) {
        enterReconnectRequired();
        return;
      }

      const executionResults = await chrome.scripting.executeScript({
        target: {
          tabId: connectedTabId,
          frameIds: [0],
        },
        func: extractSelectionFromPage,
      });

      if (captureRevisionRef.current !== captureRevision) {
        return;
      }

      const extractionResult = executionResults[0]?.result as
        | SelectionExtractionResult
        | undefined;

      if (!extractionResult) {
        throw new Error('The selection extractor returned no result.');
      }

      if (!extractionResult.ok) {
        setCaptureState({
          status: 'recoverable-error',
          message: getExtractionErrorMessage(extractionResult.reason),
        });
        return;
      }

      setCaptureState({ status: 'captured', data: extractionResult.data });
      setPublishState({ status: 'idle' });
    } catch (error) {
      if (captureRevisionRef.current !== captureRevision) {
        return;
      }

      if (isClosedTabError(error)) {
        captureRevisionRef.current += 1;
        connectedContextRef.current = null;
        setCommentary('');
        setCaptureState({ status: 'idle' });
        setSourceState({ status: 'not-connected' });
        try {
          await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        } catch (storageError) {
          console.error('Failed to clear the closed connected tab:', storageError);
          setCaptureState({
            status: 'unexpected-error',
            message: UNEXPECTED_CAPTURE_MESSAGE,
          });
        }
        return;
      }

      if (isRestrictedPageError(error)) {
        setCaptureState({
          status: 'recoverable-error',
          message: RESTRICTED_PAGE_MESSAGE,
        });
        return;
      }

      console.error('Failed to capture the selected passage:', error);
      setCaptureState({
        status: 'unexpected-error',
        message: UNEXPECTED_CAPTURE_MESSAGE,
      });
    }
  }, [enterReconnectRequired]);

  const publishAnnotation = useCallback(async () => {
    if (
      publishInFlightRef.current ||
      authState.status !== 'signed-in' ||
      captureState.status !== 'captured' ||
      !commentary.trim() ||
      commentary.length > 2_000
    ) {
      return;
    }

    publishInFlightRef.current = true;
    setPublishState({ status: 'publishing' });

    try {
      const supabase = getSupabaseClient();
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session) {
        throw new Error('The authenticated session is unavailable.');
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (
        userError ||
        !userData.user ||
        userData.user.id !== sessionData.session.user.id
      ) {
        throw new Error('The authenticated user could not be verified.');
      }

      const captured = captureState.data;
      const normalizedUrl = normalizeArticleUrl(
        captured.canonicalUrl || captured.sourceUrl,
      );
      const webAppOrigin = getWebAppOrigin();
      const { data: annotationId, error: publishError } = await supabase.rpc(
        'publish_article_annotation',
        {
          p_normalized_url: normalizedUrl,
          p_canonical_url: captured.canonicalUrl,
          p_page_title: captured.pageTitle,
          p_author: captured.author,
          p_publisher: captured.publisher,
          p_selected_text: captured.selectedText,
          p_text_prefix: captured.textPrefix,
          p_text_suffix: captured.textSuffix,
          p_commentary_text: commentary,
        },
      );

      if (publishError) {
        throw new Error(publishError.message);
      }

      if (!isUuid(annotationId)) {
        throw new Error('Publishing returned an invalid annotation identifier.');
      }

      const publicUrl = new URL(`/a/${annotationId}`, webAppOrigin).href;
      let pageOpened = true;

      try {
        await chrome.tabs.create({ url: publicUrl });
      } catch {
        pageOpened = false;
      }

      captureRevisionRef.current += 1;
      setCaptureState({ status: 'idle' });
      setCommentary('');
      setPublishState({ status: 'success', publicUrl, pageOpened });
    } catch (error) {
      setPublishState({
        status: 'error',
        message: getPublishErrorMessage(error),
      });
    } finally {
      publishInFlightRef.current = false;
    }
  }, [authState.status, captureState, commentary]);

  useEffect(() => {
    authMountedRef.current = true;
    let subscription: ReturnType<SupabaseClient['auth']['onAuthStateChange']>['data']['subscription'] | undefined;

    try {
      const supabase = getSupabaseClient();
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
          void applyAuthenticatedUser(session?.user ?? null);
        }, 0);
      }).data.subscription;

      void supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (error) {
            throw error;
          }

          return applyAuthenticatedUser(data.session?.user ?? null);
        })
        .catch(() => {
          if (authMountedRef.current) {
            setAuthState({
              status: 'error',
              message: 'Authentication could not be restored. Please try again.',
            });
          }
        });
    } catch {
      setAuthState({
        status: 'error',
        message: import.meta.env.DEV
          ? 'Supabase is not configured. Check apps/extension/.env.local.'
          : 'Authentication is temporarily unavailable.',
      });
    }

    return () => {
      authMountedRef.current = false;
      authRevisionRef.current += 1;
      subscription?.unsubscribe();
    };
  }, [applyAuthenticatedUser]);

  useEffect(() => {
    let isMounted = true;

    const applyContext = (value: unknown) => {
      if (isMounted) {
        showStoredContext(isActiveTabContext(value) ? value : null);
      }
    };

    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName === 'session' &&
        Object.prototype.hasOwnProperty.call(changes, ACTIVE_TAB_CONTEXT_KEY)
      ) {
        applyContext(changes[ACTIVE_TAB_CONTEXT_KEY]?.newValue);
      }
    };

    const handleRuntimeMessage = (message: unknown) => {
      if (isActiveTabContextMessage(message)) {
        applyContext(message.context);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    void chrome.storage.session
      .get(ACTIVE_TAB_CONTEXT_KEY)
      .then((stored) => {
        applyContext(stored[ACTIVE_TAB_CONTEXT_KEY]);
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        console.error('Failed to read the Annotated action tab:', error);
        setSourceState({
          status: 'unexpected-error',
          message: 'Unable to load the connected source. Try again.',
        });
      });

    return () => {
      isMounted = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [showStoredContext]);

  useEffect(() => {
    if (refreshFeedback !== 'success') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRefreshFeedback('idle');
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [refreshFeedback]);

  const isRefreshing = sourceState.status === 'refreshing';
  const isCapturing = captureState.status === 'capturing';
  const capturedSelection =
    captureState.status === 'captured' ? captureState.data : null;
  const canCapture = sourceState.status === 'connected' && !isCapturing;
  const isPublishing = publishState.status === 'publishing';
  const canPublish =
    authState.status === 'signed-in' &&
    capturedSelection !== null &&
    commentary.trim().length > 0 &&
    commentary.length <= 2_000 &&
    !isPublishing;

  return (
    <main className="panel">
      <header className="brand">
        <p className="eyebrow">ANNOTATED</p>
        <h1>Current source</h1>
        <p className="intro">Review the page connected to this annotation.</p>
      </header>

      <section className="account-card" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>

        {authState.status === 'loading' && (
          <div className="account-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>Restoring session...</span>
          </div>
        )}

        {authState.status === 'signed-out' && (
          <button
            className="button button-primary"
            type="button"
            onClick={beginGoogleSignIn}
          >
            Continue with Google
          </button>
        )}

        {authState.status === 'signing-in' && (
          <button className="button button-primary" type="button" disabled>
            Signing in...
          </button>
        )}

        {authState.status === 'signed-in' && (
          <div className="account-signed-in">
            <div className="account-identity">
              {authState.account.avatarUrl ? (
                <img
                  className="account-avatar"
                  src={authState.account.avatarUrl}
                  alt=""
                  width="40"
                  height="40"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="account-avatar account-avatar-fallback" aria-hidden="true">
                  {getAccountInitial(authState.account)}
                </span>
              )}
              <div>
                <p className="account-name">{authState.account.name}</p>
                <p className="account-email">{authState.account.email}</p>
              </div>
            </div>
            {authState.profileError && (
              <p className="account-profile-error" role="alert">
                {authState.profileError}
              </p>
            )}
            <button
              className="button button-secondary account-sign-out"
              type="button"
              onClick={signOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        )}

        {authState.status === 'error' && (
          <div className="account-error" role="alert">
            <p>{authState.message}</p>
            <button
              className="button button-secondary"
              type="button"
              onClick={retryAuthentication}
            >
              Try again
            </button>
          </div>
        )}
      </section>

      {publishState.status === 'success' && (
        <div className="publish-feedback publish-feedback-success" role="status">
          <p>
            {publishState.pageOpened
              ? 'Annotation published. Opening its public page…'
              : 'Annotation published. Open its public page below.'}
          </p>
          <a href={publishState.publicUrl} target="_blank" rel="noopener noreferrer">
            View published annotation
          </a>
        </div>
      )}

      {capturedSelection ? (
        <section className="capture-card">
          <h2>Captured passage</h2>
          <blockquote>{capturedSelection.selectedText}</blockquote>
          <p className="character-count">
            {capturedSelection.selectedText.length.toLocaleString()} characters
          </p>

          <dl className="capture-metadata">
            {capturedSelection.author && (
              <div>
                <dt>Author</dt>
                <dd>{capturedSelection.author}</dd>
              </div>
            )}
            {capturedSelection.publisher && (
              <div>
                <dt>Publisher</dt>
                <dd>{capturedSelection.publisher}</dd>
              </div>
            )}
            <div>
              <dt>Source</dt>
              <dd>
                {getCapturedHostname(
                  capturedSelection.canonicalUrl,
                  capturedSelection.hostname,
                )}
              </dd>
            </div>
          </dl>

          <div className="annotation-field">
            <label htmlFor="annotation-commentary">Your annotation</label>
            <textarea
              id="annotation-commentary"
              value={commentary}
              maxLength={2_000}
              rows={6}
              onChange={(event) => setCommentary(event.target.value)}
            />
            <p className="character-count" aria-live="polite" aria-atomic="true">
              {commentary.length.toLocaleString()} / 2,000 characters
            </p>
          </div>

          <div className="actions capture-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={clearCapture}
              disabled={isPublishing}
            >
              Clear capture
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={publishAnnotation}
              disabled={!canPublish}
            >
              {isPublishing ? 'Publishing...' : 'Publish annotation'}
            </button>
          </div>

          {publishState.status === 'error' && (
            <p className="publish-feedback publish-feedback-error" role="alert">
              {publishState.message}
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="source-card" aria-busy={isRefreshing}>
            {(sourceState.status === 'loading' ||
              sourceState.status === 'refreshing') && (
              <div className="status">
                <span className="spinner" aria-hidden="true" />
                <p>
                  {sourceState.status === 'refreshing'
                    ? 'Refreshing source...'
                    : 'Reading the current page...'}
                </p>
              </div>
            )}

            {sourceState.status === 'unexpected-error' && (
              <div className="status status-error">
                <p className="status-title">Couldn't load this page</p>
                <p>{sourceState.message}</p>
              </div>
            )}

            {sourceState.status === 'not-connected' && (
              <div className="status status-empty">
                <p className="status-title">Connect a website</p>
                <p>Click the Annotated toolbar icon to connect the current page.</p>
              </div>
            )}

            {sourceState.status === 'different-tab' && (
              <div className="status status-empty">
                <p className="status-title">Connected tab isn't active</p>
                <p>
                  Return to the connected tab, or click the Annotated toolbar icon
                  to connect this one.
                </p>
              </div>
            )}

            {sourceState.status === 'reconnect-required' && (
              <div className="status status-reconnect">
                <p className="status-title">Reconnect to this page</p>
                <p>{RECONNECT_MESSAGE}</p>
                <p className="status-note">
                  You only need to reconnect when changing websites.
                </p>
              </div>
            )}

            {sourceState.status === 'unsupported' && (
              <div className="status status-unsupported">
                <p className="status-title">Unsupported page</p>
                <p>{RESTRICTED_PAGE_MESSAGE}</p>
                {sourceState.url && (
                  <p className="unsupported-url">{sourceState.url}</p>
                )}
              </div>
            )}

            {sourceState.status === 'connected' && (
              <div className="source-details">
                <span className="source-type">
                  {sourceState.source.classification}
                </span>
                <div className="field">
                  <span className="field-label">Title</span>
                  <p className="page-title">{sourceState.source.title}</p>
                </div>
                <div className="field">
                  <span className="field-label">Hostname</span>
                  <p>{sourceState.source.hostname}</p>
                </div>
                <div className="field">
                  <span className="field-label">URL</span>
                  <p className="page-url">{sourceState.source.url}</p>
                </div>
              </div>
            )}
          </section>

          <div className="actions">
            <button
              className="button button-primary"
              type="button"
              onClick={loadSource}
              disabled={isRefreshing || isCapturing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh source'}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={captureSelection}
              disabled={!canCapture}
            >
              {isCapturing ? 'Capturing...' : 'Capture selected text'}
            </button>
          </div>

          <div
            className={`panel-status panel-status-${sourceState.status}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {isCapturing && <p>Capturing selected text...</p>}
            {captureState.status === 'recoverable-error' && (
              <p>{captureState.message}</p>
            )}
            {captureState.status === 'reconnect-required' && (
              <p>{captureState.message}</p>
            )}
            {captureState.status === 'unexpected-error' && (
              <p>{captureState.message}</p>
            )}
            {isRefreshing && <p>Refreshing source...</p>}
            {refreshFeedback === 'success' && <p>Source updated</p>}
            {sourceState.status === 'reconnect-required' &&
              captureState.status !== 'reconnect-required' && (
                <p>{RECONNECT_MESSAGE}</p>
              )}
            {sourceState.status === 'unexpected-error' && (
              <p>{sourceState.message}</p>
            )}
            {lastRefreshedAt !== null && (
              <p className="refresh-time">
                Last refreshed{' '}
                <time dateTime={new Date(lastRefreshedAt).toISOString()}>
                  {new Date(lastRefreshedAt).toLocaleTimeString()}
                </time>
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}

export default App;
