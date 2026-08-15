import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { normalizeArticleUrl, ArticleUrlNormalizationError } from '@annotated/shared/url-normalization';
import {
  formatMediaTime,
  getNewMediaPublicationRangeError,
} from '@annotated/shared/media-time';
import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import {
  AUDIO_CLIP_DRAFT_STORAGE_KEY,
  audioClipDraftBelongsToSource,
  deserializeAudioClipDraft,
  serializeAudioClipDraft,
  type AudioClipDraft,
} from '../../utils/audio-draft';
import {
  classifyConnectedSource,
  playAudioPageFrom,
  readAudioPageSnapshot,
  validateAudioPageSnapshot,
  type AudioPageSource,
} from '../../utils/audio-page';
import { publishAudioClipAnnotation } from '../../utils/audio-publishing';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
  isActiveTabContextMessage,
  type ActiveTabContext,
} from '../../utils/active-tab-context';
import { ExtensionAuthError } from '../../utils/auth-callback';
import {
  ANNOTATION_DRAFT_STORAGE_KEY,
  annotationDraftBelongsToContext,
  deserializeAnnotationDraft,
  serializeAnnotationDraft,
  shouldApplyDraftRestoration,
  shouldClearAnnotationDraft,
  updateAnnotationDraftCommentary,
  type AnnotationDraft,
  type AnnotationDraftLifecycleEvent,
} from '../../utils/annotation-draft';
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
import { publishArticleAnnotation } from '../../utils/annotation-publishing';
import {
  YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
  deserializeYouTubeClipDraft,
  serializeYouTubeClipDraft,
  youtubeClipDraftBelongsToSource,
  type YouTubeClipDraft,
} from '../../utils/youtube-draft';
import {
  extractYouTubePageMetadata,
  playYouTubeVideoFrom,
  readYouTubePlayerState,
  validateYouTubePageMetadata,
  validateYouTubePlayerState,
} from '../../utils/youtube-page';
import { publishYouTubeAnnotation } from '../../utils/youtube-publishing';
import type { PublicAnnotation } from '../../utils/social-data';
import {
  AnnotationCollection,
  AnnotationDetailView,
  ProfileView,
  type SessionSocialCache,
} from './social-components';
import { AudioRecorder, useAudioRecorder } from './audio-recorder';

const RECONNECT_MESSAGE = 'Click the Annotated toolbar icon on this page to reconnect, then try again.';
const RESTRICTED_PAGE_MESSAGE = 'Annotated cannot capture text from this page.';
const UNEXPECTED_CAPTURE_MESSAGE = 'Something went wrong while capturing the passage. Try again.';

type ArticlePageSource = {
  title: string;
  hostname: string;
  url: string;
  classification: 'Web page';
  audioDetectionResolved: boolean;
};

type YouTubePageSource = {
  title: string;
  hostname: 'youtube.com';
  url: string;
  classification: 'YouTube';
  videoId: string;
  normalizedUrl: string;
  canonicalUrl: string;
  channelName: string | null;
  metadataResolved: boolean;
};

type AudioUnavailablePageSource = {
  title: string;
  hostname: string;
  url: string;
  classification: 'Audio unavailable';
  reason: 'no-audio';
};

type PageSource = ArticlePageSource | YouTubePageSource | AudioPageSource | AudioUnavailablePageSource;

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
    try {
      if (classifyConnectedSource(tabUrl, 'not-audio-page') !== 'youtube') throw new Error('Not YouTube');
      const identity = getYouTubeVideoIdentity(tabUrl);
      return {
        status: 'connected',
        source: {
          title: title.trim().replace(/\s+-\s+YouTube$/, '') || 'Untitled YouTube video',
          hostname: 'youtube.com',
          url: tabUrl,
          classification: 'YouTube',
          ...identity,
          channelName: null,
          metadataResolved: false,
        },
      };
    } catch {
      // Non-video HTTP(S) pages continue through the unchanged article path.
    }
    return {
      status: 'connected',
      source: {
        title: title.trim() || 'Untitled page',
        hostname: url.hostname,
        url: tabUrl,
        classification: 'Web page',
        audioDetectionResolved: false,
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
      <div><span className="section-label">Connected source</span><h2>{state.source.title}</h2>{state.source.classification === 'YouTube' && state.source.channelName && <p>{state.source.channelName}</p>}{state.source.classification === 'Podcast / web audio' && (state.source.showName || state.source.publisher) && <p>{state.source.showName ?? state.source.publisher}</p>}{state.source.classification === 'Audio unavailable' && <p>This audio page does not expose a usable top-level HTML media player.</p>}<p>{state.source.hostname}</p></div>
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
  const [draftRestorationStatus, setDraftRestorationStatus] = useState<'loading' | 'ready'>('loading');
  const [publishState, setPublishState] = useState<PublishState>({ status: 'idle' });
  const [youtubePublishState, setYoutubePublishState] = useState<PublishState>({ status: 'idle' });
  const [audioPublishState, setAudioPublishState] = useState<PublishState>({ status: 'idle' });
  const [clipStartMs, setClipStartMs] = useState<number | null>(null);
  const [clipEndMs, setClipEndMs] = useState<number | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [playerTimeMs, setPlayerTimeMs] = useState<number | null>(null);
  const [youtubeCommentary, setYoutubeCommentary] = useState('');
  const [audioCommentary, setAudioCommentary] = useState('');
  const [playerReadState, setPlayerReadState] = useState<'idle' | 'reading' | 'error'>('idle');
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [navigation, dispatchNavigation] = useReducer(reduceNavigation, INITIAL_NAVIGATION);
  const connectedContextRef = useRef<ActiveTabContext | null>(null);
  const contextObservedRef = useRef(false);
  const captureRevisionRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const draftRef = useRef<AnnotationDraft | null>(null);
  const youtubeDraftRef = useRef<YouTubeClipDraft | null>(null);
  const audioDraftRef = useRef<AudioClipDraft | null>(null);
  const authRevisionRef = useRef(0);
  const authMountedRef = useRef(false);
  const publishInFlightRef = useRef(false);
  const socialCacheRef = useRef<SessionSocialCache>(new Map());
  const audioRecorder = useAudioRecorder();

  const currentScreen = getCurrentScreen(navigation);
  const currentUserId = authState.status === 'signed-in' ? authState.account.id : null;

  const persistYoutubeDraft = useCallback((
    sourceUrl: string,
    startMs: number | null,
    endMs: number | null,
    text: string,
  ) => {
    try {
      const draft = serializeYouTubeClipDraft(sourceUrl, startMs, endMs, text);
      youtubeDraftRef.current = draft;
      void chrome.storage.session
        .set({ [YOUTUBE_CLIP_DRAFT_STORAGE_KEY]: draft })
        .catch(() => console.warn('Unable to save the YouTube clip draft.'));
    } catch {
      // Invalid transient input is never persisted.
    }
  }, []);

  const clearYoutubeDraft = useCallback(async () => {
    youtubeDraftRef.current = null;
    setClipStartMs(null);
    setClipEndMs(null);
    setVideoDurationMs(null);
    setPlayerTimeMs(null);
    setYoutubeCommentary('');
    setYoutubePublishState({ status: 'idle' });
    setPlayerReadState('idle');
    try {
      await chrome.storage.session.remove(YOUTUBE_CLIP_DRAFT_STORAGE_KEY);
    } catch {
      console.warn('Unable to clear the YouTube clip draft.');
    }
  }, []);

  const persistAudioDraft = useCallback((
    source: AudioPageSource,
    startMs: number | null,
    endMs: number | null,
    text: string,
  ) => {
    try {
      const draft = serializeAudioClipDraft(
        source.url,
        source.canonicalUrl,
        startMs,
        endMs,
        text,
      );
      audioDraftRef.current = draft;
      void chrome.storage.session
        .set({ [AUDIO_CLIP_DRAFT_STORAGE_KEY]: draft })
        .catch(() => console.warn('Unable to save the audio clip draft.'));
    } catch { /* Invalid transient input is never persisted. */ }
  }, []);

  const clearAudioDraft = useCallback(async () => {
    audioDraftRef.current = null;
    setClipStartMs(null);
    setClipEndMs(null);
    setVideoDurationMs(null);
    setPlayerTimeMs(null);
    setAudioCommentary('');
    setAudioPublishState({ status: 'idle' });
    setPlayerReadState('idle');
    try {
      await chrome.storage.session.remove(AUDIO_CLIP_DRAFT_STORAGE_KEY);
    } catch { console.warn('Unable to clear the audio clip draft.'); }
  }, []);

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

  const persistDraft = useCallback((draft: AnnotationDraft) => {
    draftRef.current = draft;
    void chrome.storage.session
      .set({ [ANNOTATION_DRAFT_STORAGE_KEY]: draft })
      .catch(() => console.warn('Unable to save the annotation draft.'));
  }, []);

  const removePersistedDraft = useCallback(async () => {
    try {
      await chrome.storage.session.remove(ANNOTATION_DRAFT_STORAGE_KEY);
    } catch {
      console.warn('Unable to clear the annotation draft.');
    }
  }, []);

  const clearDraft = useCallback(async (event: AnnotationDraftLifecycleEvent) => {
    if (!shouldClearAnnotationDraft(event)) return;
    draftRevisionRef.current += 1;
    draftRef.current = null;
    captureRevisionRef.current += 1;
    audioRecorder.discard();
    setCaptureState({ status: 'idle' });
    setCommentary('');
    setPublishState({ status: 'idle' });
    await removePersistedDraft();
  }, [audioRecorder.discard, removePersistedDraft]);

  const clearCapture = useCallback(() => {
    void clearDraft('explicit-clear');
  }, [clearDraft]);

  const enterReconnectRequired = useCallback(() => {
    void clearDraft('source-invalidated');
    void clearYoutubeDraft();
    void clearAudioDraft();
    setCaptureState({ status: 'reconnect-required', message: RECONNECT_MESSAGE });
    setSourceState({ status: 'reconnect-required' });
    setRefreshSuccess(false);
  }, [clearAudioDraft, clearDraft, clearYoutubeDraft]);

  const showStoredContext = useCallback((context: ActiveTabContext | null) => {
    contextObservedRef.current = true;
    const draft = draftRef.current;
    if (draft && (!context || !annotationDraftBelongsToContext(draft, context))) {
      void clearDraft('source-invalidated');
    }
    const youtubeDraft = youtubeDraftRef.current;
    if (youtubeDraft && (!context || !youtubeClipDraftBelongsToSource(youtubeDraft, context.url))) {
      void clearYoutubeDraft();
    }
    if (
      audioDraftRef.current &&
      (!context || classifyConnectedSource(context.url, 'not-audio-page') === 'youtube')
    ) {
      void clearAudioDraft();
    }
    connectedContextRef.current = context;
    setSourceState(context ? getSourceState(context.title, context.url) : { status: 'not-connected' });
    setRefreshSuccess(false);
  }, [clearAudioDraft, clearDraft, clearYoutubeDraft]);

  const loadSource = useCallback(async () => {
    setRefreshSuccess(false);
    setSourceState({ status: 'refreshing' });
    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];
      if (!isActiveTabContext(context)) {
        await clearDraft('source-invalidated');
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
        await clearDraft('source-invalidated');
        setSourceState({ status: 'not-connected' });
        return;
      }
      if (typeof freshTab.url !== 'string' || typeof freshTab.title !== 'string') { enterReconnectRequired(); return; }
      if (freshTab.url !== context.url && !isSameOrigin(context.url, freshTab.url)) { enterReconnectRequired(); return; }
      if (freshTab.url !== context.url) {
        const refreshedContext = { ...context, title: freshTab.title, url: freshTab.url };
        if (draftRef.current && !annotationDraftBelongsToContext(draftRef.current, refreshedContext)) {
          await clearDraft('source-invalidated');
        }
        if (youtubeDraftRef.current && !youtubeClipDraftBelongsToSource(youtubeDraftRef.current, refreshedContext.url)) {
          await clearYoutubeDraft();
        }
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
  }, [clearDraft, clearYoutubeDraft, enterReconnectRequired]);

  const captureSelection = useCallback(async () => {
    const revision = ++captureRevisionRef.current;
    draftRevisionRef.current += 1;
    setCaptureState({ status: 'capturing' });
    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];
      if (!isActiveTabContext(context)) {
        if (captureRevisionRef.current === revision) {
          await clearDraft('source-invalidated');
          connectedContextRef.current = null;
          setSourceState({ status: 'not-connected' });
        }
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
      let draft: AnnotationDraft;
      try {
        draft = serializeAnnotationDraft(context, result.data, '');
      } catch {
        enterReconnectRequired();
        return;
      }
      audioRecorder.discard();
      setCaptureState({ status: 'captured', data: result.data });
      setCommentary('');
      setPublishState({ status: 'idle' });
      persistDraft(draft);
    } catch (error) {
      if (captureRevisionRef.current !== revision) return;
      if (isClosedTabError(error)) {
        connectedContextRef.current = null;
        setCaptureState({ status: 'idle' });
        setSourceState({ status: 'not-connected' });
        await clearDraft('source-invalidated');
        try { await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY); } catch { setCaptureState({ status: 'unexpected-error', message: UNEXPECTED_CAPTURE_MESSAGE }); }
      } else if (isRestrictedPageError(error)) {
        setCaptureState({ status: 'recoverable-error', message: RESTRICTED_PAGE_MESSAGE });
      } else {
        setCaptureState({ status: 'unexpected-error', message: UNEXPECTED_CAPTURE_MESSAGE });
      }
    }
  }, [audioRecorder.discard, clearDraft, enterReconnectRequired, persistDraft]);

  const publishAnnotation = useCallback(async () => {
    if (!supabase || publishInFlightRef.current || authState.status !== 'signed-in' || captureState.status !== 'captured' || !commentary.trim() || commentary.length > 2_000) return;
    publishInFlightRef.current = true;
    setPublishState({ status: 'publishing' });
    try {
      const captured = captureState.data;
      const normalizedUrl = normalizeArticleUrl(captured.canonicalUrl || captured.sourceUrl);
      const recordedAudio = audioRecorder.state.status === 'recorded'
        ? {
            blob: audioRecorder.state.blob,
            durationMs: audioRecorder.state.durationMs,
          }
        : undefined;
      const annotationId = await publishArticleAnnotation(
        supabase,
        {
          normalizedUrl,
          canonicalUrl: captured.canonicalUrl,
          pageTitle: captured.pageTitle,
          author: captured.author,
          publisher: captured.publisher,
          selectedText: captured.selectedText,
          textPrefix: captured.textPrefix,
          textSuffix: captured.textSuffix,
          commentaryText: commentary,
        },
        recordedAudio,
        (diagnostic) => {
          if (import.meta.env.DEV) {
            console.warn('Audio upload cleanup failed after publication error.', diagnostic);
          }
        },
      );
      if (!isUuid(annotationId)) throw new Error('Publishing returned an invalid annotation identifier.');
      await clearDraft('publish-succeeded');
      socialCacheRef.current.clear();
      dispatchNavigation({ type: 'select-root', view: 'context' });
      const nextNavigation = getPostPublishNavigation(annotationId);
      dispatchNavigation({ type: 'push', screen: nextNavigation.stack[1] as { kind: 'annotation'; annotationId: string } });
    } catch (error) {
      setPublishState({ status: 'error', message: getPublishErrorMessage(error) });
    } finally {
      publishInFlightRef.current = false;
    }
  }, [audioRecorder, authState.status, captureState, clearDraft, commentary, supabase]);

  const readConnectedPlayer = useCallback(async (action: 'start' | 'end' | 'refresh') => {
    if (
      sourceState.status !== 'connected' ||
      (sourceState.source.classification !== 'YouTube' &&
        sourceState.source.classification !== 'Podcast / web audio')
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    setPlayerReadState('reading');
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
      if (sourceState.source.classification === 'YouTube') {
        const execution = await chrome.scripting.executeScript({
            target: { tabId: context.tabId, frameIds: [0] },
            func: readYouTubePlayerState,
          });
        const player = validateYouTubePlayerState(execution[0]?.result);
        if (!player) throw new Error('The connected player is unavailable.');
        const currentMs = Math.round(player.currentTime * 1_000);
        const durationMs = player.duration === null ? null : Math.floor(player.duration * 1_000);
        setPlayerTimeMs(currentMs);
        setVideoDurationMs(durationMs);
        if (action === 'start') {
          setClipStartMs(currentMs);
          persistYoutubeDraft(sourceState.source.url, currentMs, clipEndMs, youtubeCommentary);
        } else if (action === 'end') {
          setClipEndMs(currentMs);
          persistYoutubeDraft(sourceState.source.url, clipStartMs, currentMs, youtubeCommentary);
        }
        setPlayerReadState('idle');
        return;
      }

      const connectedAudioSource = sourceState.source;
      const execution = await chrome.scripting.executeScript({
            target: { tabId: context.tabId, frameIds: [0] },
            func: readAudioPageSnapshot,
            args: [false],
          });
      const detection = validateAudioPageSnapshot(connectedAudioSource.url, execution[0]?.result);
      if (detection.status !== 'supported') {
        setSourceState((state) => state.status === 'connected' &&
          state.source.classification === 'Podcast / web audio' &&
          state.source.normalizedUrl === connectedAudioSource.normalizedUrl
          ? { status: 'connected', source: { ...state.source, playerId: null, playerStatus: 'unavailable' } }
          : state);
        setPlayerTimeMs(null);
        setVideoDurationMs(null);
        setPlayerReadState('idle');
        return;
      }
      setSourceState((state) => state.status === 'connected' &&
        state.source.classification === 'Podcast / web audio' &&
        state.source.normalizedUrl === connectedAudioSource.normalizedUrl
        ? {
            status: 'connected',
            source: {
              ...state.source,
              playerId: detection.source.playerId,
              playerStatus: detection.source.playerStatus,
            },
          }
        : state);
      if (detection.selection.status !== 'supported' || detection.readiness === null) {
        setPlayerTimeMs(null);
        setVideoDurationMs(null);
        setPlayerReadState('idle');
        return;
      }
      if (detection.readiness.currentTime === null) {
        setPlayerTimeMs(null);
        setVideoDurationMs(null);
        setPlayerReadState('idle');
        return;
      }
      const currentMs = Math.round(detection.readiness.currentTime * 1_000);
      const durationMs = detection.readiness.duration === null
        ? null
        : Math.floor(detection.readiness.duration * 1_000);
      setPlayerTimeMs(currentMs);
      setVideoDurationMs(durationMs);
      if (action === 'start') {
        setClipStartMs(currentMs);
        persistAudioDraft(connectedAudioSource, currentMs, clipEndMs, audioCommentary);
      } else if (action === 'end') {
        setClipEndMs(currentMs);
        persistAudioDraft(connectedAudioSource, clipStartMs, currentMs, audioCommentary);
      }
      setPlayerReadState('idle');
    } catch {
      setPlayerReadState('error');
    }
  }, [audioCommentary, clipEndMs, clipStartMs, persistAudioDraft, persistYoutubeDraft, sourceState, youtubeCommentary]);

  const changeYoutubeCommentary = (value: string) => {
    setYoutubeCommentary(value);
    if (sourceState.status === 'connected' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, clipStartMs, clipEndMs, value);
    }
  };

  const changeAudioCommentary = (value: string) => {
    setAudioCommentary(value);
    if (sourceState.status === 'connected' && sourceState.source.classification === 'Podcast / web audio') {
      persistAudioDraft(sourceState.source, clipStartMs, clipEndMs, value);
    }
  };

  const publishYoutubeClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' || sourceState.source.classification !== 'YouTube' ||
      clipStartMs === null || clipEndMs === null || !youtubeCommentary.trim()
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      clipStartMs,
      clipEndMs,
      videoDurationMs,
    );
    if (rangeError || youtubeCommentary.length > 2_000) {
      setYoutubePublishState({ status: 'error', message: rangeError ?? 'Commentary cannot exceed 2,000 characters.' });
      return;
    }
    publishInFlightRef.current = true;
    setYoutubePublishState({ status: 'publishing' });
    try {
      const annotationId = await publishYouTubeAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        title: sourceState.source.title,
        channelName: sourceState.source.channelName,
        startMs: clipStartMs,
        endMs: clipEndMs,
        commentaryText: youtubeCommentary,
        videoDurationMs,
      });
      await clearYoutubeDraft();
      socialCacheRef.current.clear();
      dispatchNavigation({ type: 'select-root', view: 'context' });
      dispatchNavigation({ type: 'push', screen: { kind: 'annotation', annotationId } });
    } catch (error) {
      setYoutubePublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The YouTube clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
    }
  }, [authState.status, clearYoutubeDraft, clipEndMs, clipStartMs, sourceState, supabase, videoDurationMs, youtubeCommentary]);

  const publishAudioClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio' ||
      clipStartMs === null || clipEndMs === null || !audioCommentary.trim() ||
      videoDurationMs === null
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      clipStartMs,
      clipEndMs,
      videoDurationMs,
    );
    if (rangeError || audioCommentary.length > 2_000) {
      setAudioPublishState({ status: 'error', message: rangeError ?? 'Commentary cannot exceed 2,000 characters.' });
      return;
    }
    publishInFlightRef.current = true;
    setAudioPublishState({ status: 'publishing' });
    try {
      const annotationId = await publishAudioClipAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        canonicalUrl: sourceState.source.canonicalUrl,
        title: sourceState.source.title,
        author: sourceState.source.author,
        publisher: sourceState.source.publisher,
        showName: sourceState.source.showName,
        startMs: clipStartMs,
        endMs: clipEndMs,
        commentaryText: audioCommentary,
        mediaDurationMs: videoDurationMs,
      });
      await clearAudioDraft();
      socialCacheRef.current.clear();
      dispatchNavigation({ type: 'select-root', view: 'context' });
      dispatchNavigation({ type: 'push', screen: { kind: 'annotation', annotationId } });
    } catch (error) {
      setAudioPublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The audio clip could not be published.',
      });
    } finally { publishInFlightRef.current = false; }
  }, [audioCommentary, authState.status, clearAudioDraft, clipEndMs, clipStartMs, sourceState, supabase, videoDurationMs]);

  const playConnectedClip = useCallback(async (
    annotation: Extract<PublicAnnotation, { kind: 'youtube' }>,
  ) => {
    if (
      sourceState.status !== 'connected' || sourceState.source.classification !== 'YouTube' ||
      sourceState.source.videoId !== annotation.source.videoId
    ) throw new Error('The connected video does not match this clip.');
    const context = connectedContextRef.current;
    if (!context) throw new Error(RECONNECT_MESSAGE);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
    const execution = await chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      func: playYouTubeVideoFrom,
      args: [annotation.startMs / 1_000],
    });
    if (execution[0]?.result !== true) throw new Error('The YouTube player is unavailable.');
  }, [sourceState]);

  const playConnectedAudioClip = useCallback(async (
    annotation: Extract<PublicAnnotation, { kind: 'audio' }>,
  ) => {
    if (
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio' ||
      sourceState.source.normalizedUrl !== annotation.source.normalizedUrl
    ) throw new Error('The connected audio source does not match this clip.');
    const context = connectedContextRef.current;
    if (!context) throw new Error(RECONNECT_MESSAGE);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
    const execution = await chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      func: playAudioPageFrom,
      args: [annotation.startMs / 1_000, annotation.source.normalizedUrl],
    });
    const result = execution[0]?.result as { ok?: boolean } | undefined;
    if (result?.ok !== true) throw new Error('The connected page audio could not be controlled.');
  }, [sourceState]);

  const previewYoutubeDraft = useCallback(async () => {
    if (
      clipStartMs === null || sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'YouTube'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    setPlayerReadState('reading');
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
      const execution = await chrome.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        func: playYouTubeVideoFrom,
        args: [clipStartMs / 1_000],
      });
      if (execution[0]?.result !== true) throw new Error('The YouTube player is unavailable.');
      setPlayerReadState('idle');
    } catch {
      setPlayerReadState('error');
    }
  }, [clipStartMs, sourceState]);

  const previewAudioDraft = useCallback(async () => {
    if (
      clipStartMs === null || sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    setPlayerReadState('reading');
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
      const execution = await chrome.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        func: playAudioPageFrom,
        args: [clipStartMs / 1_000, sourceState.source.normalizedUrl],
      });
      const result = execution[0]?.result as { ok?: boolean } | undefined;
      if (result?.ok !== true) throw new Error('The connected page audio could not be controlled.');
      setPlayerReadState('idle');
    } catch { setPlayerReadState('error'); }
  }, [clipStartMs, sourceState]);

  useEffect(() => {
    if (
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Web page' ||
      sourceState.source.audioDetectionResolved
    ) return;
    const context = connectedContextRef.current;
    const pageUrl = sourceState.source.url;
    if (!context) return;
    let current = true;
    void chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      func: readAudioPageSnapshot,
      args: [true],
    }).then((execution) => {
      if (!current) return;
      const detection = validateAudioPageSnapshot(pageUrl, execution[0]?.result);
      setSourceState((state) => {
        if (
          state.status !== 'connected' || state.source.classification !== 'Web page' ||
          state.source.url !== pageUrl
        ) return state;
        if (detection.status === 'supported') {
          return { status: 'connected', source: detection.source };
        }
        if (detection.status === 'no-audio') {
          return {
            status: 'connected',
            source: {
              title: state.source.title,
              hostname: state.source.hostname,
              url: state.source.url,
              classification: 'Audio unavailable',
              reason: detection.status,
            },
          };
        }
        return {
          status: 'connected',
          source: { ...state.source, audioDetectionResolved: true },
        };
      });
      if (detection.status === 'not-audio-page') void clearAudioDraft();
    }).catch(() => {
      if (!current) return;
      setSourceState((state) => state.status === 'connected' &&
        state.source.classification === 'Web page' && state.source.url === pageUrl
        ? { status: 'connected', source: { ...state.source, audioDetectionResolved: true } }
        : state);
    });
    return () => { current = false; };
  }, [clearAudioDraft, sourceState]);

  useEffect(() => {
    if (
      draftRestorationStatus !== 'ready' || sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio'
    ) return;
    const draft = audioDraftRef.current;
    if (
      draft && audioClipDraftBelongsToSource(
        draft,
        sourceState.source.url,
        sourceState.source.canonicalUrl,
      )
    ) {
      setClipStartMs(draft.startMs);
      setClipEndMs(draft.endMs);
      setAudioCommentary(draft.commentary);
    } else if (draft) {
      void clearAudioDraft();
    }
  }, [clearAudioDraft, draftRestorationStatus, sourceState]);

  useEffect(() => {
    if (
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'YouTube' ||
      sourceState.source.metadataResolved
    ) return;
    const context = connectedContextRef.current;
    const videoId = sourceState.source.videoId;
    if (!context) return;
    let current = true;
    void chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      func: extractYouTubePageMetadata,
    }).then((execution) => {
      const metadata = validateYouTubePageMetadata(sourceState.source.url, execution[0]?.result);
      if (!current) return;
      setSourceState((state) => {
        if (
          state.status !== 'connected' || state.source.classification !== 'YouTube' ||
          state.source.videoId !== videoId
        ) return state;
        return {
          status: 'connected',
          source: metadata
            ? { ...state.source, ...metadata, metadataResolved: true }
            : { ...state.source, metadataResolved: true },
        };
      });
    }).catch(() => {
      if (!current) return;
      setSourceState((state) => state.status === 'connected' && state.source.classification === 'YouTube' && state.source.videoId === videoId
        ? { status: 'connected', source: { ...state.source, metadataResolved: true } }
        : state);
    });
    return () => { current = false; };
  }, [sourceState]);

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
    const restorationRevision = draftRevisionRef.current;
    void chrome.storage.session
      .get([
        ACTIVE_TAB_CONTEXT_KEY,
        ANNOTATION_DRAFT_STORAGE_KEY,
        YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
        AUDIO_CLIP_DRAFT_STORAGE_KEY,
      ])
      .then((stored) => {
        if (!mounted) return;
        const storedContext = isActiveTabContext(stored[ACTIVE_TAB_CONTEXT_KEY])
          ? stored[ACTIVE_TAB_CONTEXT_KEY]
          : null;
        const context = contextObservedRef.current ? connectedContextRef.current : storedContext;
        if (!contextObservedRef.current) {
          connectedContextRef.current = context;
          setSourceState(context ? getSourceState(context.title, context.url) : { status: 'not-connected' });
        }

        const storedDraftValue = stored[ANNOTATION_DRAFT_STORAGE_KEY];
        const draft = deserializeAnnotationDraft(storedDraftValue);
        let youtubeContext = false;
        if (context) {
          try { getYouTubeVideoIdentity(context.url); youtubeContext = true; } catch { /* Article context. */ }
        }
        if (!youtubeContext && shouldApplyDraftRestoration(restorationRevision, draftRevisionRef.current, draft, context)) {
          draftRef.current = draft;
          setCaptureState({ status: 'captured', data: draft.capture });
          setCommentary(draft.commentary);
        } else if (restorationRevision === draftRevisionRef.current && storedDraftValue !== undefined) {
          draftRef.current = null;
          void removePersistedDraft();
        }
        const storedYoutubeDraftValue = stored[YOUTUBE_CLIP_DRAFT_STORAGE_KEY];
        const youtubeDraft = deserializeYouTubeClipDraft(storedYoutubeDraftValue);
        if (
          restorationRevision === draftRevisionRef.current && youtubeDraft && context &&
          youtubeClipDraftBelongsToSource(youtubeDraft, context.url)
        ) {
          youtubeDraftRef.current = youtubeDraft;
          setClipStartMs(youtubeDraft.startMs);
          setClipEndMs(youtubeDraft.endMs);
          setYoutubeCommentary(youtubeDraft.commentary);
        } else if (restorationRevision === draftRevisionRef.current && storedYoutubeDraftValue !== undefined) {
          youtubeDraftRef.current = null;
          void chrome.storage.session.remove(YOUTUBE_CLIP_DRAFT_STORAGE_KEY);
        }
        const storedAudioDraftValue = stored[AUDIO_CLIP_DRAFT_STORAGE_KEY];
        const audioDraft = deserializeAudioClipDraft(storedAudioDraftValue);
        if (restorationRevision === draftRevisionRef.current && audioDraft && !youtubeContext) {
          audioDraftRef.current = audioDraft;
        } else if (restorationRevision === draftRevisionRef.current && storedAudioDraftValue !== undefined) {
          audioDraftRef.current = null;
          void chrome.storage.session.remove(AUDIO_CLIP_DRAFT_STORAGE_KEY);
        }
        setDraftRestorationStatus('ready');
      })
      .catch(() => {
        if (!mounted) return;
        if (!contextObservedRef.current) {
          setSourceState({ status: 'unexpected-error', message: 'Unable to load the connected source. Try again.' });
        }
        setDraftRestorationStatus('ready');
      });
    return () => { mounted = false; chrome.storage.onChanged.removeListener(storageChange); chrome.runtime.onMessage.removeListener(runtimeMessage); };
  }, [removePersistedDraft, showStoredContext]);

  useEffect(() => {
    if (!refreshSuccess) return;
    const timer = window.setTimeout(() => setRefreshSuccess(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [refreshSuccess]);

  const changeCommentary = (value: string) => {
    draftRevisionRef.current += 1;
    setCommentary(value);
    const draft = draftRef.current;
    if (!draft) return;
    const updatedDraft = updateAnnotationDraftCommentary(draft, value);
    if (updatedDraft) persistDraft(updatedDraft);
  };

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
  const audioBusy = audioRecorder.state.status === 'requesting_permission' || audioRecorder.state.status === 'recording';
  const canPublish = authState.status === 'signed-in' && captured && commentary.trim() && commentary.length <= 2_000 && publishState.status !== 'publishing' && !audioBusy;
  const contextUrl = sourceState.status === 'connected' ? sourceState.source.url : null;
  const youtubeSource = sourceState.status === 'connected' && sourceState.source.classification === 'YouTube'
    ? sourceState.source
    : null;
  const audioSource = sourceState.status === 'connected' && sourceState.source.classification === 'Podcast / web audio'
    ? sourceState.source
    : null;
  const audioUnavailableSource = sourceState.status === 'connected' && sourceState.source.classification === 'Audio unavailable'
    ? sourceState.source
    : null;
  const clipRangeError = getNewMediaPublicationRangeError(
    clipStartMs,
    clipEndMs,
    videoDurationMs,
  );
  const canPublishYoutube = authState.status === 'signed-in' && youtubeSource !== null &&
    clipRangeError === null && youtubeCommentary.trim().length > 0 &&
    youtubeCommentary.length <= 2_000 && youtubePublishState.status !== 'publishing';
  const canPublishAudio = authState.status === 'signed-in' && audioSource !== null &&
    videoDurationMs !== null && clipRangeError === null && audioCommentary.trim().length > 0 &&
    audioCommentary.length <= 2_000 && audioPublishState.status !== 'publishing';
  let contextCacheKey: string | null = null;
  if (contextUrl) {
    try {
      contextCacheKey = `context:${youtubeSource?.normalizedUrl ?? audioSource?.normalizedUrl ?? normalizeArticleUrl(contextUrl)}`;
    } catch { contextCacheKey = null; }
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

      {supabase && currentScreen.kind === 'annotation' && <AnnotationDetailView key={`annotation:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={() => void beginGoogleSignIn()} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} connectedVideoId={youtubeSource?.videoId ?? null} onPlayConnectedClip={playConnectedClip} connectedAudioNormalizedUrl={audioSource?.normalizedUrl ?? null} onPlayConnectedAudioClip={playConnectedAudioClip} onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'comments' && <AnnotationDetailView key={`comments:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={() => void beginGoogleSignIn()} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} connectedVideoId={youtubeSource?.videoId ?? null} onPlayConnectedClip={playConnectedClip} connectedAudioNormalizedUrl={audioSource?.normalizedUrl ?? null} onPlayConnectedAudioClip={playConnectedAudioClip} focusComments onSocialMutation={() => socialCacheRef.current.clear()} />}
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
          {supabase && contextUrl && contextCacheKey && !audioUnavailableSource && <AnnotationCollection key={contextCacheKey} supabase={supabase} cache={socialCacheRef.current} cacheKey={contextCacheKey} sourceUrl={audioSource?.normalizedUrl ?? contextUrl} navigation={navigationCallbacks} emptyTitle={youtubeSource ? 'No clips on this video yet' : audioSource ? 'No clips on this episode yet' : 'Be the first to annotate this source'} emptyMessage={youtubeSource ? 'Create the first public time-coded annotation below.' : audioSource ? 'Create the first public audio clip below.' : 'Capture a passage below to add the first public annotation.'} compactHeading={youtubeSource ? 'Clips on this video' : audioSource ? 'Clips on this episode' : 'On this source'} />}
          {youtubeSource ? (
            <section className="create-panel youtube-clip-panel" aria-labelledby="create-heading">
              <div className="section-heading"><h2 id="create-heading">Create clip</h2><span>YouTube time range</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this video for unpublished work…</span></div> : <>
                <p className="create-help">Play the connected video, set the start, continue watching, then set the end.</p>
                <dl className="clip-time-grid">
                  <div><dt>START</dt><dd>{clipStartMs === null ? '--:--' : formatMediaTime(clipStartMs)}</dd></div>
                  <div><dt>END</dt><dd>{clipEndMs === null ? '--:--' : formatMediaTime(clipEndMs)}</dd></div>
                  <div><dt>LENGTH</dt><dd>{clipStartMs === null || clipEndMs === null || clipEndMs <= clipStartMs ? '--:--' : formatMediaTime(clipEndMs - clipStartMs)}</dd></div>
                </dl>
                {playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTime(playerTimeMs)}</strong>{videoDurationMs !== null && <> / {formatMediaTime(videoDurationMs)}</>}</p>}
                <div className="clip-control-row"><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('start')} disabled={playerReadState === 'reading'}>Set start</button><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('end')} disabled={playerReadState === 'reading'}>Set end</button><button className="text-button" type="button" onClick={() => void readConnectedPlayer('refresh')} disabled={playerReadState === 'reading'}>{playerReadState === 'reading' ? 'Reading…' : 'Refresh time'}</button></div>
                {clipStartMs !== null && <button className="button button-secondary preview-clip" type="button" onClick={() => void previewYoutubeDraft()} disabled={playerReadState === 'reading'}>Preview from start</button>}
                {clipStartMs !== null && clipEndMs !== null && clipRangeError && <p className="inline-error" role="alert">{clipRangeError}</p>}
                {playerReadState === 'error' && <p className="inline-error" role="alert">The current YouTube player time could not be read. Reconnect the video and try again.</p>}
                <div className="annotation-field"><label htmlFor="youtube-commentary">Your commentary <span aria-hidden="true">*</span></label><textarea id="youtube-commentary" value={youtubeCommentary} maxLength={2_000} rows={6} required onChange={(event) => changeYoutubeCommentary(event.target.value)} /><span aria-live="polite">{youtubeCommentary.length.toLocaleString()} / 2,000</span></div>
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearYoutubeDraft()} disabled={youtubePublishState.status === 'publishing'}>Clear clip</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishYoutubeClip()} disabled={!canPublishYoutube}>{youtubePublishState.status === 'publishing' ? 'Publishing…' : 'Publish clip'}</button>}</div>
                {youtubePublishState.status === 'error' && <p className="inline-error" role="alert">{youtubePublishState.message}</p>}
              </>}
            </section>
          ) : audioSource ? (
            <section className="create-panel audio-clip-panel" aria-labelledby="create-heading">
              <div className="section-heading"><h2 id="create-heading">Create audio clip</h2><span>Podcast / web audio</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this episode for unpublished work…</span></div> : <>
                <p className="create-help">Play the connected page audio, set the start, continue listening, then set the end.</p>
                {(audioSource.playerStatus === 'duration-unavailable' || audioSource.playerStatus === 'current-time-unavailable') && <div className="compact-state" role="status"><strong>Audio player detected</strong><span>Play the episode to initialize playback timing.</span></div>}
                {audioSource.playerStatus === 'ambiguous' && <div className="compact-state compact-state-error" role="status"><strong>Choose the episode player</strong><span>Annotated found multiple equally eligible audio players. Pause all but the episode player, then use Refresh time.</span></div>}
                {audioSource.playerStatus === 'unavailable' && <div className="compact-state compact-state-error" role="status"><strong>Audio player unavailable</strong><span>The previously detected top-level audio player can no longer be read. Reload the page player, then use Refresh time.</span></div>}
                <dl className="clip-time-grid">
                  <div><dt>START</dt><dd>{clipStartMs === null ? '--:--' : formatMediaTime(clipStartMs)}</dd></div>
                  <div><dt>END</dt><dd>{clipEndMs === null ? '--:--' : formatMediaTime(clipEndMs)}</dd></div>
                  <div><dt>LENGTH</dt><dd>{clipStartMs === null || clipEndMs === null || clipEndMs <= clipStartMs ? '--:--' : formatMediaTime(clipEndMs - clipStartMs)}</dd></div>
                </dl>
                {playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTime(playerTimeMs)}</strong>{videoDurationMs !== null && <> / {formatMediaTime(videoDurationMs)}</>}</p>}
                <div className="clip-control-row"><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('start')} disabled={playerReadState === 'reading'}>Set start</button><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('end')} disabled={playerReadState === 'reading'}>Set end</button><button className="text-button" type="button" onClick={() => void readConnectedPlayer('refresh')} disabled={playerReadState === 'reading'}>{playerReadState === 'reading' ? 'Reading…' : 'Refresh time'}</button></div>
                {clipStartMs !== null && <button className="button button-secondary preview-clip" type="button" onClick={() => void previewAudioDraft()} disabled={playerReadState === 'reading'}>Preview / Jump to start</button>}
                {clipStartMs !== null && clipEndMs !== null && clipRangeError && <p className="inline-error" role="alert">{clipRangeError}</p>}
                {playerReadState === 'error' && <p className="inline-error" role="alert">The page audio player disappeared or its current time could not be read. Reconnect the episode and try again.</p>}
                <div className="annotation-field"><label htmlFor="audio-clip-commentary">Your commentary <span aria-hidden="true">*</span></label><textarea id="audio-clip-commentary" value={audioCommentary} maxLength={2_000} rows={6} required onChange={(event) => changeAudioCommentary(event.target.value)} /><span aria-live="polite">{audioCommentary.length.toLocaleString()} / 2,000</span></div>
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearAudioDraft()} disabled={audioPublishState.status === 'publishing'}>Clear clip</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAudioClip()} disabled={!canPublishAudio}>{audioPublishState.status === 'publishing' ? 'Publishing…' : 'Publish clip'}</button>}</div>
                {audioPublishState.status === 'error' && <p className="inline-error" role="alert">{audioPublishState.message}</p>}
              </>}
            </section>
          ) : audioUnavailableSource ? (
            <div className="compact-state compact-state-error"><strong>Audio player unavailable</strong><span>This audio page does not expose a usable top-level HTML audio element.</span></div>
          ) : (
            <section className="create-panel" aria-labelledby="create-heading"><div className="section-heading"><h2 id="create-heading">Create annotation</h2><span>Article text</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this source for unpublished work…</span></div> : captured ? <><blockquote className="captured-passage">{captured.selectedText}</blockquote><dl className="capture-metadata">{captured.author && <div><dt>Author</dt><dd>{captured.author}</dd></div>}{captured.publisher && <div><dt>Publisher</dt><dd>{captured.publisher}</dd></div>}<div><dt>Source</dt><dd>{captured.hostname}</dd></div></dl><div className="annotation-field"><label htmlFor="annotation-commentary">Your commentary</label><textarea id="annotation-commentary" value={commentary} maxLength={2_000} rows={6} onChange={(event) => changeCommentary(event.target.value)} /><span aria-live="polite">{commentary.length.toLocaleString()} / 2,000</span></div><AudioRecorder controller={audioRecorder} disabled={publishState.status === 'publishing'} /><div className="create-actions"><button className="button button-secondary" type="button" onClick={clearCapture} disabled={publishState.status === 'publishing'}>Clear capture</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAnnotation()} disabled={!canPublish}>{publishState.status === 'publishing' ? 'Publishing…' : 'Publish annotation'}</button>}</div>{publishState.status === 'error' && <p className="inline-error" role="alert">{publishState.message}</p>}</> : <><p className="create-help">Highlight article text in the connected page, then capture it here. Selections and commentary may contain up to 2,000 characters each.</p><button className="button button-primary" type="button" onClick={() => void captureSelection()} disabled={sourceState.status !== 'connected' || isCapturing}>{isCapturing ? 'Capturing…' : 'Capture selected text'}</button>{(captureState.status === 'recoverable-error' || captureState.status === 'reconnect-required' || captureState.status === 'unexpected-error') && <p className="inline-error" role="alert">{captureState.message}</p>}</>}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

export default App;
