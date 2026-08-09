import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { normalizeArticleUrl, ArticleUrlNormalizationError } from '@annotated/shared/url-normalization';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
  isActiveTabContextMessage,
  type ActiveTabContext,
} from '../../utils/active-tab-context';
import { ExtensionAuthError } from '../../utils/auth-callback';
import { signInWithGoogle } from '../../utils/extension-auth';
import {
  getCurrentScreen,
  getPostPublishNavigation,
  INITIAL_NAVIGATION,
  reduceNavigation,
  type TopLevelView,
} from '../../utils/navigation';
import {
  extractSelectionFromPage,
  type CaptureState,
  type SelectionExtractionResult,
} from '../../utils/selection-capture';
import { getInitial, isUuid } from '../../utils/social-helpers';
import { getSupabaseClient } from '../../utils/supabase';
import { getWebAppOrigin } from '../../utils/web-app-url';
import {
  AnnotationCollection,
  AnnotationDetailView,
  ProfileView,
  type SessionSocialCache,
} from './social-components';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const RECONNECT_MESSAGE = 'Click the Annotated toolbar icon on this page to reconnect, then try again.';
const RESTRICTED_PAGE_MESSAGE = 'Annotated cannot capture text from this page.';
const UNEXPECTED_CAPTURE_MESSAGE = 'Something went wrong while capturing the passage. Try again.';

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

type AccountDetails = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; account: AccountDetails; profileError: string | null }
  | { status: 'error'; message: string };

type PublishState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'error'; message: string };

const chrome = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;

function isClosedTabError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no tab with id|invalid tab id|tab (?:was|is) closed/i.test(message);
}

function isSameOrigin(firstUrl: string, secondUrl: string) {
  try { return new URL(firstUrl).origin === new URL(secondUrl).origin; } catch { return false; }
}

function isRestrictedPageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot access|cannot be scripted|missing host permission|extensions gallery|no frame with id|frame with id.*(?:removed|not found)|chrome:\/\/|edge:\/\/|about:/i.test(message);
}

function getSourceState(title: string, value: string): SourceState {
  const tabUrl = value.trim();
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { status: 'unsupported', url: tabUrl };
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

function getExtractionErrorMessage(reason: Exclude<SelectionExtractionResult, { ok: true }>['reason']) {
  if (reason === 'NO_SELECTION') return 'Highlight a passage on the page, then try again.';
  if (reason === 'SELECTION_TOO_LONG') return 'Selections can contain up to 2,000 characters. Choose a shorter passage and try again.';
  return RESTRICTED_PAGE_MESSAGE;
}

function getSafeAvatarUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

function getMetadataText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPublishErrorMessage(error: unknown) {
  if (error instanceof ArticleUrlNormalizationError) return 'The captured source URL is invalid. Refresh the source and capture the passage again.';
  const message = error instanceof Error ? error.message : '';
  if (/auth|jwt|session|signed in/i.test(message)) return 'Your session could not be verified. Sign in again, then retry publishing.';
  if (/selected text/i.test(message)) return 'Capture a passage between 1 and 2,000 characters and try again.';
  if (/commentary/i.test(message)) return 'Your commentary must contain between 1 and 2,000 characters.';
  return 'The annotation could not be published. Your passage and commentary are still here—check your connection and try again.';
}

async function verifyProfile(supabase: SupabaseClient, user: User): Promise<AuthState> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  const profileError = error
    ? 'Your Annotated profile could not be verified. Try again.'
    : !profile
      ? import.meta.env.DEV
        ? 'Development error: authentication succeeded, but no profile was created.'
        : 'Your Annotated profile is unavailable.'
      : null;
  const metadataName = getMetadataText(user.user_metadata.full_name) || getMetadataText(user.user_metadata.name);
  const email = user.email ?? 'Email unavailable';
  return {
    status: 'signed-in',
    account: {
      id: user.id,
      name: getMetadataText(profile?.display_name) || metadataName || email,
      email,
      avatarUrl: getSafeAvatarUrl(profile?.avatar_url) ?? getSafeAvatarUrl(user.user_metadata.avatar_url) ?? getSafeAvatarUrl(user.user_metadata.picture),
    },
    profileError,
  };
}

function SourceSummary({ state }: { state: SourceState }) {
  if (state.status === 'loading' || state.status === 'refreshing') return <div className="compact-state" role="status"><strong>{state.status === 'refreshing' ? 'Refreshing source' : 'Reading current page'}</strong><span>Checking the connected tab…</span></div>;
  if (state.status === 'not-connected') return <div className="compact-state"><strong>Connect a website</strong><span>Click the Annotated toolbar icon to connect the current page.</span></div>;
  if (state.status === 'different-tab') return <div className="compact-state"><strong>Connected tab isn’t active</strong><span>Return to it, or use the toolbar icon to connect this tab.</span></div>;
  if (state.status === 'reconnect-required') return <div className="compact-state compact-state-error"><strong>Reconnect to this page</strong><span>{RECONNECT_MESSAGE}</span></div>;
  if (state.status === 'unsupported') return <div className="compact-state"><strong>Unsupported page</strong><span>{RESTRICTED_PAGE_MESSAGE}</span>{state.url && <code>{state.url}</code>}</div>;
  if (state.status === 'unexpected-error') return <div className="compact-state compact-state-error" role="alert"><strong>Couldn’t load this page</strong><span>{state.message}</span></div>;
  return (
    <div className="source-summary">
      <span className="source-type">{state.source.classification}</span>
      <div><span className="section-label">Connected source</span><h2>{state.source.title}</h2><p>{state.source.hostname}</p></div>
    </div>
  );
}

function App() {
  const [supabase] = useState<SupabaseClient | null>(() => {
    try { return getSupabaseClient(); } catch { return null; }
  });
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [sourceState, setSourceState] = useState<SourceState>({ status: 'loading' });
  const [captureState, setCaptureState] = useState<CaptureState>({ status: 'idle' });
  const [commentary, setCommentary] = useState('');
  const [publishState, setPublishState] = useState<PublishState>({ status: 'idle' });
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [navigation, dispatchNavigation] = useReducer(reduceNavigation, INITIAL_NAVIGATION);
  const connectedContextRef = useRef<ActiveTabContext | null>(null);
  const captureRevisionRef = useRef(0);
  const authRevisionRef = useRef(0);
  const authMountedRef = useRef(false);
  const publishInFlightRef = useRef(false);
  const socialCacheRef = useRef<SessionSocialCache>(new Map());

  const currentScreen = getCurrentScreen(navigation);
  const currentUserId = authState.status === 'signed-in' ? authState.account.id : null;

  const applyAuthenticatedUser = useCallback(async (user: User | null) => {
    const revision = ++authRevisionRef.current;
    if (!user) {
      if (authMountedRef.current) setAuthState({ status: 'signed-out' });
      return;
    }
    if (!supabase) {
      if (authMountedRef.current) setAuthState({ status: 'error', message: 'Authentication is temporarily unavailable.' });
      return;
    }
    const next = await verifyProfile(supabase, user);
    if (authMountedRef.current && revision === authRevisionRef.current) setAuthState(next);
  }, [supabase]);

  const beginGoogleSignIn = useCallback(async () => {
    if (!supabase) {
      setAuthState({ status: 'error', message: import.meta.env.DEV ? 'Supabase is not configured. Check apps/extension/.env.local.' : 'Authentication is temporarily unavailable.' });
      return;
    }
    setAuthState({ status: 'signing-in' });
    try {
      await applyAuthenticatedUser(await signInWithGoogle(supabase));
    } catch (error) {
      const message = error instanceof ExtensionAuthError ? error.message : 'Google sign-in could not be completed. Please try again.';
      if (authMountedRef.current) setAuthState({ status: 'error', message });
    }
  }, [applyAuthenticatedUser, supabase]);

  const retryAuthentication = useCallback(async () => {
    if (!supabase) { void beginGoogleSignIn(); return; }
    setAuthState({ status: 'loading' });
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user) await applyAuthenticatedUser(data.session.user);
      else await beginGoogleSignIn();
    } catch {
      if (authMountedRef.current) setAuthState({ status: 'error', message: 'Authentication could not be restored. Please try again.' });
    }
  }, [applyAuthenticatedUser, beginGoogleSignIn, supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setIsSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      socialCacheRef.current.clear();
      if (authMountedRef.current) setAuthState({ status: 'signed-out' });
    } catch {
      if (authMountedRef.current) setAuthState({ status: 'error', message: 'Sign-out did not finish. Please try again.' });
    } finally {
      if (authMountedRef.current) setIsSigningOut(false);
    }
  }, [supabase]);

  const clearCapture = useCallback(() => {
    captureRevisionRef.current += 1;
    setCaptureState({ status: 'idle' });
    setCommentary('');
    setPublishState({ status: 'idle' });
  }, []);

  const enterReconnectRequired = useCallback(() => {
    captureRevisionRef.current += 1;
    setCaptureState((current) => current.status === 'captured' ? current : { status: 'reconnect-required', message: RECONNECT_MESSAGE });
    setSourceState({ status: 'reconnect-required' });
    setRefreshSuccess(false);
  }, []);

  const showStoredContext = useCallback((context: ActiveTabContext | null) => {
    const previous = connectedContextRef.current;
    const sourceChanged = previous !== null && (context === null || previous.tabId !== context.tabId || previous.url !== context.url);
    if (sourceChanged && captureState.status !== 'captured') clearCapture();
    connectedContextRef.current = context;
    setSourceState(context ? getSourceState(context.title, context.url) : { status: 'not-connected' });
    setRefreshSuccess(false);
  }, [captureState.status, clearCapture]);

  const loadSource = useCallback(async () => {
    setRefreshSuccess(false);
    setSourceState({ status: 'refreshing' });
    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];
      if (!isActiveTabContext(context)) {
        if (captureState.status !== 'captured') clearCapture();
        connectedContextRef.current = null;
        setSourceState({ status: 'not-connected' });
        return;
      }
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: context.windowId });
      if (!activeTab) { setSourceState({ status: 'not-connected' }); return; }
      if (activeTab.id !== context.tabId) { setSourceState({ status: 'different-tab' }); return; }
      let freshTab: Browser.tabs.Tab;
      try { freshTab = await chrome.tabs.get(context.tabId); }
      catch (error) {
        if (!isClosedTabError(error)) throw error;
        connectedContextRef.current = null;
        await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        setSourceState({ status: 'not-connected' });
        return;
      }
      if (typeof freshTab.url !== 'string' || typeof freshTab.title !== 'string') { enterReconnectRequired(); return; }
      if (freshTab.url !== context.url && !isSameOrigin(context.url, freshTab.url)) { enterReconnectRequired(); return; }
      if (freshTab.url !== context.url) {
        const refreshedContext = { ...context, title: freshTab.title, url: freshTab.url };
        connectedContextRef.current = refreshedContext;
        await chrome.storage.session.set({ [ACTIVE_TAB_CONTEXT_KEY]: refreshedContext });
        socialCacheRef.current.clear();
      }
      const next = getSourceState(freshTab.title, freshTab.url);
      setSourceState(next);
      if (next.status === 'connected') setRefreshSuccess(true);
    } catch {
      setSourceState({ status: 'unexpected-error', message: 'Unable to refresh the connected source. Try again.' });
    }
  }, [captureState.status, clearCapture, enterReconnectRequired]);

  const captureSelection = useCallback(async () => {
    const revision = ++captureRevisionRef.current;
    setCaptureState({ status: 'capturing' });
    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];
      if (!isActiveTabContext(context)) {
        if (captureRevisionRef.current === revision) { connectedContextRef.current = null; setCaptureState({ status: 'idle' }); setSourceState({ status: 'not-connected' }); }
        return;
      }
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (captureRevisionRef.current !== revision) return;
      if (activeTab?.id !== context.tabId) { enterReconnectRequired(); return; }
      const executionResults = await chrome.scripting.executeScript({ target: { tabId: context.tabId, frameIds: [0] }, func: extractSelectionFromPage });
      if (captureRevisionRef.current !== revision) return;
      const result = executionResults[0]?.result as SelectionExtractionResult | undefined;
      if (!result) throw new Error('The selection extractor returned no result.');
      if (!result.ok) { setCaptureState({ status: 'recoverable-error', message: getExtractionErrorMessage(result.reason) }); return; }
      setCaptureState({ status: 'captured', data: result.data });
      setPublishState({ status: 'idle' });
    } catch (error) {
      if (captureRevisionRef.current !== revision) return;
      if (isClosedTabError(error)) {
        connectedContextRef.current = null;
        setCaptureState({ status: 'idle' });
        setSourceState({ status: 'not-connected' });
        try { await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY); } catch { setCaptureState({ status: 'unexpected-error', message: UNEXPECTED_CAPTURE_MESSAGE }); }
      } else if (isRestrictedPageError(error)) {
        setCaptureState({ status: 'recoverable-error', message: RESTRICTED_PAGE_MESSAGE });
      } else {
        setCaptureState({ status: 'unexpected-error', message: UNEXPECTED_CAPTURE_MESSAGE });
      }
    }
  }, [enterReconnectRequired]);

  const publishAnnotation = useCallback(async () => {
    if (!supabase || publishInFlightRef.current || authState.status !== 'signed-in' || captureState.status !== 'captured' || !commentary.trim() || commentary.length > 2_000) return;
    publishInFlightRef.current = true;
    setPublishState({ status: 'publishing' });
    try {
      const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] = await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
      if (sessionError || !sessionData.session || userError || !userData.user || userData.user.id !== sessionData.session.user.id) throw new Error('The authenticated session is unavailable.');
      const captured = captureState.data;
      const normalizedUrl = normalizeArticleUrl(captured.canonicalUrl || captured.sourceUrl);
      const { data: annotationId, error } = await supabase.rpc('publish_article_annotation', {
        p_normalized_url: normalizedUrl,
        p_canonical_url: captured.canonicalUrl,
        p_page_title: captured.pageTitle,
        p_author: captured.author,
        p_publisher: captured.publisher,
        p_selected_text: captured.selectedText,
        p_text_prefix: captured.textPrefix,
        p_text_suffix: captured.textSuffix,
        p_commentary_text: commentary,
      });
      if (error) throw new Error(error.message);
      if (!isUuid(annotationId)) throw new Error('Publishing returned an invalid annotation identifier.');
      captureRevisionRef.current += 1;
      setCaptureState({ status: 'idle' });
      setCommentary('');
      setPublishState({ status: 'idle' });
      socialCacheRef.current.clear();
      dispatchNavigation({ type: 'select-root', view: 'context' });
      const nextNavigation = getPostPublishNavigation(annotationId);
      dispatchNavigation({ type: 'push', screen: nextNavigation.stack[1] as { kind: 'annotation'; annotationId: string } });
    } catch (error) {
      setPublishState({ status: 'error', message: getPublishErrorMessage(error) });
    } finally {
      publishInFlightRef.current = false;
    }
  }, [authState.status, captureState, commentary, supabase]);

  useEffect(() => {
    authMountedRef.current = true;
    if (!supabase) {
      setAuthState({ status: 'error', message: import.meta.env.DEV ? 'Supabase is not configured. Check apps/extension/.env.local.' : 'Authentication is temporarily unavailable.' });
      return () => { authMountedRef.current = false; };
    }
    const subscription = supabase.auth.onAuthStateChange((_event, session) => window.setTimeout(() => void applyAuthenticatedUser(session?.user ?? null), 0)).data.subscription;
    void supabase.auth.getSession().then(({ data, error }) => { if (error) throw error; return applyAuthenticatedUser(data.session?.user ?? null); }).catch(() => { if (authMountedRef.current) setAuthState({ status: 'error', message: 'Authentication could not be restored. Please try again.' }); });
    return () => { authMountedRef.current = false; authRevisionRef.current += 1; subscription.unsubscribe(); };
  }, [applyAuthenticatedUser, supabase]);

  useEffect(() => {
    let mounted = true;
    const applyContext = (value: unknown) => { if (mounted) showStoredContext(isActiveTabContext(value) ? value : null); };
    const storageChange = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area === 'session' && Object.prototype.hasOwnProperty.call(changes, ACTIVE_TAB_CONTEXT_KEY)) applyContext(changes[ACTIVE_TAB_CONTEXT_KEY]?.newValue);
    };
    const runtimeMessage = (message: unknown) => { if (isActiveTabContextMessage(message)) applyContext(message.context); };
    chrome.storage.onChanged.addListener(storageChange);
    chrome.runtime.onMessage.addListener(runtimeMessage);
    void chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY).then((stored) => applyContext(stored[ACTIVE_TAB_CONTEXT_KEY])).catch(() => { if (mounted) setSourceState({ status: 'unexpected-error', message: 'Unable to load the connected source. Try again.' }); });
    return () => { mounted = false; chrome.storage.onChanged.removeListener(storageChange); chrome.runtime.onMessage.removeListener(runtimeMessage); };
  }, [showStoredContext]);

  useEffect(() => {
    if (!refreshSuccess) return;
    const timer = window.setTimeout(() => setRefreshSuccess(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [refreshSuccess]);

  const selectRoot = (view: TopLevelView) => dispatchNavigation({ type: 'select-root', view });
  const navigationCallbacks = {
    openAnnotation: (annotationId: string) => dispatchNavigation({ type: 'push', screen: { kind: 'annotation', annotationId } }),
    openComments: (annotationId: string) => dispatchNavigation({ type: 'push', screen: { kind: 'comments', annotationId } }),
    openProfile: (profileId: string) => dispatchNavigation({ type: 'push', screen: { kind: 'profile', profileId } }),
  };
  const getPublicUrl = (path: string) => {
    try { return new URL(path, getWebAppOrigin()).href; } catch { return null; }
  };
  const isRefreshing = sourceState.status === 'refreshing';
  const isCapturing = captureState.status === 'capturing';
  const captured = captureState.status === 'captured' ? captureState.data : null;
  const canPublish = authState.status === 'signed-in' && captured && commentary.trim() && commentary.length <= 2_000 && publishState.status !== 'publishing';
  const contextUrl = sourceState.status === 'connected' ? sourceState.source.url : null;
  let contextCacheKey: string | null = null;
  if (contextUrl) {
    try { contextCacheKey = `context:${normalizeArticleUrl(contextUrl)}`; } catch { contextCacheKey = null; }
  }

  return (
    <main className="panel">
      <header className="app-header">
        <div className="app-bar">
          {currentScreen.kind !== 'root' ? <button className="back-button" type="button" onClick={() => dispatchNavigation({ type: 'back' })} aria-label="Go back">←</button> : <span className="wordmark">ANNOTATED</span>}
          <span className="view-title">{currentScreen.kind === 'annotation' || currentScreen.kind === 'comments' ? 'Annotation' : currentScreen.kind === 'profile' ? 'Creator' : currentScreen.view === 'context' ? 'Context' : currentScreen.view === 'feed' ? 'Feed' : 'Account'}</span>
        </div>
        <nav className="top-tabs" aria-label="Primary">
          {(['context', 'feed', 'account'] as const).map((view) => <button key={view} type="button" className={currentScreen.kind === 'root' && currentScreen.view === view ? 'active' : ''} aria-current={currentScreen.kind === 'root' && currentScreen.view === view ? 'page' : undefined} onClick={() => selectRoot(view)}>{view === 'account' ? 'Me' : `${view.slice(0, 1).toUpperCase()}${view.slice(1)}`}</button>)}
        </nav>
      </header>

      {!supabase && currentScreen.kind !== 'root' && <div className="compact-state compact-state-error view-state" role="alert"><strong>Annotated is unavailable</strong><span>Check the extension configuration and try again.</span></div>}

      {supabase && currentScreen.kind === 'annotation' && <AnnotationDetailView key={`annotation:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={() => void beginGoogleSignIn()} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'comments' && <AnnotationDetailView key={`comments:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={() => void beginGoogleSignIn()} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} focusComments onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'profile' && <ProfileView key={`profile:${currentScreen.profileId}`} supabase={supabase} profileId={currentScreen.profileId} currentUserId={currentUserId} onSignIn={() => void beginGoogleSignIn()} navigation={navigationCallbacks} cache={socialCacheRef.current} getPublicUrl={getPublicUrl} />}

      {currentScreen.kind === 'root' && currentScreen.view === 'feed' && (
        <div className="root-view"><header className="view-intro"><span className="section-label">Public activity</span><h1>Recent annotations</h1><p>Published notes from across Annotated.</p></header>{supabase ? <AnnotationCollection supabase={supabase} cache={socialCacheRef.current} cacheKey="feed" navigation={navigationCallbacks} emptyTitle="No published annotations" emptyMessage="The public feed is quiet for now." /> : <div className="compact-state compact-state-error">Feed unavailable</div>}</div>
      )}

      {currentScreen.kind === 'root' && currentScreen.view === 'account' && (
        <div className="root-view"><header className="view-intro"><span className="section-label">Private account</span><h1>Me</h1></header><section className="account-view">
          {authState.status === 'loading' && <div className="compact-state" role="status">Restoring session…</div>}
          {authState.status === 'signed-out' && <div className="signed-out-account"><p>Sign in to publish, comment, and follow creators.</p><button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button></div>}
          {authState.status === 'signing-in' && <button className="button button-primary" type="button" disabled>Signing in…</button>}
          {authState.status === 'error' && <div className="compact-state compact-state-error" role="alert"><strong>Account unavailable</strong><span>{authState.message}</span><button className="button button-secondary" type="button" onClick={() => void retryAuthentication()}>Try again</button></div>}
          {authState.status === 'signed-in' && <><div className="account-identity">{authState.account.avatarUrl ? <img className="account-avatar" src={authState.account.avatarUrl} alt="" width="44" height="44" referrerPolicy="no-referrer" /> : <span className="account-avatar" aria-hidden="true">{getInitial(authState.account.name)}</span>}<div><strong>{authState.account.name}</strong><span>{authState.account.email}</span></div></div>{authState.profileError && <p className="inline-error" role="alert">{authState.profileError}</p>}<button className="button button-secondary" type="button" onClick={() => navigationCallbacks.openProfile(authState.account.id)}>View my profile</button><button className="button button-secondary danger-button" type="button" onClick={() => void signOut()} disabled={isSigningOut}>{isSigningOut ? 'Signing out…' : 'Sign out'}</button></>}
        </section></div>
      )}

      {currentScreen.kind === 'root' && currentScreen.view === 'context' && (
        <div className="root-view context-view">
          <section className="context-source"><SourceSummary state={sourceState} /><div className="source-actions"><button className="button button-secondary button-small" type="button" onClick={() => void loadSource()} disabled={isRefreshing || isCapturing}>{isRefreshing ? 'Refreshing…' : 'Refresh source'}</button>{refreshSuccess && <span role="status">Source updated</span>}</div></section>
          {supabase && contextUrl && contextCacheKey && <AnnotationCollection key={contextCacheKey} supabase={supabase} cache={socialCacheRef.current} cacheKey={contextCacheKey} sourceUrl={contextUrl} navigation={navigationCallbacks} emptyTitle="Be the first to annotate this source" emptyMessage="Capture a passage below to add the first public annotation." compactHeading="On this source" />}
          <section className="create-panel" aria-labelledby="create-heading"><div className="section-heading"><h2 id="create-heading">Create annotation</h2><span>Article text</span></div>
            {captured ? <><blockquote className="captured-passage">{captured.selectedText}</blockquote><dl className="capture-metadata">{captured.author && <div><dt>Author</dt><dd>{captured.author}</dd></div>}{captured.publisher && <div><dt>Publisher</dt><dd>{captured.publisher}</dd></div>}<div><dt>Source</dt><dd>{captured.hostname}</dd></div></dl><div className="annotation-field"><label htmlFor="annotation-commentary">Your commentary</label><textarea id="annotation-commentary" value={commentary} maxLength={2_000} rows={6} onChange={(event) => setCommentary(event.target.value)} /><span aria-live="polite">{commentary.length.toLocaleString()} / 2,000</span></div><div className="create-actions"><button className="button button-secondary" type="button" onClick={clearCapture} disabled={publishState.status === 'publishing'}>Clear capture</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAnnotation()} disabled={!canPublish}>{publishState.status === 'publishing' ? 'Publishing…' : 'Publish annotation'}</button>}</div>{publishState.status === 'error' && <p className="inline-error" role="alert">{publishState.message}</p>}</> : <><p className="create-help">Highlight article text in the connected page, then capture it here. Selections and commentary may contain up to 2,000 characters each.</p><button className="button button-primary" type="button" onClick={() => void captureSelection()} disabled={sourceState.status !== 'connected' || isCapturing}>{isCapturing ? 'Capturing…' : 'Capture selected text'}</button>{(captureState.status === 'recoverable-error' || captureState.status === 'reconnect-required' || captureState.status === 'unexpected-error') && <p className="inline-error" role="alert">{captureState.message}</p>}</>}
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
