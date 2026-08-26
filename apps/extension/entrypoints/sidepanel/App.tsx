import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { normalizeArticleUrl, ArticleUrlNormalizationError } from '@annotated/shared/url-normalization';
import {
  formatMediaTime,
  getNewMediaPublicationRangeError,
} from '@annotated/shared/media-time';
import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
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
import { beginHostedAudioClipAnnotation } from '../../utils/audio-publishing';
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
  CREATE_MODES,
  CREATE_MODE_SELECTION_STORAGE_KEY,
  createModeSelectionState,
  createInitialDraftState,
  deserializeCreateModeSelection,
  hasCreateModeDraft,
  moveSelectionToPage,
  reduceCreateDraftState,
  selectCreateMode,
  serializeCreateModeSelection,
  storedCreateModeSelectionMatches,
  updatePageGeneration,
  type CreateMode,
  type CreatePageGeneration,
  type ModeCapabilities,
  type ModeSelectionState,
  type StoredCreateModeSelection,
} from '../../utils/create-mode';
import {
  YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
  deserializeYouTubeClipDraft,
  serializeYouTubeClipDraft,
  youtubeClipDraftBelongsToSource,
  type YouTubeClipDraft,
} from '../../utils/youtube-draft';
import {
  extractYouTubePageMetadata,
  normalizeYouTubeVideoTitle,
  playYouTubeVideoFrom,
  readYouTubePlayerState,
  validateYouTubePageMetadata,
  validateYouTubePlayerState,
} from '../../utils/youtube-page';
import { beginHostedYouTubeAnnotation } from '../../utils/youtube-publishing';
import {
  MEDIA_CAPTURE_CANCEL,
  MEDIA_CAPTURE_EVENT,
  MEDIA_CAPTURE_RETRY,
  MEDIA_CAPTURE_START,
  MEDIA_CAPTURE_STATUS,
  type CaptureSnapshot,
  type CaptureSourceIdentity,
  type HostedMediaOperation,
} from '../../utils/media-capture';
import {
  HOSTED_MEDIA_SESSION_KEY,
  cancelOwnedHostedMedia,
  getHostedMediaCancelError,
  getOwnedHostedMediaStatus,
  isHostedMediaSession,
  presentHostedMediaSnapshot,
  reconcileHostedMediaState,
  type HostedMediaSession,
} from '../../utils/hosted-media';
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

type PageSource = ArticlePageSource | YouTubePageSource | AudioPageSource;

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
          title: normalizeYouTubeVideoTitle(title) || 'youtube.com',
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

const CREATE_MODE_LABELS: Record<CreateMode, string> = {
  text: 'Text',
  video: 'Video',
  audio: 'Audio',
};

function createUnavailableCapabilities(reason: string): ModeCapabilities {
  return {
    text: { status: 'unavailable', reason },
    video: { status: 'unavailable', reason },
    audio: { status: 'unavailable', reason },
  };
}

function getModeCapabilities(sourceState: SourceState): ModeCapabilities {
  if (
    sourceState.status === 'loading' ||
    sourceState.status === 'refreshing'
  ) {
    return {
      text: { status: 'checking' },
      video: { status: 'checking' },
      audio: { status: 'checking' },
    };
  }
  if (sourceState.status !== 'connected') {
    const reason = sourceState.status === 'different-tab'
      ? 'Return to the connected tab or connect this tab.'
      : sourceState.status === 'reconnect-required'
        ? 'Reconnect Annotated to this page.'
        : 'Connect a supported HTTP(S) page first.';
    return createUnavailableCapabilities(reason);
  }
  if (sourceState.source.classification === 'YouTube') {
    return {
      text: { status: 'available' },
      video: { status: 'available' },
      audio: { status: 'unavailable', reason: 'Audio mode supports top-level page audio, not YouTube video.' },
    };
  }
  if (sourceState.source.classification === 'Podcast / web audio') {
    return {
      text: { status: 'available' },
      video: { status: 'unavailable', reason: 'Video mode supports connected YouTube watch pages only.' },
      audio: { status: 'available' },
    };
  }
  return {
    text: { status: 'available' },
    video: { status: 'unavailable', reason: 'Video mode supports connected YouTube watch pages only.' },
    audio: sourceState.source.audioDetectionResolved
      ? { status: 'unavailable', reason: 'No supported top-level page audio was found.' }
      : { status: 'checking' },
  };
}

function getCreatePageSourceKey(url: string): string | null {
  try {
    return getYouTubeVideoIdentity(url).normalizedUrl;
  } catch {
    try { return normalizeArticleUrl(url); } catch { return null; }
  }
}

function getModeCapabilitySummary(selection: ModeSelectionState | null): string {
  if (!selection) return 'Connect a supported page to choose a creation mode.';
  const available = CREATE_MODES
    .filter((mode) => selection.capabilities[mode].status === 'available')
    .map((mode) => CREATE_MODE_LABELS[mode]);
  const checking = CREATE_MODES
    .filter((mode) => selection.capabilities[mode].status === 'checking')
    .map((mode) => CREATE_MODE_LABELS[mode]);
  const unavailable = CREATE_MODES.flatMap((mode) => {
    const capability = selection.capabilities[mode];
    return capability.status === 'unavailable'
      ? [`${CREATE_MODE_LABELS[mode]} unavailable: ${capability.reason}`]
      : [];
  });
  const availableMessage = available.length > 0
    ? `${available.join(', ')} ${available.length === 1 ? 'is' : 'are'} available.`
    : 'No creation mode is available yet.';
  const checkingMessage = checking.length > 0 ? ` Checking ${checking.join(' and ')}.` : '';
  const recommendedMessage = selection.recommendedMode
    ? ` ${CREATE_MODE_LABELS[selection.recommendedMode]} is recommended.`
    : '';
  const unavailableMessage = unavailable.length > 0 ? ` ${unavailable.join(' ')}` : '';
  return `${availableMessage}${checkingMessage}${recommendedMessage}${unavailableMessage}`;
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
      <div><span className="section-label">Connected source</span><h2>{state.source.title}</h2>{state.source.classification === 'YouTube' && state.source.channelName && <p>{state.source.channelName}</p>}{state.source.classification === 'Podcast / web audio' && (state.source.showName || state.source.publisher) && <p>{state.source.showName ?? state.source.publisher}</p>}<p>{state.source.hostname}</p></div>
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
  const [createDraftState, dispatchCreateDraft] = useReducer(
    reduceCreateDraftState,
    undefined,
    createInitialDraftState,
  );
  const [modeSelection, setModeSelection] = useState<ModeSelectionState | null>(null);
  const [modeAnnouncement, setModeAnnouncement] = useState('');
  const [draftRestorationStatus, setDraftRestorationStatus] = useState<'loading' | 'ready'>('loading');
  const [publishState, setPublishState] = useState<PublishState>({ status: 'idle' });
  const [youtubePublishState, setYoutubePublishState] = useState<PublishState>({ status: 'idle' });
  const [audioPublishState, setAudioPublishState] = useState<PublishState>({ status: 'idle' });
  const [hostedMediaSession, setHostedMediaSession] = useState<HostedMediaSession | null>(null);
  const [mediaCaptureState, setMediaCaptureState] = useState<CaptureSnapshot>({ status: 'idle' });
  const [mediaCaptureOperation, setMediaCaptureOperation] = useState<HostedMediaOperation | null>(null);
  const [isCancellingHostedMedia, setIsCancellingHostedMedia] = useState(false);
  const hostedMediaSessionRef = useRef<HostedMediaSession | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [navigation, dispatchNavigation] = useReducer(reduceNavigation, INITIAL_NAVIGATION);
  const connectedContextRef = useRef<ActiveTabContext | null>(null);
  const contextObservedRef = useRef(false);
  const captureRevisionRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const draftRef = useRef<AnnotationDraft | null>(null);
  const youtubeDraftRef = useRef<YouTubeClipDraft | null>(null);
  const audioDraftRef = useRef<AudioClipDraft | null>(null);
  const createPageRef = useRef<CreatePageGeneration | null>(null);
  const storedModeSelectionRef = useRef<StoredCreateModeSelection | null>(null);
  const previousModeSelectionRef = useRef<ModeSelectionState | null>(null);
  const authRevisionRef = useRef(0);
  const authMountedRef = useRef(false);
  const publishInFlightRef = useRef(false);
  const socialCacheRef = useRef<SessionSocialCache>(new Map());
  const audioRecorder = useAudioRecorder();

  const commentary = createDraftState.text.commentary;
  const videoDraftState = createDraftState.video;
  const audioDraftState = createDraftState.audio;
  const modeCapabilities = useMemo(() => getModeCapabilities(sourceState), [sourceState]);

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
    dispatchCreateDraft({ type: 'reset-mode', mode: 'video' });
    setYoutubePublishState({ status: 'idle' });
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
    dispatchCreateDraft({ type: 'reset-mode', mode: 'audio' });
    setAudioPublishState({ status: 'idle' });
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
    dispatchCreateDraft({ type: 'reset-mode', mode: 'text' });
    setPublishState({ status: 'idle' });
    await removePersistedDraft();
  }, [audioRecorder.discard, removePersistedDraft]);

  const clearCapture = useCallback(() => {
    void clearDraft('explicit-clear');
  }, [clearDraft]);

  const enterReconnectRequired = useCallback(() => {
    void clearDraft('source-invalidated');
    setCaptureState({ status: 'reconnect-required', message: RECONNECT_MESSAGE });
    setSourceState({ status: 'reconnect-required' });
    setRefreshSuccess(false);
  }, [clearDraft]);

  const showStoredContext = useCallback((context: ActiveTabContext | null) => {
    contextObservedRef.current = true;
    const draft = draftRef.current;
    if (draft && context && annotationDraftBelongsToContext(draft, context)) {
      setCaptureState({ status: 'captured', data: draft.capture });
      dispatchCreateDraft({ type: 'set-text-commentary', commentary: draft.commentary });
    } else if (draft) {
      captureRevisionRef.current += 1;
      setCaptureState({ status: 'idle' });
    }
    const youtubeDraft = youtubeDraftRef.current;
    if (youtubeDraft && context && youtubeClipDraftBelongsToSource(youtubeDraft, context.url)) {
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'video',
        sourceKey: youtubeDraft.source.videoId,
        startMs: youtubeDraft.startMs,
        endMs: youtubeDraft.endMs,
        commentary: youtubeDraft.commentary,
      });
    }
    const audioDraft = audioDraftRef.current;
    if (audioDraft && context && audioClipDraftBelongsToSource(audioDraft, context.url)) {
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'audio',
        sourceKey: audioDraft.source.normalizedUrl,
        startMs: audioDraft.startMs,
        endMs: audioDraft.endMs,
        commentary: audioDraft.commentary,
      });
    }
    connectedContextRef.current = context;
    setSourceState(context ? getSourceState(context.title, context.url) : { status: 'not-connected' });
    setRefreshSuccess(false);
  }, []);

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
  }, [clearDraft, enterReconnectRequired]);

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
      dispatchCreateDraft({ type: 'set-text-commentary', commentary: '' });
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
    const mode = sourceState.source.classification === 'YouTube' ? 'video' : 'audio';
    dispatchCreateDraft({ type: 'patch-media', mode, patch: { playerReadState: 'reading' } });
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
        const patch = {
          sourceKey: sourceState.source.videoId,
          playerTimeMs: currentMs,
          durationMs,
          playerReadState: 'idle' as const,
        };
        if (action === 'start') {
          dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { ...patch, startMs: currentMs } });
          persistYoutubeDraft(
            sourceState.source.url,
            currentMs,
            videoDraftState.endMs,
            videoDraftState.commentary,
          );
        } else if (action === 'end') {
          dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { ...patch, endMs: currentMs } });
          persistYoutubeDraft(
            sourceState.source.url,
            videoDraftState.startMs,
            currentMs,
            videoDraftState.commentary,
          );
        } else {
          dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch });
        }
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
        dispatchCreateDraft({
          type: 'patch-media',
          mode: 'audio',
          patch: {
            sourceKey: connectedAudioSource.normalizedUrl,
            playerTimeMs: null,
            durationMs: null,
            playerReadState: 'idle',
          },
        });
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
        dispatchCreateDraft({
          type: 'patch-media',
          mode: 'audio',
          patch: {
            sourceKey: connectedAudioSource.normalizedUrl,
            playerTimeMs: null,
            durationMs: null,
            playerReadState: 'idle',
          },
        });
        return;
      }
      if (detection.readiness.currentTime === null) {
        dispatchCreateDraft({
          type: 'patch-media',
          mode: 'audio',
          patch: {
            sourceKey: connectedAudioSource.normalizedUrl,
            playerTimeMs: null,
            durationMs: null,
            playerReadState: 'idle',
          },
        });
        return;
      }
      const currentMs = Math.round(detection.readiness.currentTime * 1_000);
      const durationMs = detection.readiness.duration === null
        ? null
        : Math.floor(detection.readiness.duration * 1_000);
      const patch = {
        sourceKey: connectedAudioSource.normalizedUrl,
        playerTimeMs: currentMs,
        durationMs,
        playerReadState: 'idle' as const,
      };
      if (action === 'start') {
        dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { ...patch, startMs: currentMs } });
        persistAudioDraft(
          connectedAudioSource,
          currentMs,
          audioDraftState.endMs,
          audioDraftState.commentary,
        );
      } else if (action === 'end') {
        dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { ...patch, endMs: currentMs } });
        persistAudioDraft(
          connectedAudioSource,
          audioDraftState.startMs,
          currentMs,
          audioDraftState.commentary,
        );
      } else {
        dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch });
      }
    } catch {
      dispatchCreateDraft({ type: 'patch-media', mode, patch: { playerReadState: 'error' } });
    }
  }, [audioDraftState, persistAudioDraft, persistYoutubeDraft, sourceState, videoDraftState]);

  const changeYoutubeCommentary = (value: string) => {
    const sourceKey = sourceState.status === 'connected' && sourceState.source.classification === 'YouTube'
      ? sourceState.source.videoId
      : videoDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { commentary: value, sourceKey } });
    if (sourceState.status === 'connected' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, value);
    }
  };

  const changeAudioCommentary = (value: string) => {
    const sourceKey = sourceState.status === 'connected' && sourceState.source.classification === 'Podcast / web audio'
      ? sourceState.source.normalizedUrl
      : audioDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { commentary: value, sourceKey } });
    if (sourceState.status === 'connected' && sourceState.source.classification === 'Podcast / web audio') {
      persistAudioDraft(sourceState.source, audioDraftState.startMs, audioDraftState.endMs, value);
    }
  };

  const startHostedCapture = useCallback(async (
    operation: HostedMediaOperation,
    source: CaptureSourceIdentity,
    startMs: number,
    endMs: number,
  ) => {
    if (!supabase) throw new Error('The authenticated session is unavailable.');
    const context = connectedContextRef.current;
    if (!context || context.url !== source.pageUrl) throw new Error(RECONNECT_MESSAGE);
    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) throw new Error('The authenticated session is unavailable.');
    const session: HostedMediaSession = {
      operation,
      sourceUrl: source.pageUrl,
      mediaType: source.kind === 'youtube' ? 'video' : 'audio',
      startMs,
      endMs,
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({ [HOSTED_MEDIA_SESSION_KEY]: session });
    hostedMediaSessionRef.current = session;
    setHostedMediaSession(session);
    setMediaCaptureOperation(operation);
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: MEDIA_CAPTURE_START,
      request: {
        tabId: context.tabId,
        source,
        startMs,
        endMs,
        operation,
        accessToken,
        apiOrigin: getWebAppOrigin(),
      },
    }) as { ok?: boolean; snapshot?: CaptureSnapshot };
    if (response?.snapshot) setMediaCaptureState(response.snapshot);
    if (!response?.ok) {
      throw new Error(
        response?.snapshot && 'message' in response.snapshot
          ? response.snapshot.message
          : 'The connected media capture could not start.',
      );
    }
  }, [supabase]);

  const publishYoutubeClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' || sourceState.source.classification !== 'YouTube' ||
      videoDraftState.startMs === null || videoDraftState.endMs === null ||
      !videoDraftState.commentary.trim()
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      videoDraftState.startMs,
      videoDraftState.endMs,
      videoDraftState.durationMs,
    );
    if (rangeError || videoDraftState.commentary.length > 2_000) {
      setYoutubePublishState({ status: 'error', message: rangeError ?? 'Commentary cannot exceed 2,000 characters.' });
      return;
    }
    publishInFlightRef.current = true;
    setYoutubePublishState({ status: 'publishing' });
    try {
      const operation = await beginHostedYouTubeAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        title: sourceState.source.title,
        channelName: sourceState.source.channelName,
        startMs: videoDraftState.startMs,
        endMs: videoDraftState.endMs,
        commentaryText: videoDraftState.commentary,
        videoDurationMs: videoDraftState.durationMs,
      });
      await startHostedCapture(operation, {
        kind: 'youtube',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.videoId,
      }, videoDraftState.startMs, videoDraftState.endMs);
      setYoutubePublishState({ status: 'idle' });
    } catch (error) {
      setYoutubePublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The YouTube clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
    }
  }, [authState.status, sourceState, startHostedCapture, supabase, videoDraftState]);

  const publishAudioClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio' ||
      audioDraftState.startMs === null || audioDraftState.endMs === null ||
      !audioDraftState.commentary.trim() || audioDraftState.durationMs === null
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      audioDraftState.startMs,
      audioDraftState.endMs,
      audioDraftState.durationMs,
    );
    if (rangeError || audioDraftState.commentary.length > 2_000) {
      setAudioPublishState({ status: 'error', message: rangeError ?? 'Commentary cannot exceed 2,000 characters.' });
      return;
    }
    publishInFlightRef.current = true;
    setAudioPublishState({ status: 'publishing' });
    try {
      const operation = await beginHostedAudioClipAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        canonicalUrl: sourceState.source.canonicalUrl,
        title: sourceState.source.title,
        author: sourceState.source.author,
        publisher: sourceState.source.publisher,
        showName: sourceState.source.showName,
        startMs: audioDraftState.startMs,
        endMs: audioDraftState.endMs,
        commentaryText: audioDraftState.commentary,
        mediaDurationMs: audioDraftState.durationMs,
      });
      await startHostedCapture(operation, {
        kind: 'audio',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.normalizedUrl,
      }, audioDraftState.startMs, audioDraftState.endMs);
      setAudioPublishState({ status: 'idle' });
    } catch (error) {
      setAudioPublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The audio clip could not be published.',
      });
    } finally { publishInFlightRef.current = false; }
  }, [audioDraftState, authState.status, sourceState, startHostedCapture, supabase]);

  const cancelHostedMedia = useCallback(async () => {
    const session = hostedMediaSession;
    if (!session || !supabase || isCancellingHostedMedia) return;
    setIsCancellingHostedMedia(true);
    try {
      await chrome.runtime.sendMessage({
        target: 'background',
        type: MEDIA_CAPTURE_CANCEL,
        captureId: 'captureId' in mediaCaptureState ? mediaCaptureState.captureId : null,
      });
      await cancelOwnedHostedMedia(supabase, session, async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session?.access_token) throw new Error('The authenticated session is unavailable.');
        const response = await fetch(`${getWebAppOrigin()}/api/media/upload/cancel`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${data.session.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            annotationId: session.operation.annotationId,
            mediaId: session.operation.mediaId,
          }),
        });
        if (!response.ok) throw new Error(await getHostedMediaCancelError(response));
      });
      await chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
      hostedMediaSessionRef.current = null;
      setHostedMediaSession(null);
      setMediaCaptureOperation(null);
      setMediaCaptureState({ status: 'idle' });
      setYoutubePublishState({ status: 'idle' });
      setAudioPublishState({ status: 'idle' });
    } catch (error) {
      setMediaCaptureState({
        status: 'error',
        captureId: 'captureId' in mediaCaptureState ? mediaCaptureState.captureId : null,
        code: 'unexpected',
        message: error instanceof Error ? error.message : 'Cancel failed.',
      });
    } finally {
      setIsCancellingHostedMedia(false);
    }
  }, [hostedMediaSession, isCancellingHostedMedia, mediaCaptureState, supabase]);

  const retryHostedUpload = useCallback(async () => {
    if (!supabase || !('captureId' in mediaCaptureState) || !mediaCaptureState.captureId) return;
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      setMediaCaptureState({
        status: 'error',
        captureId: mediaCaptureState.captureId,
        code: 'authorization-failed',
        message: 'Your session could not be refreshed. Sign in again before retrying.',
      });
      return;
    }
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: MEDIA_CAPTURE_RETRY,
      captureId: mediaCaptureState.captureId,
      accessToken: data.session.access_token,
    }) as { snapshot?: CaptureSnapshot };
    if (response?.snapshot) setMediaCaptureState(response.snapshot);
  }, [mediaCaptureState, supabase]);

  const recaptureHostedMedia = useCallback(async () => {
    const session = hostedMediaSession;
    if (!session || sourceState.status !== 'connected') return;
    if (session.mediaType === 'video' && sourceState.source.classification === 'YouTube') {
      let originalVideoId: string | null = null;
      try { originalVideoId = getYouTubeVideoIdentity(session.sourceUrl).videoId; } catch { /* Invalid persisted source. */ }
      if (originalVideoId !== sourceState.source.videoId) {
        setMediaCaptureState({
          status: 'error',
          captureId: null,
          code: 'connected-source-changed',
          message: 'Reconnect the original video before recapturing this draft.',
        });
        return;
      }
      await startHostedCapture(session.operation, {
        kind: 'youtube',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.videoId,
      }, session.startMs, session.endMs);
    } else if (
      session.mediaType === 'audio' &&
      sourceState.source.classification === 'Podcast / web audio'
    ) {
      let originalAudioIdentity: string | null = null;
      try { originalAudioIdentity = getAudioSourceIdentity(session.sourceUrl).normalizedUrl; } catch { /* Invalid persisted source. */ }
      if (originalAudioIdentity !== sourceState.source.normalizedUrl) {
        setMediaCaptureState({
          status: 'error',
          captureId: null,
          code: 'connected-source-changed',
          message: 'Reconnect the original episode before recapturing this draft.',
        });
        return;
      }
      await startHostedCapture(session.operation, {
        kind: 'audio',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.normalizedUrl,
      }, session.startMs, session.endMs);
    }
  }, [hostedMediaSession, sourceState, startHostedCapture]);

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
      videoDraftState.startMs === null || sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'YouTube'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { playerReadState: 'reading' } });
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
      const execution = await chrome.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        func: playYouTubeVideoFrom,
        args: [videoDraftState.startMs / 1_000],
      });
      if (execution[0]?.result !== true) throw new Error('The YouTube player is unavailable.');
      dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { playerReadState: 'idle' } });
    } catch {
      dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { playerReadState: 'error' } });
    }
  }, [sourceState, videoDraftState.startMs]);

  const previewAudioDraft = useCallback(async () => {
    if (
      audioDraftState.startMs === null || sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { playerReadState: 'reading' } });
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
      const execution = await chrome.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        func: playAudioPageFrom,
        args: [audioDraftState.startMs / 1_000, sourceState.source.normalizedUrl],
      });
      const result = execution[0]?.result as { ok?: boolean } | undefined;
      if (result?.ok !== true) throw new Error('The connected page audio could not be controlled.');
      dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { playerReadState: 'idle' } });
    } catch {
      dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { playerReadState: 'error' } });
    }
  }, [audioDraftState.startMs, sourceState]);

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
            source: { ...state.source, audioDetectionResolved: true },
          };
        }
        return {
          status: 'connected',
          source: { ...state.source, audioDetectionResolved: true },
        };
      });
    }).catch(() => {
      if (!current) return;
      setSourceState((state) => state.status === 'connected' &&
        state.source.classification === 'Web page' && state.source.url === pageUrl
        ? { status: 'connected', source: { ...state.source, audioDetectionResolved: true } }
        : state);
    });
    return () => { current = false; };
  }, [sourceState]);

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
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'audio',
        sourceKey: draft.source.normalizedUrl,
        startMs: draft.startMs,
        endMs: draft.endMs,
        commentary: draft.commentary,
      });
    }
  }, [draftRestorationStatus, sourceState]);

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
      if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, HOSTED_MEDIA_SESSION_KEY)) {
        const value = changes[HOSTED_MEDIA_SESSION_KEY]?.newValue;
        const session = isHostedMediaSession(value) ? value : null;
        hostedMediaSessionRef.current = session;
        setHostedMediaSession(session);
        setMediaCaptureOperation(session?.operation ?? null);
      }
    };
    const runtimeMessage = (message: unknown) => {
      if (isActiveTabContextMessage(message)) {
        applyContext(message.context);
        return;
      }
      if (
        typeof message === 'object' && message !== null &&
        (message as { target?: unknown }).target === 'panel' &&
        (message as { type?: unknown }).type === MEDIA_CAPTURE_EVENT &&
        typeof (message as { snapshot?: unknown }).snapshot === 'object'
      ) {
        const event = message as { snapshot: CaptureSnapshot; operation?: unknown };
        const operation = event.operation as HostedMediaOperation | null;
        const session = hostedMediaSessionRef.current;
        if (session && operation &&
            operation.annotationId === session.operation.annotationId &&
            operation.mediaId === session.operation.mediaId) {
          setMediaCaptureOperation(operation);
          setMediaCaptureState(presentHostedMediaSnapshot(event.snapshot));
        }
      }
    };
    chrome.storage.onChanged.addListener(storageChange);
    chrome.runtime.onMessage.addListener(runtimeMessage);
    const restorationRevision = draftRevisionRef.current;
    void Promise.all([
      chrome.storage.session.get([
        ACTIVE_TAB_CONTEXT_KEY,
        ANNOTATION_DRAFT_STORAGE_KEY,
        YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
        AUDIO_CLIP_DRAFT_STORAGE_KEY,
        CREATE_MODE_SELECTION_STORAGE_KEY,
      ]),
      chrome.storage.local.get(HOSTED_MEDIA_SESSION_KEY),
    ])
      .then(([stored, localStored]) => {
        if (!mounted) return;
        const storedContext = isActiveTabContext(stored[ACTIVE_TAB_CONTEXT_KEY])
          ? stored[ACTIVE_TAB_CONTEXT_KEY]
          : null;
        const context = contextObservedRef.current ? connectedContextRef.current : storedContext;
        if (!contextObservedRef.current) {
          connectedContextRef.current = context;
          setSourceState(context ? getSourceState(context.title, context.url) : { status: 'not-connected' });
        }

        const storedModeSelectionValue = stored[CREATE_MODE_SELECTION_STORAGE_KEY];
        const storedModeSelection = deserializeCreateModeSelection(storedModeSelectionValue);
        storedModeSelectionRef.current = storedModeSelection;
        if (storedModeSelectionValue !== undefined && storedModeSelection === null) {
          void chrome.storage.session.remove(CREATE_MODE_SELECTION_STORAGE_KEY);
        }

        const storedDraftValue = stored[ANNOTATION_DRAFT_STORAGE_KEY];
        const draft = deserializeAnnotationDraft(storedDraftValue);
        draftRef.current = draft;
        if (shouldApplyDraftRestoration(restorationRevision, draftRevisionRef.current, draft, context)) {
          draftRef.current = draft;
          setCaptureState({ status: 'captured', data: draft.capture });
          dispatchCreateDraft({ type: 'set-text-commentary', commentary: draft.commentary });
        } else if (restorationRevision === draftRevisionRef.current && storedDraftValue !== undefined && draft === null) {
          void removePersistedDraft();
        }
        const storedYoutubeDraftValue = stored[YOUTUBE_CLIP_DRAFT_STORAGE_KEY];
        const youtubeDraft = deserializeYouTubeClipDraft(storedYoutubeDraftValue);
        youtubeDraftRef.current = youtubeDraft;
        if (
          restorationRevision === draftRevisionRef.current && youtubeDraft && context &&
          youtubeClipDraftBelongsToSource(youtubeDraft, context.url)
        ) {
          youtubeDraftRef.current = youtubeDraft;
          dispatchCreateDraft({
            type: 'restore-media',
            mode: 'video',
            sourceKey: youtubeDraft.source.videoId,
            startMs: youtubeDraft.startMs,
            endMs: youtubeDraft.endMs,
            commentary: youtubeDraft.commentary,
          });
        } else if (
          restorationRevision === draftRevisionRef.current &&
          storedYoutubeDraftValue !== undefined && youtubeDraft === null
        ) {
          void chrome.storage.session.remove(YOUTUBE_CLIP_DRAFT_STORAGE_KEY);
        }
        const storedAudioDraftValue = stored[AUDIO_CLIP_DRAFT_STORAGE_KEY];
        const audioDraft = deserializeAudioClipDraft(storedAudioDraftValue);
        audioDraftRef.current = audioDraft;
        if (
          restorationRevision === draftRevisionRef.current &&
          storedAudioDraftValue !== undefined && audioDraft === null
        ) {
          void chrome.storage.session.remove(AUDIO_CLIP_DRAFT_STORAGE_KEY);
        }
        const hostedSession = localStored[HOSTED_MEDIA_SESSION_KEY];
        if (isHostedMediaSession(hostedSession)) {
          hostedMediaSessionRef.current = hostedSession;
          setHostedMediaSession(hostedSession);
          setMediaCaptureOperation(hostedSession.operation);
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
    if (draftRestorationStatus !== 'ready') return;
    if (sourceState.status === 'loading' || sourceState.status === 'refreshing') {
      setModeSelection((current) => current
        ? moveSelectionToPage(current, current.page, modeCapabilities)
        : current);
      return;
    }
    const context = connectedContextRef.current;
    if (sourceState.status !== 'connected' || !context) {
      setModeSelection(null);
      return;
    }
    const sourceKey = getCreatePageSourceKey(context.url);
    if (!sourceKey) {
      setModeSelection(null);
      return;
    }
    const page = updatePageGeneration(createPageRef.current, {
      tabId: context.tabId,
      windowId: context.windowId,
      sourceKey,
    });
    createPageRef.current = page;
    setModeSelection((current) => {
      let next = current
        ? moveSelectionToPage(current, page, modeCapabilities)
        : createModeSelectionState(page, modeCapabilities);
      const stored = storedModeSelectionRef.current;
      if (
        stored &&
        storedCreateModeSelectionMatches(stored, page.identity) &&
        modeCapabilities[stored.selectedMode].status === 'available'
      ) {
        next = selectCreateMode(next, stored.selectedMode);
      }
      return next;
    });
  }, [draftRestorationStatus, modeCapabilities, sourceState]);

  useEffect(() => {
    const previous = previousModeSelectionRef.current;
    previousModeSelectionRef.current = modeSelection;
    if (!previous || !modeSelection) return;
    if (previous.page.generation !== modeSelection.page.generation) {
      setModeAnnouncement('');
      return;
    }
    const previousMode = previous.selectedMode;
    const previousCapability = previousMode
      ? modeSelection.capabilities[previousMode]
      : null;
    if (
      previousMode &&
      previousMode !== modeSelection.selectedMode &&
      previousCapability?.status === 'unavailable'
    ) {
      const nextLabel = modeSelection.selectedMode
        ? CREATE_MODE_LABELS[modeSelection.selectedMode]
        : 'no mode';
      setModeAnnouncement(
        `${CREATE_MODE_LABELS[previousMode]} is unavailable. Switched to ${nextLabel}. ${previousCapability.reason}`,
      );
      const stored = storedModeSelectionRef.current;
      if (stored && storedCreateModeSelectionMatches(stored, modeSelection.page.identity)) {
        storedModeSelectionRef.current = null;
        void chrome.storage.session.remove(CREATE_MODE_SELECTION_STORAGE_KEY);
      }
    } else if (
      previous.selectedMode === modeSelection.selectedMode &&
      previous.capabilities !== modeSelection.capabilities
    ) {
      setModeAnnouncement('');
    }
  }, [modeSelection]);

  useEffect(() => {
    if (!supabase || authState.status !== 'signed-in' || !hostedMediaSession) return;
    let current = true;
    void Promise.all([
      getOwnedHostedMediaStatus(supabase, hostedMediaSession.operation.annotationId),
      chrome.runtime.sendMessage({ target: 'background', type: MEDIA_CAPTURE_STATUS })
        .catch(() => null) as Promise<{
          snapshot?: CaptureSnapshot;
          operation?: HostedMediaOperation | null;
        } | null>,
    ]).then(([owned, live]) => {
      if (!current) return;
      const result = reconcileHostedMediaState(
        hostedMediaSession,
        owned,
        live?.snapshot ?? null,
        live?.operation ?? null,
      );
      if (result.action === 'clear') {
        hostedMediaSessionRef.current = null;
        setHostedMediaSession(null);
        setMediaCaptureOperation(null);
        void chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
      } else {
        setMediaCaptureOperation(live?.operation ?? hostedMediaSession.operation);
        setMediaCaptureState(result.snapshot);
      }
    }).catch(() => {
      if (current) setMediaCaptureState({
        status: 'error',
        captureId: null,
        code: 'unexpected',
        message: 'The hosted-media status could not be restored.',
      });
    });
    return () => { current = false; };
  }, [authState.status, hostedMediaSession, supabase]);

  useEffect(() => {
    if (!supabase || authState.status !== 'signed-in' || !hostedMediaSession ||
        mediaCaptureState.status !== 'verifying-upload') return;
    let current = true;
    void getOwnedHostedMediaStatus(supabase, hostedMediaSession.operation.annotationId)
      .then((owned) => {
        if (!current) return;
        const result = reconcileHostedMediaState(
          hostedMediaSession,
          owned,
          mediaCaptureState,
          mediaCaptureOperation,
        );
        if (result.action === 'clear') {
          hostedMediaSessionRef.current = null;
          setHostedMediaSession(null);
          setMediaCaptureOperation(null);
          void chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
        } else {
          setMediaCaptureState(result.snapshot);
        }
      })
      .catch(() => {
        if (current) setMediaCaptureState({
          status: 'error',
          captureId: mediaCaptureState.captureId,
          code: 'completion-failed',
          message: 'The upload finished locally, but the owner-visible queued state could not be confirmed. Refresh or cancel this draft.',
        });
      });
    return () => { current = false; };
  }, [authState.status, hostedMediaSession, mediaCaptureOperation, mediaCaptureState, supabase]);

  useEffect(() => {
    if (!refreshSuccess) return;
    const timer = window.setTimeout(() => setRefreshSuccess(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [refreshSuccess]);

  const changeCommentary = (value: string) => {
    draftRevisionRef.current += 1;
    dispatchCreateDraft({ type: 'set-text-commentary', commentary: value });
    const draft = draftRef.current;
    if (!draft) return;
    const updatedDraft = updateAnnotationDraftCommentary(draft, value);
    if (updatedDraft) persistDraft(updatedDraft);
  };

  const chooseCreateMode = (mode: CreateMode) => {
    if (!modeSelection) return;
    const next = selectCreateMode(modeSelection, mode);
    if (next === modeSelection) return;
    setModeSelection(next);
    const stored = serializeCreateModeSelection(next.page.identity, mode);
    storedModeSelectionRef.current = stored;
    void chrome.storage.session
      .set({ [CREATE_MODE_SELECTION_STORAGE_KEY]: stored })
      .catch(() => console.warn('Unable to save the selected Create mode.'));
    setModeAnnouncement(`${CREATE_MODE_LABELS[mode]} mode selected.`);
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
  const connectedContext = sourceState.status === 'connected' ? connectedContextRef.current : null;
  const selectedCreateMode = modeSelection?.selectedMode ?? null;
  const textDraftAttached = Boolean(
    draftRef.current && connectedContext && annotationDraftBelongsToContext(draftRef.current, connectedContext),
  );
  const videoDraftAttached = Boolean(
    youtubeDraftRef.current && youtubeSource &&
    youtubeClipDraftBelongsToSource(youtubeDraftRef.current, youtubeSource.url),
  );
  const audioDraftAttached = Boolean(
    audioDraftRef.current && audioSource &&
    audioClipDraftBelongsToSource(audioDraftRef.current, audioSource.url, audioSource.canonicalUrl),
  );
  const detachedDraftModes: Record<CreateMode, boolean> = {
    text: draftRef.current !== null && !textDraftAttached,
    video: youtubeDraftRef.current !== null && !videoDraftAttached,
    audio: audioDraftRef.current !== null && !audioDraftAttached,
  };
  const savedDraftModes: Record<CreateMode, boolean> = {
    text: draftRef.current !== null || hasCreateModeDraft(createDraftState, 'text'),
    video: youtubeDraftRef.current !== null || hasCreateModeDraft(createDraftState, 'video'),
    audio: audioDraftRef.current !== null || hasCreateModeDraft(createDraftState, 'audio'),
  };
  const modeStatusMessage = modeAnnouncement || getModeCapabilitySummary(modeSelection);
  const discardSelectedDetachedDraft = () => {
    if (selectedCreateMode === 'text') {
      void clearDraft('explicit-clear');
    } else if (selectedCreateMode === 'video') {
      void clearYoutubeDraft();
    } else if (selectedCreateMode === 'audio') {
      void clearAudioDraft();
    }
  };
  const videoClipRangeError = getNewMediaPublicationRangeError(
    videoDraftState.startMs,
    videoDraftState.endMs,
    videoDraftState.durationMs,
  );
  const audioClipRangeError = getNewMediaPublicationRangeError(
    audioDraftState.startMs,
    audioDraftState.endMs,
    audioDraftState.durationMs,
  );
  const canPublishYoutube = authState.status === 'signed-in' && youtubeSource !== null &&
    videoClipRangeError === null && videoDraftState.commentary.trim().length > 0 &&
    videoDraftState.commentary.length <= 2_000 && youtubePublishState.status !== 'publishing' &&
    hostedMediaSession === null;
  const canPublishAudio = authState.status === 'signed-in' && audioSource !== null &&
    audioDraftState.durationMs !== null && audioClipRangeError === null &&
    audioDraftState.commentary.trim().length > 0 &&
    audioDraftState.commentary.length <= 2_000 && audioPublishState.status !== 'publishing' &&
    hostedMediaSession === null;
  const hostedMediaPanel = hostedMediaSession ? (
    <div className="compact-state hosted-media-progress" role="status">
      <strong>
        {isCancellingHostedMedia
          ? 'Cancelling draft…'
          : mediaCaptureState.status === 'uploading'
          ? `Uploading clip… ${mediaCaptureState.progress}%`
          : mediaCaptureState.status === 'waiting-to-upload'
            ? 'Waiting to upload—keep Chrome open'
            : mediaCaptureState.status === 'verifying-upload'
              ? 'Confirming uploaded clip…'
            : mediaCaptureState.status === 'processing'
              ? 'Processing clip'
              : mediaCaptureState.status === 'error'
                ? 'Capture needs attention'
                : mediaCaptureState.status === 'stopping'
                  ? 'Finishing capture…'
                  : mediaCaptureState.status === 'capturing'
                    ? 'Capturing clip…'
                    : 'Preparing capture…'}
      </strong>
      {mediaCaptureState.status === 'waiting-to-upload' && <span>{mediaCaptureState.message}</span>}
      {mediaCaptureState.status === 'verifying-upload' && <span>Checking the owner-visible server state before showing Processing.</span>}
      {mediaCaptureState.status === 'processing' && <span>Uploaded and queued. Processing is not available until the media worker ships.</span>}
      {mediaCaptureState.status === 'error' && <span>{mediaCaptureState.message}</span>}
      {mediaCaptureState.status === 'waiting-to-upload' && !isCancellingHostedMedia && (
        <button className="button button-secondary" type="button" onClick={() => void retryHostedUpload()}>Retry upload</button>
      )}
      {mediaCaptureState.status === 'error' && mediaCaptureState.code !== 'upload-failed' &&
          mediaCaptureState.code !== 'raw-capture-unavailable' && !isCancellingHostedMedia && (
        <button className="button button-secondary" type="button" onClick={() => void recaptureHostedMedia()}>Recapture</button>
      )}
      <button className="text-button" type="button" disabled={isCancellingHostedMedia}
        onClick={() => void cancelHostedMedia()}>Cancel draft</button>
    </div>
  ) : null;
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
          <span className="view-title">{currentScreen.kind === 'annotation' || currentScreen.kind === 'comments' ? 'Annotation' : currentScreen.kind === 'profile' ? 'Creator' : currentScreen.view === 'context' ? 'Create' : currentScreen.view === 'feed' ? 'Feed' : 'Account'}</span>
        </div>
        <nav className="top-tabs" aria-label="Primary">
          {(['context', 'feed', 'account'] as const).map((view) => <button key={view} type="button" className={currentScreen.kind === 'root' && currentScreen.view === view ? 'active' : ''} aria-current={currentScreen.kind === 'root' && currentScreen.view === view ? 'page' : undefined} onClick={() => selectRoot(view)}>{view === 'context' ? 'Create' : view === 'account' ? 'Me' : 'Feed'}</button>)}
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
          <header className="view-intro create-intro"><span className="section-label">New annotation</span><h1>Create</h1><p>Choose Text, Video, or Audio without losing work in another mode.</p></header>
          <fieldset className="create-mode-switcher">
            <legend>Create mode</legend>
            <div className="create-mode-options">
              {CREATE_MODES.map((mode) => {
                const capability = modeSelection?.capabilities[mode] ?? modeCapabilities[mode];
                const selected = selectedCreateMode === mode;
                const unavailable = capability.status !== 'available';
                const stateLabel = capability.status === 'checking'
                  ? 'Checking…'
                  : capability.status === 'unavailable'
                    ? 'Unavailable'
                    : !selected && savedDraftModes[mode]
                      ? 'Draft saved'
                      : modeSelection?.recommendedMode === mode
                        ? 'Recommended'
                        : 'Available';
                return (
                  <label className={`create-mode-option${selected ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`} key={mode}>
                    <input type="radio" name="create-mode" value={mode} checked={selected} disabled={unavailable} onChange={() => chooseCreateMode(mode)} />
                    <span className="create-mode-label">{CREATE_MODE_LABELS[mode]}</span>
                    <span className="create-mode-state">{stateLabel}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="create-mode-status" role="status" aria-live="polite">{modeStatusMessage}</p>
          <section className="context-source"><SourceSummary state={sourceState} /><div className="source-actions"><button className="button button-secondary button-small" type="button" onClick={() => void loadSource()} disabled={isRefreshing || isCapturing}>{isRefreshing ? 'Refreshing…' : 'Refresh source'}</button>{refreshSuccess && <span role="status">Source updated</span>}</div></section>
          {selectedCreateMode && detachedDraftModes[selectedCreateMode] ? (
            <div className="compact-state detached-draft" role="status"><strong>{CREATE_MODE_LABELS[selectedCreateMode]} draft saved</strong><span>This draft belongs to another connected source. Return to that source to continue, or discard it to start here.</span><button className="button button-secondary" type="button" onClick={discardSelectedDetachedDraft}>Discard {CREATE_MODE_LABELS[selectedCreateMode]} draft and start here</button></div>
          ) : selectedCreateMode === 'video' && youtubeSource ? (
            <section className="create-panel youtube-clip-panel" aria-labelledby="create-heading">
              <div className="section-heading"><h2 id="create-heading">Create clip</h2><span>YouTube time range</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this video for unpublished work…</span></div> : <>
                <p className="create-help">Play the connected video, set the start, continue watching, then set the end.</p>
                <dl className="clip-time-grid">
                  <div><dt>START</dt><dd>{videoDraftState.startMs === null ? '--:--' : formatMediaTime(videoDraftState.startMs)}</dd></div>
                  <div><dt>END</dt><dd>{videoDraftState.endMs === null ? '--:--' : formatMediaTime(videoDraftState.endMs)}</dd></div>
                  <div><dt>LENGTH</dt><dd>{videoDraftState.startMs === null || videoDraftState.endMs === null || videoDraftState.endMs <= videoDraftState.startMs ? '--:--' : formatMediaTime(videoDraftState.endMs - videoDraftState.startMs)}</dd></div>
                </dl>
                {videoDraftState.playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTime(videoDraftState.playerTimeMs)}</strong>{videoDraftState.durationMs !== null && <> / {formatMediaTime(videoDraftState.durationMs)}</>}</p>}
                <div className="clip-control-row"><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('start')} disabled={videoDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>Set start</button><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('end')} disabled={videoDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>Set end</button><button className="text-button" type="button" onClick={() => void readConnectedPlayer('refresh')} disabled={videoDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>{videoDraftState.playerReadState === 'reading' ? 'Reading…' : 'Refresh time'}</button></div>
                {videoDraftState.startMs !== null && <button className="button button-secondary preview-clip" type="button" onClick={() => void previewYoutubeDraft()} disabled={videoDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>Preview from start</button>}
                {videoDraftState.startMs !== null && videoDraftState.endMs !== null && videoClipRangeError && <p className="inline-error" role="alert">{videoClipRangeError}</p>}
                {videoDraftState.playerReadState === 'error' && <p className="inline-error" role="alert">The current YouTube player time could not be read. Reconnect the video and try again.</p>}
                <div className="annotation-field"><label htmlFor="youtube-commentary">Your commentary <span aria-hidden="true">*</span></label><textarea id="youtube-commentary" value={videoDraftState.commentary} maxLength={2_000} rows={6} required disabled={hostedMediaSession !== null} onChange={(event) => changeYoutubeCommentary(event.target.value)} /><span aria-live="polite">{videoDraftState.commentary.length.toLocaleString()} / 2,000</span></div>
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearYoutubeDraft()} disabled={youtubePublishState.status === 'publishing' || hostedMediaSession !== null}>Clear clip</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishYoutubeClip()} disabled={!canPublishYoutube}>{youtubePublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button>}</div>
                {youtubePublishState.status === 'error' && <p className="inline-error" role="alert">{youtubePublishState.message}</p>}
              </>}
            </section>
          ) : selectedCreateMode === 'audio' && audioSource ? (
            <section className="create-panel audio-clip-panel" aria-labelledby="create-heading">
              <div className="section-heading"><h2 id="create-heading">Create audio clip</h2><span>Podcast / web audio</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this episode for unpublished work…</span></div> : <>
                <p className="create-help">Play the connected page audio, set the start, continue listening, then set the end.</p>
                {(audioSource.playerStatus === 'duration-unavailable' || audioSource.playerStatus === 'current-time-unavailable') && <div className="compact-state" role="status"><strong>Audio player detected</strong><span>Play the episode to initialize playback timing.</span></div>}
                {audioSource.playerStatus === 'ambiguous' && <div className="compact-state compact-state-error" role="status"><strong>Choose the episode player</strong><span>Annotated found multiple equally eligible audio players. Pause all but the episode player, then use Refresh time.</span></div>}
                {audioSource.playerStatus === 'unavailable' && <div className="compact-state compact-state-error" role="status"><strong>Audio player unavailable</strong><span>The previously detected top-level audio player can no longer be read. Reload the page player, then use Refresh time.</span></div>}
                <dl className="clip-time-grid">
                  <div><dt>START</dt><dd>{audioDraftState.startMs === null ? '--:--' : formatMediaTime(audioDraftState.startMs)}</dd></div>
                  <div><dt>END</dt><dd>{audioDraftState.endMs === null ? '--:--' : formatMediaTime(audioDraftState.endMs)}</dd></div>
                  <div><dt>LENGTH</dt><dd>{audioDraftState.startMs === null || audioDraftState.endMs === null || audioDraftState.endMs <= audioDraftState.startMs ? '--:--' : formatMediaTime(audioDraftState.endMs - audioDraftState.startMs)}</dd></div>
                </dl>
                {audioDraftState.playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTime(audioDraftState.playerTimeMs)}</strong>{audioDraftState.durationMs !== null && <> / {formatMediaTime(audioDraftState.durationMs)}</>}</p>}
                <div className="clip-control-row"><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('start')} disabled={audioDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>Set start</button><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('end')} disabled={audioDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>Set end</button><button className="text-button" type="button" onClick={() => void readConnectedPlayer('refresh')} disabled={audioDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>{audioDraftState.playerReadState === 'reading' ? 'Reading…' : 'Refresh time'}</button></div>
                {audioDraftState.startMs !== null && <button className="button button-secondary preview-clip" type="button" onClick={() => void previewAudioDraft()} disabled={audioDraftState.playerReadState === 'reading' || hostedMediaSession !== null}>Preview / Jump to start</button>}
                {audioDraftState.startMs !== null && audioDraftState.endMs !== null && audioClipRangeError && <p className="inline-error" role="alert">{audioClipRangeError}</p>}
                {audioDraftState.playerReadState === 'error' && <p className="inline-error" role="alert">The page audio player disappeared or its current time could not be read. Reconnect the episode and try again.</p>}
                <div className="annotation-field"><label htmlFor="audio-clip-commentary">Your commentary <span aria-hidden="true">*</span></label><textarea id="audio-clip-commentary" value={audioDraftState.commentary} maxLength={2_000} rows={6} required disabled={hostedMediaSession !== null} onChange={(event) => changeAudioCommentary(event.target.value)} /><span aria-live="polite">{audioDraftState.commentary.length.toLocaleString()} / 2,000</span></div>
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearAudioDraft()} disabled={audioPublishState.status === 'publishing' || hostedMediaSession !== null}>Clear clip</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAudioClip()} disabled={!canPublishAudio}>{audioPublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button>}</div>
                {audioPublishState.status === 'error' && <p className="inline-error" role="alert">{audioPublishState.message}</p>}
              </>}
            </section>
          ) : selectedCreateMode === 'text' ? (
            <section className="create-panel" aria-labelledby="create-heading"><div className="section-heading"><h2 id="create-heading">Create annotation</h2><span>Article text</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this source for unpublished work…</span></div> : captured ? <><blockquote className="captured-passage">{captured.selectedText}</blockquote><dl className="capture-metadata">{captured.author && <div><dt>Author</dt><dd>{captured.author}</dd></div>}{captured.publisher && <div><dt>Publisher</dt><dd>{captured.publisher}</dd></div>}<div><dt>Source</dt><dd>{captured.hostname}</dd></div></dl><div className="annotation-field"><label htmlFor="annotation-commentary">Your commentary</label><textarea id="annotation-commentary" value={commentary} maxLength={2_000} rows={6} onChange={(event) => changeCommentary(event.target.value)} /><span aria-live="polite">{commentary.length.toLocaleString()} / 2,000</span></div><AudioRecorder controller={audioRecorder} disabled={publishState.status === 'publishing'} /><div className="create-actions"><button className="button button-secondary" type="button" onClick={clearCapture} disabled={publishState.status === 'publishing'}>Clear capture</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginGoogleSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAnnotation()} disabled={!canPublish}>{publishState.status === 'publishing' ? 'Publishing…' : 'Publish annotation'}</button>}</div>{publishState.status === 'error' && <p className="inline-error" role="alert">{publishState.message}</p>}</> : <><p className="create-help">Highlight article text in the connected page, then capture it here. Selections and commentary may contain up to 2,000 characters each.</p><button className="button button-primary" type="button" onClick={() => void captureSelection()} disabled={sourceState.status !== 'connected' || isCapturing}>{isCapturing ? 'Capturing…' : 'Capture selected text'}</button>{(captureState.status === 'recoverable-error' || captureState.status === 'reconnect-required' || captureState.status === 'unexpected-error') && <p className="inline-error" role="alert">{captureState.message}</p>}</>}
            </section>
          ) : (
            <div className="compact-state" role="status"><strong>Choose an available mode</strong><span>Annotated is checking the connected page for supported creation options.</span></div>
          )}
          {hostedMediaPanel}
          {supabase && contextUrl && contextCacheKey && <AnnotationCollection key={contextCacheKey} supabase={supabase} cache={socialCacheRef.current} cacheKey={contextCacheKey} sourceUrl={audioSource?.normalizedUrl ?? contextUrl} navigation={navigationCallbacks} emptyTitle={youtubeSource ? 'No clips on this video yet' : audioSource ? 'No clips on this episode yet' : 'Be the first to annotate this source'} emptyMessage={youtubeSource ? 'Create the first public time-coded annotation below.' : audioSource ? 'Create the first public audio clip below.' : 'Capture a passage below to add the first public annotation.'} compactHeading={youtubeSource ? 'Clips on this video' : audioSource ? 'Clips on this episode' : 'On this source'} />}
        </div>
      )}
    </main>
  );
}

export default App;
