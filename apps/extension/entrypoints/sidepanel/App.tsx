import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { normalizeArticleUrl, ArticleUrlNormalizationError } from '@annotated/shared/url-normalization';
import {
  formatMediaTime,
  getNewMediaPublicationRangeError,
} from '@annotated/shared/media-time';
import { formatMediaTimeTenths, getMediaRangeDisplay } from '../../utils/media-time-display';
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
import {
  clearLocalAuthSession,
  EXTENSION_AUTH_CAPABILITIES,
  ExtensionAuthError,
  signInWithProvider,
  type AuthProvider,
  userHasEnabledAuthProvider,
} from '../../utils/auth-boundary';
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
  createModeAsyncToken,
  deserializeCreateModeSelection,
  hasCreateModeDraft,
  moveSelectionToPage,
  reduceCreateDraftState,
  selectCreateMode,
  serializeCreateModeSelection,
  isModeAsyncTokenCurrent,
  storedCreateModeSelectionMatches,
  updatePageGeneration,
  type CreateMode,
  type CreateDraftState,
  type CreatePageGeneration,
  type MediaCreateMode,
  type ModeRevisionState,
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
  WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY,
  deserializeWebVideoClipDraft,
  serializeWebVideoClipDraft,
  webVideoClipDraftBelongsToSource,
  type WebVideoClipDraft,
} from '../../utils/web-video-draft';
import {
  extractYouTubePageMetadata,
  normalizeYouTubeVideoTitle,
  validateYouTubePageMetadata,
} from '../../utils/youtube-page';
import {
  actOnTopFramePlayer,
  readTopFramePlayerDiscovery,
  playerDiscoveryMakesModeAvailable,
  reconcilePlayerSelection,
  validatePlayerDiscovery,
  type PlayerDiscovery,
  type PlayerMode,
} from '../../utils/player-discovery';
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
import {
  createHostedAttemptToken,
  createModeSwitchIntent,
  createPlayerActionToken,
  deriveOperationGuardState,
  getModeSwitchGuard,
  hostedAttemptTokenIsCurrent,
  modeSwitchIntentIsCurrent,
  operationLocksMediaEditor,
  playerActionTokenIsCurrent,
  type HostedAttemptToken,
  type ModeSwitchIntent,
  type PlayerActionToken,
} from '../../utils/operation-guards';
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
  videoDetectionResolved: boolean;
  videoAvailable: boolean;
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

type AudioVideoPageSource = AudioPageSource & {
  videoDetectionResolved: boolean;
  videoAvailable: boolean;
};

type PageSource = ArticlePageSource | YouTubePageSource | AudioVideoPageSource;

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

type PlayerDiscoveryState = PlayerDiscovery & { pageGeneration: number | null };

const EMPTY_PLAYER_DISCOVERY: PlayerDiscoveryState = {
  status: 'none', candidates: [], pageGeneration: null,
};

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
        videoDetectionResolved: false,
        videoAvailable: false,
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

function CreateModeIcon({ mode }: { mode: CreateMode }) {
  if (mode === 'video') {
    return (
      <svg className="create-mode-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M2.4 3.6h7.4a1 1 0 0 1 1 1v1.9l2.8-1.6v6.2l-2.8-1.6v1.9a1 1 0 0 1-1 1H2.4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
      </svg>
    );
  }
  if (mode === 'audio') {
    return (
      <svg className="create-mode-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M8 2.6a3.4 3.4 0 0 1 3.4 3.4v1.8a3.4 3.4 0 1 1-6.8 0V6A3.4 3.4 0 0 1 8 2.6zm-5 5.2h1.3a3.7 3.7 0 0 0 7.4 0H13a5 5 0 0 1-4.2 4.85V14h-1.6v-1.35A5 5 0 0 1 3 7.8z" />
      </svg>
    );
  }
  return (
    <svg className="create-mode-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M3 3.5h10v1.2H3zm0 2.6h10v1.2H3zm0 2.6h7.2v1.2H3z" />
    </svg>
  );
}

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
      video: sourceState.source.videoDetectionResolved
        ? sourceState.source.videoAvailable
          ? { status: 'available' }
          : { status: 'unavailable', reason: 'No safe readable webpage video was found.' }
        : { status: 'checking' },
      audio: { status: 'available' },
    };
  }
  return {
    text: { status: 'available' },
    video: sourceState.source.videoDetectionResolved
      ? sourceState.source.videoAvailable
        ? { status: 'available' }
        : { status: 'unavailable', reason: 'No safe readable webpage video was found.' }
      : { status: 'checking' },
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

function PlayerSelector({
  mode,
  discovery,
  selectedIdentity,
  disabled,
  onSelect,
}: {
  mode: PlayerMode;
  discovery: PlayerDiscoveryState;
  selectedIdentity: string | null;
  disabled: boolean;
  onSelect: (identity: string) => void;
}) {
  const label = mode === 'video' ? 'video' : 'audio';
  if (discovery.status === 'overflow') {
    return <div className="compact-state compact-state-error" role="status"><strong>Too many {label} players</strong><span>Annotated found more than five eligible players. Close extra players or use a page with five or fewer, then refresh the source.</span></div>;
  }
  if (discovery.status === 'none') {
    return <div className="compact-state compact-state-error" role="status"><strong>No usable {label} player</strong><span>Start or load the intended top-level player, then refresh the source.</span></div>;
  }
  if (discovery.candidates.length === 1) {
    const candidate = discovery.candidates[0]!;
    return <p className="single-player-status" role="status">Using {candidate.label} · {candidate.status}</p>;
  }
  return (
    <fieldset className="player-selector">
      <legend>Choose {label} player</legend>
      <p className="player-set-status" role="status" aria-live="polite">{discovery.candidates.length} eligible {label} players. {selectedIdentity ? 'Selection ready.' : 'Choose one to continue.'}</p>
      <div className="player-options">
        {discovery.candidates.map((candidate, index) => (
          <label className={`player-option${candidate.identity === selectedIdentity ? ' selected' : ''}`} key={candidate.identity}>
            <input
              type="radio"
              name={`${mode}-player`}
              value={candidate.identity}
              checked={candidate.identity === selectedIdentity}
              disabled={disabled}
              onChange={() => onSelect(candidate.identity)}
            />
            <span className="player-option-label">{candidate.label}</span>
            <span className="player-option-state">{index + 1} of {discovery.candidates.length} · {candidate.kind} · {candidate.status}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function getDraftRevisions(state: CreateDraftState): ModeRevisionState {
  return {
    text: state.text.revision,
    video: state.video.revision,
    audio: state.audio.revision,
  };
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
  const [hostedBeginMode, setHostedBeginMode] = useState<MediaCreateMode | null>(null);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<ModeSwitchIntent | null>(null);
  const [videoPlayers, setVideoPlayers] = useState<PlayerDiscoveryState>(EMPTY_PLAYER_DISCOVERY);
  const [audioPlayers, setAudioPlayers] = useState<PlayerDiscoveryState>(EMPTY_PLAYER_DISCOVERY);
  const [playerDiscoveryRevision, setPlayerDiscoveryRevision] = useState(0);
  const hostedMediaSessionRef = useRef<HostedMediaSession | null>(null);
  const hostedBeginModeRef = useRef<MediaCreateMode | null>(null);
  const activeCaptureIdRef = useRef<string | null>(null);
  const cancellingHostedMediaRef = useRef(false);
  const modeSwitchDialogRef = useRef<HTMLDialogElement | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [navigation, dispatchNavigation] = useReducer(reduceNavigation, INITIAL_NAVIGATION);
  const connectedContextRef = useRef<ActiveTabContext | null>(null);
  const contextObservedRef = useRef(false);
  const captureRevisionRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const draftRef = useRef<AnnotationDraft | null>(null);
  const youtubeDraftRef = useRef<YouTubeClipDraft | null>(null);
  const webVideoDraftRef = useRef<WebVideoClipDraft | null>(null);
  const audioDraftRef = useRef<AudioClipDraft | null>(null);
  const createPageRef = useRef<CreatePageGeneration | null>(null);
  const createDraftStateRef = useRef<CreateDraftState>(createDraftState);
  const modeSelectionRef = useRef<ModeSelectionState | null>(modeSelection);
  const storedModeSelectionRef = useRef<StoredCreateModeSelection | null>(null);
  const previousModeSelectionRef = useRef<ModeSelectionState | null>(null);
  const playerIdentityRef = useRef<{ video: string | null; audio: string | null }>({ video: null, audio: null });
  const authRevisionRef = useRef(0);
  const authMountedRef = useRef(false);
  const publishInFlightRef = useRef(false);
  const socialCacheRef = useRef<SessionSocialCache>(new Map());
  const audioRecorder = useAudioRecorder();

  const commentary = createDraftState.text.commentary;
  const videoDraftState = createDraftState.video;
  const audioDraftState = createDraftState.audio;
  createDraftStateRef.current = createDraftState;
  modeSelectionRef.current = modeSelection;
  playerIdentityRef.current = {
    video: videoDraftState.playerIdentity,
    audio: audioDraftState.playerIdentity,
  };
  const modeCapabilities = useMemo(() => getModeCapabilities(sourceState), [sourceState]);
  const operationGuardState = useMemo(() => deriveOperationGuardState({
    articlePublishing: publishState.status === 'publishing',
    hostedBeginMode,
    hostedSession: hostedMediaSession,
    capture: mediaCaptureState,
    cancelling: isCancellingHostedMedia,
  }), [hostedBeginMode, hostedMediaSession, isCancellingHostedMedia, mediaCaptureState, publishState.status]);
  const mediaEditorLocked = operationLocksMediaEditor(operationGuardState);

  const currentScreen = getCurrentScreen(navigation);
  const currentUserId = authState.status === 'signed-in' ? authState.account.id : null;

  const getPlayerActionToken = useCallback((mode: PlayerMode, identity: string | null) => {
    const page = createPageRef.current;
    const draft = createDraftStateRef.current[mode];
    if (!page || !identity || draft.playerIdentity !== identity) {
      throw new Error('Choose a player first.');
    }
    return createPlayerActionToken(page, mode, draft.revision, identity);
  }, []);

  const playerTokenIsCurrent = useCallback((token: PlayerActionToken) => {
    return playerActionTokenIsCurrent(
      token,
      createPageRef.current,
      createDraftStateRef.current[token.mode],
    );
  }, []);

  const persistYoutubeDraft = useCallback((
    sourceUrl: string,
    startMs: number | null,
    endMs: number | null,
    text: string,
  ) => {
    try {
      const draft = serializeYouTubeClipDraft(sourceUrl, startMs, endMs, text);
      youtubeDraftRef.current = draft;
      webVideoDraftRef.current = null;
      void chrome.storage.session
        .set({ [YOUTUBE_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove(WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY))
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

  const persistWebVideoDraft = useCallback((
    sourceUrl: string,
    startMs: number | null,
    endMs: number | null,
    text: string,
  ) => {
    try {
      const draft = serializeWebVideoClipDraft(sourceUrl, startMs, endMs, text);
      webVideoDraftRef.current = draft;
      youtubeDraftRef.current = null;
      void chrome.storage.session.set({ [WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove(YOUTUBE_CLIP_DRAFT_STORAGE_KEY))
        .catch(() => console.warn('Unable to save the webpage video draft.'));
    } catch { /* Invalid transient input is never persisted. */ }
  }, []);

  const clearWebVideoDraft = useCallback(async () => {
    webVideoDraftRef.current = null;
    dispatchCreateDraft({ type: 'reset-mode', mode: 'video' });
    setYoutubePublishState({ status: 'idle' });
    try { await chrome.storage.session.remove(WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY); }
    catch { console.warn('Unable to clear the webpage video draft.'); }
  }, []);

  const clearVideoDraft = useCallback(async () => {
    const source = sourceState.status === 'connected' ? sourceState.source : null;
    if (source?.classification === 'YouTube' && youtubeDraftRef.current) await clearYoutubeDraft();
    else if (source?.classification !== 'YouTube' && webVideoDraftRef.current) await clearWebVideoDraft();
    else if (youtubeDraftRef.current) await clearYoutubeDraft();
    else await clearWebVideoDraft();
  }, [clearWebVideoDraft, clearYoutubeDraft, sourceState]);

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
    if (!userHasEnabledAuthProvider(user, EXTENSION_AUTH_CAPABILITIES)) {
      await clearLocalAuthSession(supabase);
      if (authMountedRef.current && revision === authRevisionRef.current) {
        setAuthState({ status: 'error', message: 'The authenticated account did not match an available sign-in method.' });
      }
      return;
    }
    const next = await verifyProfile(supabase, user);
    if (authMountedRef.current && revision === authRevisionRef.current) setAuthState(next);
  }, [supabase]);

  const lastAuthProviderRef = useRef<AuthProvider>('google');

  const beginSignIn = useCallback(async (provider: AuthProvider = 'google') => {
    if (!supabase) {
      setAuthState({ status: 'error', message: import.meta.env.DEV ? 'Supabase is not configured. Check apps/extension/.env.local.' : 'Authentication is temporarily unavailable.' });
      return;
    }
    lastAuthProviderRef.current = provider;
    setAuthState({ status: 'signing-in' });
    try {
      await applyAuthenticatedUser(await signInWithProvider(supabase, provider));
    } catch (error) {
      const message = error instanceof ExtensionAuthError ? error.message : 'Sign-in could not be completed. Please try again.';
      if (authMountedRef.current) setAuthState({ status: 'error', message });
    }
  }, [applyAuthenticatedUser, supabase]);

  const retryAuthentication = useCallback(async () => {
    if (!supabase) { void beginSignIn(); return; }
    setAuthState({ status: 'loading' });
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user) await applyAuthenticatedUser(data.session.user);
      else await beginSignIn(lastAuthProviderRef.current);
    } catch {
      await clearLocalAuthSession(supabase);
      if (authMountedRef.current) setAuthState({ status: 'error', message: 'Authentication could not be restored. Please try again.' });
    }
  }, [applyAuthenticatedUser, beginSignIn, supabase]);

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
    const webVideoDraft = webVideoDraftRef.current;
    if (webVideoDraft && context && webVideoClipDraftBelongsToSource(webVideoDraft, context.url)) {
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'video',
        sourceKey: webVideoDraft.source.normalizedUrl,
        startMs: webVideoDraft.startMs,
        endMs: webVideoDraft.endMs,
        commentary: webVideoDraft.commentary,
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
    const page = createPageRef.current;
    if (!page) return;
    const token = createModeAsyncToken(page, getDraftRevisions(createDraftStateRef.current), 'text');
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
      const currentPage = createPageRef.current;
      if (!currentPage || !isModeAsyncTokenCurrent(
        token,
        currentPage,
        getDraftRevisions(createDraftStateRef.current),
      )) {
        setPublishState({ status: 'idle' });
        return;
      }
      await clearDraft('publish-succeeded');
      socialCacheRef.current.clear();
      dispatchNavigation({ type: 'select-root', view: 'context' });
      const nextNavigation = getPostPublishNavigation(annotationId);
      dispatchNavigation({ type: 'push', screen: nextNavigation.stack[1] as { kind: 'annotation'; annotationId: string } });
    } catch (error) {
      const currentPage = createPageRef.current;
      if (currentPage && isModeAsyncTokenCurrent(
        token,
        currentPage,
        getDraftRevisions(createDraftStateRef.current),
      )) {
        setPublishState({ status: 'error', message: getPublishErrorMessage(error) });
      } else {
        setPublishState({ status: 'idle' });
      }
    } finally {
      publishInFlightRef.current = false;
    }
  }, [audioRecorder, authState.status, captureState, clearDraft, commentary, supabase]);

  const runSelectedPlayerAction = useCallback(async (
    token: PlayerActionToken,
    action: 'read' | 'play',
    startSeconds: number | null,
  ) => {
    const { mode, playerIdentity: identity } = token;
    if (!playerTokenIsCurrent(token)) throw new Error('This player action is no longer current.');
    if (sourceState.status !== 'connected') throw new Error('Choose a player first.');
    const context = connectedContextRef.current;
    if (!context) throw new Error(RECONNECT_MESSAGE);
    const genericVideo = mode === 'video' && sourceState.source.classification !== 'YouTube';
    if (mode === 'audio' && sourceState.source.classification !== 'Podcast / web audio') throw new Error(RECONNECT_MESSAGE);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
    const execution = await chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      // The page's own world is required to traverse readable same-origin frames.
      // Only bounded generic-video identity/time data crosses this call boundary.
      world: genericVideo ? 'MAIN' : 'ISOLATED',
      func: actOnTopFramePlayer,
      args: [
        mode,
        identity,
        sourceState.source.classification === 'YouTube'
          ? sourceState.source.videoId
          : mode === 'video'
            ? normalizeArticleUrl(sourceState.source.url)
            : sourceState.source.classification === 'Podcast / web audio'
              ? sourceState.source.normalizedUrl
              : '',
        action,
        startSeconds,
        genericVideo,
      ],
    });
    const result = execution[0]?.result;
    if (!result?.ok || result.identity !== identity) {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({
          type: 'patch-media', mode,
          patch: { playerIdentity: null, playerTimeMs: null, durationMs: null, playerReadState: 'error' },
        });
        setPlayerDiscoveryRevision((revision) => revision + 1);
      }
      throw new Error('The selected player changed. Choose it again.');
    }
    if (!playerTokenIsCurrent(token)) throw new Error('This player action is no longer current.');
    return result;
  }, [playerTokenIsCurrent, sourceState]);

  const readConnectedPlayer = useCallback(async (action: 'start' | 'end' | 'refresh') => {
    if (
      sourceState.status !== 'connected'
    ) return;
    const mode: PlayerMode | null = modeSelection?.selectedMode === 'video'
      ? 'video'
      : modeSelection?.selectedMode === 'audio' ? 'audio' : null;
    if (!mode || (mode === 'audio' && sourceState.source.classification !== 'Podcast / web audio')) return;
    const draft = mode === 'video' ? videoDraftState : audioDraftState;
    let token: PlayerActionToken;
    try { token = getPlayerActionToken(mode, draft.playerIdentity); } catch { return; }
    dispatchCreateDraft({ type: 'set-player-read-state', mode, state: 'reading' });
    try {
      const player = await runSelectedPlayerAction(token, 'read', null);
      if (!playerTokenIsCurrent(token)) return;
      const patch = {
        sourceKey: sourceState.source.classification === 'YouTube'
          ? sourceState.source.videoId
          : mode === 'video'
            ? normalizeArticleUrl(sourceState.source.url)
            : sourceState.source.classification === 'Podcast / web audio'
              ? sourceState.source.normalizedUrl
              : '',
        playerIdentity: draft.playerIdentity,
        playerTimeMs: player.currentTimeMs,
        durationMs: player.durationMs,
        playerReadState: 'idle' as const,
      };
      dispatchCreateDraft({
        type: 'patch-media', mode,
        patch: action === 'start' ? { ...patch, startMs: player.currentTimeMs }
          : action === 'end' ? { ...patch, endMs: player.currentTimeMs } : patch,
      });
      if (mode === 'video' && sourceState.source.classification === 'YouTube') {
        persistYoutubeDraft(
          sourceState.source.url,
          action === 'start' ? player.currentTimeMs : videoDraftState.startMs,
          action === 'end' ? player.currentTimeMs : videoDraftState.endMs,
          videoDraftState.commentary,
        );
      } else if (mode === 'video') {
        persistWebVideoDraft(
          sourceState.source.url,
          action === 'start' ? player.currentTimeMs : videoDraftState.startMs,
          action === 'end' ? player.currentTimeMs : videoDraftState.endMs,
          videoDraftState.commentary,
        );
      } else if (mode === 'audio' && sourceState.source.classification === 'Podcast / web audio') {
        persistAudioDraft(
          sourceState.source,
          action === 'start' ? player.currentTimeMs : audioDraftState.startMs,
          action === 'end' ? player.currentTimeMs : audioDraftState.endMs,
          audioDraftState.commentary,
        );
      }
    } catch {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode, state: 'error' });
      }
    }
  }, [audioDraftState, getPlayerActionToken, modeSelection?.selectedMode, persistAudioDraft, persistWebVideoDraft, persistYoutubeDraft, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, videoDraftState]);

  const changeYoutubeCommentary = (value: string) => {
    const sourceKey = sourceState.status === 'connected'
      ? sourceState.source.classification === 'YouTube'
        ? sourceState.source.videoId
        : normalizeArticleUrl(sourceState.source.url)
      : videoDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { commentary: value, sourceKey } });
    if (sourceState.status === 'connected' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, value);
    } else if (sourceState.status === 'connected') {
      persistWebVideoDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, value);
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

  const choosePlayer = (mode: PlayerMode, identity: string) => {
    const discovery = mode === 'video' ? videoPlayers : audioPlayers;
    if (
      discovery.status !== 'ready' || discovery.pageGeneration !== modeSelection?.page.generation ||
      !discovery.candidates.some((candidate) => candidate.identity === identity)
    ) return;
    const candidate = discovery.candidates.find((entry) => entry.identity === identity)!;
    dispatchCreateDraft({
      type: 'patch-media', mode,
      patch: {
        playerIdentity: identity,
        playerTimeMs: candidate.currentTimeMs,
        durationMs: candidate.durationMs,
        playerReadState: 'idle',
      },
    });
  };

  const cancelHostedSessionOnServer = useCallback(async (session: HostedMediaSession) => {
    if (!supabase) throw new Error('The authenticated session is unavailable.');
    return cancelOwnedHostedMedia(supabase, session, async () => {
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
  }, [supabase]);

  const cancelStaleHostedBegin = useCallback(async (
    operation: HostedMediaOperation,
    sourceUrl: string,
    mediaType: MediaCreateMode,
    startMs: number,
    endMs: number,
  ) => {
    const session: HostedMediaSession = {
      operation, sourceUrl, mediaType, startMs, endMs, createdAt: Date.now(),
    };
    hostedMediaSessionRef.current = session;
    activeCaptureIdRef.current = null;
    setHostedMediaSession(session);
    setMediaCaptureOperation(operation);
    setMediaCaptureState({
      status: 'error', captureId: null, code: 'recapture-required',
      message: 'The page, player, or draft changed while the hosted draft was being created. Cancellation is being confirmed.',
    });
    await chrome.storage.local.set({ [HOSTED_MEDIA_SESSION_KEY]: session });
    cancellingHostedMediaRef.current = true;
    setIsCancellingHostedMedia(true);
    try {
      await cancelHostedSessionOnServer(session);
      const current = hostedMediaSessionRef.current;
      if (
        current?.operation.annotationId === operation.annotationId &&
        current.operation.mediaId === operation.mediaId && activeCaptureIdRef.current === null
      ) {
        await chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
        hostedMediaSessionRef.current = null;
        setHostedMediaSession(null);
        setMediaCaptureOperation(null);
        setMediaCaptureState({ status: 'idle' });
      }
    } finally {
      cancellingHostedMediaRef.current = false;
      setIsCancellingHostedMedia(false);
    }
  }, [cancelHostedSessionOnServer]);

  const startHostedCapture = useCallback(async (
    operation: HostedMediaOperation,
    source: CaptureSourceIdentity,
    startMs: number,
    endMs: number,
  ) => {
    if (!supabase) throw new Error('The authenticated session is unavailable.');
    const session: HostedMediaSession = {
      operation,
      sourceUrl: source.pageUrl,
      mediaType: source.kind === 'youtube' ? 'video' : 'audio',
      startMs,
      endMs,
      createdAt: Date.now(),
    };
    hostedMediaSessionRef.current = session;
    setHostedMediaSession(session);
    setMediaCaptureOperation(operation);
    const captureId = crypto.randomUUID();
    activeCaptureIdRef.current = captureId;
    setMediaCaptureState({ status: 'preparing', captureId });
    const attempt = createHostedAttemptToken(operation, captureId);
    let responseSnapshot: CaptureSnapshot | null = null;
    try {
      await chrome.storage.local.set({ [HOSTED_MEDIA_SESSION_KEY]: session });
      const context = connectedContextRef.current;
      if (!context || context.url !== source.pageUrl) throw new Error(RECONNECT_MESSAGE);
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) throw new Error('The authenticated session is unavailable.');
      const response = await chrome.runtime.sendMessage({
        target: 'background',
        type: MEDIA_CAPTURE_START,
        request: {
          captureId,
          tabId: context.tabId,
          source,
          startMs,
          endMs,
          operation,
          accessToken,
          apiOrigin: getWebAppOrigin(),
        },
      }) as { ok?: boolean; snapshot?: CaptureSnapshot };
      responseSnapshot = response?.snapshot ?? null;
      if (hostedAttemptTokenIsCurrent(attempt, hostedMediaSessionRef.current, activeCaptureIdRef.current) && response?.snapshot) {
        setMediaCaptureState(response.snapshot);
      }
      if (!response?.ok) {
        throw new Error(
          response?.snapshot && 'message' in response.snapshot
            ? response.snapshot.message
            : 'The connected media capture could not start.',
        );
      }
    } catch (error) {
      if (hostedAttemptTokenIsCurrent(attempt, hostedMediaSessionRef.current, activeCaptureIdRef.current)) {
        setMediaCaptureState(responseSnapshot ?? {
          status: 'error', captureId, code: 'unexpected',
          message: error instanceof Error ? error.message : 'The connected media capture could not start.',
        });
      }
      throw error;
    }
  }, [supabase]);

  const publishYoutubeClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' || sourceState.source.classification !== 'YouTube' ||
      videoDraftState.startMs === null || videoDraftState.endMs === null ||
      !videoDraftState.commentary.trim() || !videoDraftState.playerIdentity
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
    let token: PlayerActionToken;
    try { token = getPlayerActionToken('video', videoDraftState.playerIdentity); }
    catch { return; }
    publishInFlightRef.current = true;
    hostedBeginModeRef.current = 'video';
    setHostedBeginMode('video');
    setYoutubePublishState({ status: 'publishing' });
    try {
      const player = await runSelectedPlayerAction(token, 'read', null);
      if (!playerTokenIsCurrent(token)) throw new Error('The Video draft changed. Review it and try again.');
      const actionRangeError = getNewMediaPublicationRangeError(
        videoDraftState.startMs, videoDraftState.endMs, player.durationMs,
      );
      if (actionRangeError) throw new Error(actionRangeError);
      const operation = await beginHostedYouTubeAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        title: sourceState.source.title,
        channelName: sourceState.source.channelName,
        startMs: videoDraftState.startMs,
        endMs: videoDraftState.endMs,
        commentaryText: videoDraftState.commentary,
        videoDurationMs: player.durationMs,
      });
      if (!playerTokenIsCurrent(token)) {
        await cancelStaleHostedBegin(
          operation,
          sourceState.source.url,
          'video',
          videoDraftState.startMs,
          videoDraftState.endMs,
        );
        throw new Error('The Video page, player, or draft changed. The hosted draft was cancelled; review it and try again.');
      }
      await startHostedCapture(operation, {
        kind: 'youtube',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.videoId,
        playerIdentity: videoDraftState.playerIdentity,
      }, videoDraftState.startMs, videoDraftState.endMs);
      setYoutubePublishState({ status: 'idle' });
    } catch (error) {
      setYoutubePublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The YouTube clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
      if (hostedBeginModeRef.current === 'video') {
        hostedBeginModeRef.current = null;
        setHostedBeginMode(null);
      }
    }
  }, [authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase, videoDraftState]);

  const publishAudioClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio' ||
      audioDraftState.startMs === null || audioDraftState.endMs === null ||
      !audioDraftState.commentary.trim() || audioDraftState.durationMs === null ||
      !audioDraftState.playerIdentity
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
    let token: PlayerActionToken;
    try { token = getPlayerActionToken('audio', audioDraftState.playerIdentity); }
    catch { return; }
    publishInFlightRef.current = true;
    hostedBeginModeRef.current = 'audio';
    setHostedBeginMode('audio');
    setAudioPublishState({ status: 'publishing' });
    try {
      const player = await runSelectedPlayerAction(token, 'read', null);
      if (!playerTokenIsCurrent(token)) throw new Error('The Audio draft changed. Review it and try again.');
      if (player.durationMs === null) {
        throw new Error('Play the audio until its duration is available, then try again.');
      }
      const actionRangeError = getNewMediaPublicationRangeError(
        audioDraftState.startMs, audioDraftState.endMs, player.durationMs,
      );
      if (actionRangeError) throw new Error(actionRangeError);
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
        mediaDurationMs: player.durationMs,
      });
      if (!playerTokenIsCurrent(token)) {
        await cancelStaleHostedBegin(
          operation,
          sourceState.source.url,
          'audio',
          audioDraftState.startMs,
          audioDraftState.endMs,
        );
        throw new Error('The Audio page, player, or draft changed. The hosted draft was cancelled; review it and try again.');
      }
      await startHostedCapture(operation, {
        kind: 'audio',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.normalizedUrl,
        playerIdentity: audioDraftState.playerIdentity,
      }, audioDraftState.startMs, audioDraftState.endMs);
      setAudioPublishState({ status: 'idle' });
    } catch (error) {
      setAudioPublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The audio clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
      if (hostedBeginModeRef.current === 'audio') {
        hostedBeginModeRef.current = null;
        setHostedBeginMode(null);
      }
    }
  }, [audioDraftState, authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase]);

  const cancelHostedMedia = useCallback(async (expectedAttempt?: HostedAttemptToken) => {
    const session = hostedMediaSessionRef.current;
    const captureId = activeCaptureIdRef.current;
    if (!session || !supabase || cancellingHostedMediaRef.current) return false;
    const attempt = expectedAttempt ?? createHostedAttemptToken(session.operation, captureId);
    if (!hostedAttemptTokenIsCurrent(attempt, session, captureId)) return false;
    cancellingHostedMediaRef.current = true;
    setIsCancellingHostedMedia(true);
    try {
      const backgroundResponse = await chrome.runtime.sendMessage({
        target: 'background',
        type: MEDIA_CAPTURE_CANCEL,
        captureId,
        operation: session.operation,
      }) as { ok?: boolean; cancelled?: boolean } | undefined;
      if (backgroundResponse?.ok === false) throw new Error('The active capture could not be cancelled safely.');
      const requiresLiveCaptureCancellation =
        ['preparing', 'capturing', 'stopping', 'uploading', 'waiting-to-upload'].includes(mediaCaptureState.status) ||
        (mediaCaptureState.status === 'error' && mediaCaptureState.code === 'upload-failed');
      if (requiresLiveCaptureCancellation && backgroundResponse?.cancelled !== true) {
        throw new Error('The active capture identity changed before cancellation. Refresh the draft and try again.');
      }
      await cancelHostedSessionOnServer(session);
      if (!hostedAttemptTokenIsCurrent(
        attempt,
        hostedMediaSessionRef.current,
        activeCaptureIdRef.current,
      )) return false;
      await chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
      hostedMediaSessionRef.current = null;
      activeCaptureIdRef.current = null;
      setHostedMediaSession(null);
      setMediaCaptureOperation(null);
      setMediaCaptureState({ status: 'idle' });
      setYoutubePublishState({ status: 'idle' });
      setAudioPublishState({ status: 'idle' });
      return true;
    } catch (error) {
      setMediaCaptureState({
        status: 'error',
        captureId,
        code: 'unexpected',
        message: error instanceof Error ? error.message : 'Cancel failed.',
      });
      return false;
    } finally {
      cancellingHostedMediaRef.current = false;
      setIsCancellingHostedMedia(false);
    }
  }, [cancelHostedSessionOnServer, mediaCaptureState, supabase]);

  const retryHostedUpload = useCallback(async () => {
    const session = hostedMediaSessionRef.current;
    const captureId = 'captureId' in mediaCaptureState ? mediaCaptureState.captureId : null;
    if (!supabase || !session || !captureId || activeCaptureIdRef.current !== captureId) return;
    const attempt = createHostedAttemptToken(session.operation, captureId);
    const { data, error } = await supabase.auth.getSession();
    if (!hostedAttemptTokenIsCurrent(attempt, hostedMediaSessionRef.current, activeCaptureIdRef.current)) return;
    if (error || !data.session?.access_token) {
      setMediaCaptureState({
        status: 'error',
        captureId,
        code: 'authorization-failed',
        message: 'Your session could not be refreshed. Sign in again before retrying.',
      });
      return;
    }
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: MEDIA_CAPTURE_RETRY,
      captureId,
      accessToken: data.session.access_token,
    }) as { snapshot?: CaptureSnapshot };
    if (
      hostedAttemptTokenIsCurrent(attempt, hostedMediaSessionRef.current, activeCaptureIdRef.current) &&
      response?.snapshot && 'captureId' in response.snapshot && response.snapshot.captureId === captureId
    ) setMediaCaptureState(response.snapshot);
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
      if (!videoDraftState.playerIdentity) {
        setMediaCaptureState({ status: 'error', captureId: null, code: 'connected-source-changed', message: 'Choose the original video player before recapturing this draft.' });
        return;
      }
      const token = getPlayerActionToken('video', videoDraftState.playerIdentity);
      await runSelectedPlayerAction(token, 'read', null);
      if (!playerTokenIsCurrent(token)) return;
      await startHostedCapture(session.operation, {
        kind: 'youtube',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.videoId,
        playerIdentity: videoDraftState.playerIdentity,
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
      if (!audioDraftState.playerIdentity) {
        setMediaCaptureState({ status: 'error', captureId: null, code: 'connected-source-changed', message: 'Choose the original audio player before recapturing this draft.' });
        return;
      }
      const token = getPlayerActionToken('audio', audioDraftState.playerIdentity);
      await runSelectedPlayerAction(token, 'read', null);
      if (!playerTokenIsCurrent(token)) return;
      await startHostedCapture(session.operation, {
        kind: 'audio',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.normalizedUrl,
        playerIdentity: audioDraftState.playerIdentity,
      }, session.startMs, session.endMs);
    }
  }, [audioDraftState.playerIdentity, getPlayerActionToken, hostedMediaSession, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, videoDraftState.playerIdentity]);

  const playConnectedClip = useCallback(async (
    annotation: Extract<PublicAnnotation, { kind: 'youtube' }>,
  ) => {
    if (
      sourceState.status !== 'connected' || sourceState.source.classification !== 'YouTube' ||
      sourceState.source.videoId !== annotation.source.videoId
    ) throw new Error('The connected video does not match this clip.');
    const token = getPlayerActionToken('video', videoDraftState.playerIdentity);
    await runSelectedPlayerAction(token, 'play', annotation.startMs / 1_000);
  }, [getPlayerActionToken, runSelectedPlayerAction, sourceState, videoDraftState.playerIdentity]);

  const playConnectedAudioClip = useCallback(async (
    annotation: Extract<PublicAnnotation, { kind: 'audio' }>,
  ) => {
    if (
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio' ||
      sourceState.source.normalizedUrl !== annotation.source.normalizedUrl
    ) throw new Error('The connected audio source does not match this clip.');
    const token = getPlayerActionToken('audio', audioDraftState.playerIdentity);
    await runSelectedPlayerAction(token, 'play', annotation.startMs / 1_000);
  }, [audioDraftState.playerIdentity, getPlayerActionToken, runSelectedPlayerAction, sourceState]);

  const previewYoutubeDraft = useCallback(async () => {
    if (
      videoDraftState.startMs === null || sourceState.status !== 'connected'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    let token: PlayerActionToken;
    try { token = getPlayerActionToken('video', videoDraftState.playerIdentity); } catch { return; }
    dispatchCreateDraft({ type: 'set-player-read-state', mode: 'video', state: 'reading' });
    try {
      await runSelectedPlayerAction(token, 'play', videoDraftState.startMs / 1_000);
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'video', state: 'idle' });
      }
    } catch {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'video', state: 'error' });
      }
    }
  }, [getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, videoDraftState.playerIdentity, videoDraftState.startMs]);

  const previewAudioDraft = useCallback(async () => {
    if (
      audioDraftState.startMs === null || sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Podcast / web audio'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    let token: PlayerActionToken;
    try { token = getPlayerActionToken('audio', audioDraftState.playerIdentity); } catch { return; }
    dispatchCreateDraft({ type: 'set-player-read-state', mode: 'audio', state: 'reading' });
    try {
      await runSelectedPlayerAction(token, 'play', audioDraftState.startMs / 1_000);
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'audio', state: 'idle' });
      }
    } catch {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'audio', state: 'error' });
      }
    }
  }, [audioDraftState.playerIdentity, audioDraftState.startMs, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState]);

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
          return {
            status: 'connected',
            source: {
              ...detection.source,
              videoDetectionResolved: state.source.videoDetectionResolved,
              videoAvailable: state.source.videoAvailable,
            },
          };
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
    void supabase.auth.getSession().then(({ data, error }) => { if (error) throw error; return applyAuthenticatedUser(data.session?.user ?? null); }).catch(async () => { await clearLocalAuthSession(supabase); if (authMountedRef.current) setAuthState({ status: 'error', message: 'Authentication could not be restored. Please try again.' }); });
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
        const previous = hostedMediaSessionRef.current;
        if (!session || !previous ||
            previous.operation.annotationId !== session.operation.annotationId ||
            previous.operation.mediaId !== session.operation.mediaId) {
          activeCaptureIdRef.current = null;
        }
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
        const eventCaptureId = 'captureId' in event.snapshot ? event.snapshot.captureId : null;
        if (!cancellingHostedMediaRef.current && session && operation && eventCaptureId &&
            operation.annotationId === session.operation.annotationId &&
            operation.mediaId === session.operation.mediaId &&
            (!activeCaptureIdRef.current || activeCaptureIdRef.current === eventCaptureId)) {
          activeCaptureIdRef.current = eventCaptureId;
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
        WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY,
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
        const storedWebVideoDraftValue = stored[WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY];
        let webVideoDraft = deserializeWebVideoClipDraft(storedWebVideoDraftValue);
        if (youtubeDraft && webVideoDraft) {
          if (youtubeDraft.updatedAt >= webVideoDraft.updatedAt) {
            webVideoDraft = null;
            void chrome.storage.session.remove(WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY);
          } else {
            youtubeDraftRef.current = null;
            void chrome.storage.session.remove(YOUTUBE_CLIP_DRAFT_STORAGE_KEY);
          }
        }
        webVideoDraftRef.current = webVideoDraft;
        if (
          restorationRevision === draftRevisionRef.current && webVideoDraft && context &&
          webVideoClipDraftBelongsToSource(webVideoDraft, context.url)
        ) {
          dispatchCreateDraft({
            type: 'restore-media',
            mode: 'video',
            sourceKey: webVideoDraft.source.normalizedUrl,
            startMs: webVideoDraft.startMs,
            endMs: webVideoDraft.endMs,
            commentary: webVideoDraft.commentary,
          });
        } else if (
          restorationRevision === draftRevisionRef.current &&
          storedWebVideoDraftValue !== undefined && webVideoDraft === null
        ) {
          void chrome.storage.session.remove(WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY);
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
          activeCaptureIdRef.current = null;
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
    const context = connectedContextRef.current;
    const page = modeSelection?.page;
    if (mediaEditorLocked) return;
    if (!context || !page || sourceState.status !== 'connected') {
      setVideoPlayers(EMPTY_PLAYER_DISCOVERY);
      setAudioPlayers(EMPTY_PLAYER_DISCOVERY);
      return;
    }
    const pageUrl = sourceState.source.url;
    const pageGeneration = page.generation;
    const genericVideo = sourceState.source.classification !== 'YouTube';
    const videoSourceKey = sourceState.source.classification === 'YouTube'
      ? sourceState.source.videoId
      : normalizeArticleUrl(sourceState.source.url);
    const probes: Array<{ mode: PlayerMode; genericVideo: boolean; sourceKey: string }> = [
      { mode: 'video', genericVideo, sourceKey: videoSourceKey },
    ];
    if (sourceState.source.classification === 'Podcast / web audio') {
      probes.push({ mode: 'audio', genericVideo: false, sourceKey: sourceState.source.normalizedUrl });
    } else {
      setAudioPlayers(EMPTY_PLAYER_DISCOVERY);
    }
    let current = true;
    for (const probe of probes) {
      void chrome.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        // Generic video needs the page origin to traverse readable same-origin frames.
        world: probe.genericVideo ? 'MAIN' : 'ISOLATED',
        func: readTopFramePlayerDiscovery,
        args: [probe.mode, probe.genericVideo],
      }).then((execution) => {
        if (!current || createPageRef.current?.generation !== pageGeneration) return;
        const discovery = validatePlayerDiscovery(pageUrl, probe.mode, execution[0]?.result, probe.genericVideo);
        const state: PlayerDiscoveryState = { ...discovery, pageGeneration };
        if (probe.mode === 'video') {
          setVideoPlayers(state);
          if (probe.genericVideo) setSourceState((currentState) =>
            currentState.status === 'connected' && currentState.source.classification !== 'YouTube' &&
            currentState.source.url === pageUrl &&
            (currentState.source.videoDetectionResolved !== true ||
              currentState.source.videoAvailable !== playerDiscoveryMakesModeAvailable(discovery))
              ? { status: 'connected', source: { ...currentState.source,
                videoDetectionResolved: true, videoAvailable: playerDiscoveryMakesModeAvailable(discovery) } }
              : currentState);
        } else setAudioPlayers(state);
        const previousIdentity = playerIdentityRef.current[probe.mode];
        const playerIdentity = reconcilePlayerSelection(discovery, previousIdentity);
        const selected = discovery.status === 'ready'
          ? discovery.candidates.find((candidate) => candidate.identity === playerIdentity) ?? null
          : null;
        dispatchCreateDraft({
          type: 'patch-media', mode: probe.mode,
          patch: { sourceKey: probe.sourceKey, playerIdentity,
            playerTimeMs: selected?.currentTimeMs ?? null,
            durationMs: selected?.durationMs ?? null,
            playerReadState: previousIdentity && !playerIdentity ? 'error' : 'idle' },
        });
      }).catch(() => {
        if (!current || createPageRef.current?.generation !== pageGeneration) return;
        const state: PlayerDiscoveryState = { ...EMPTY_PLAYER_DISCOVERY, pageGeneration };
        if (probe.mode === 'video') {
          setVideoPlayers(state);
          if (probe.genericVideo) setSourceState((currentState) =>
            currentState.status === 'connected' && currentState.source.classification !== 'YouTube' && currentState.source.url === pageUrl
              ? { status: 'connected', source: { ...currentState.source, videoDetectionResolved: true, videoAvailable: false } }
              : currentState);
        } else setAudioPlayers(state);
        dispatchCreateDraft({ type: 'patch-media', mode: probe.mode,
          patch: { playerIdentity: null, playerTimeMs: null, durationMs: null, playerReadState: 'error' } });
      });
    }
    return () => { current = false; };
  }, [mediaEditorLocked, modeSelection?.page.generation, playerDiscoveryRevision, sourceState]);

  useEffect(() => {
    if (mediaEditorLocked || sourceState.status !== 'connected') return;
    const timer = window.setInterval(() => {
      setPlayerDiscoveryRevision((revision) => revision + 1);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [mediaEditorLocked, sourceState]);

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
        activeCaptureIdRef.current = null;
        setHostedMediaSession(null);
        setMediaCaptureOperation(null);
        void chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
      } else {
        setMediaCaptureOperation(live?.operation ?? hostedMediaSession.operation);
        if ('captureId' in result.snapshot && result.snapshot.captureId) {
          activeCaptureIdRef.current = result.snapshot.captureId;
        }
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
          activeCaptureIdRef.current = null;
          setHostedMediaSession(null);
          setMediaCaptureOperation(null);
          void chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY);
        } else {
          if ('captureId' in result.snapshot && result.snapshot.captureId) {
            activeCaptureIdRef.current = result.snapshot.captureId;
          }
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

  useEffect(() => {
    const dialog = modeSwitchDialogRef.current;
    if (pendingModeSwitch && dialog && !dialog.open) dialog.showModal();
  }, [pendingModeSwitch]);

  const changeCommentary = (value: string) => {
    draftRevisionRef.current += 1;
    dispatchCreateDraft({ type: 'set-text-commentary', commentary: value });
    const draft = draftRef.current;
    if (!draft) return;
    const updatedDraft = updateAnnotationDraftCommentary(draft, value);
    if (updatedDraft) persistDraft(updatedDraft);
  };

  const applyCreateMode = (mode: CreateMode, announcement = `${CREATE_MODE_LABELS[mode]} mode selected.`) => {
    const current = modeSelectionRef.current;
    if (!current) return false;
    const next = selectCreateMode(current, mode);
    if (next === current) return false;
    modeSelectionRef.current = next;
    setModeSelection(next);
    const stored = serializeCreateModeSelection(next.page.identity, mode);
    storedModeSelectionRef.current = stored;
    void chrome.storage.session
      .set({ [CREATE_MODE_SELECTION_STORAGE_KEY]: stored })
      .catch(() => console.warn('Unable to save the selected Create mode.'));
    setModeAnnouncement(announcement);
    try { navigator.vibrate?.(12); } catch { /* Desktop Chrome ignores vibration. */ }
    return true;
  };

  const chooseCreateMode = (mode: CreateMode) => {
    const current = modeSelectionRef.current;
    if (!current) return;
    const guard = getModeSwitchGuard(deriveOperationGuardState({
      articlePublishing: publishState.status === 'publishing',
      hostedBeginMode: hostedBeginModeRef.current,
      hostedSession: hostedMediaSessionRef.current,
      capture: mediaCaptureState,
      cancelling: cancellingHostedMediaRef.current,
    }), current.selectedMode, mode);
    if (guard.action === 'lock') {
      setModeAnnouncement(guard.message);
      return;
    }
    if (guard.action === 'confirm-cancel') {
      if (!current.selectedMode) return;
      setPendingModeSwitch(createModeSwitchIntent(
        guard,
        current.selectedMode,
        mode,
        current.page.generation,
      ));
      return;
    }
    applyCreateMode(mode);
  };

  const dismissModeSwitch = () => {
    setPendingModeSwitch(null);
    setModeAnnouncement('Kept the active hosted-media operation.');
  };

  const confirmModeSwitch = async () => {
    const intent = pendingModeSwitch;
    const session = hostedMediaSessionRef.current;
    if (!intent || !session || !modeSwitchIntentIsCurrent(
      intent,
      modeSelectionRef.current?.page ?? null,
      modeSelectionRef.current?.selectedMode ?? null,
    )) {
      setPendingModeSwitch(null);
      return;
    }
    const attempt = createHostedAttemptToken(session.operation, activeCaptureIdRef.current);
    setPendingModeSwitch(null);
    const cancelled = await cancelHostedMedia(attempt);
    const current = modeSelectionRef.current;
    if (!cancelled || !current || !modeSwitchIntentIsCurrent(intent, current.page, current.selectedMode)) {
      setModeAnnouncement('The hosted-media operation was not cancelled, so the mode did not change.');
      return;
    }
    if (current.capabilities[intent.toMode].status !== 'available') {
      setModeAnnouncement(`${CREATE_MODE_LABELS[intent.toMode]} is no longer available on this page.`);
      return;
    }
    applyCreateMode(
      intent.toMode,
      `Cancelled the ${CREATE_MODE_LABELS[intent.hostedMode]} operation and switched to ${CREATE_MODE_LABELS[intent.toMode]}.`,
    );
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
  const webVideoSource = sourceState.status === 'connected' && sourceState.source.classification !== 'YouTube' &&
    sourceState.source.videoDetectionResolved && sourceState.source.videoAvailable
    ? sourceState.source
    : null;
  const videoSource = youtubeSource ?? webVideoSource;
  const audioSource = sourceState.status === 'connected' && sourceState.source.classification === 'Podcast / web audio'
    ? sourceState.source
    : null;
  const connectedContext = sourceState.status === 'connected' ? connectedContextRef.current : null;
  const youtubeHover = youtubeSource && connectedContext
    ? { tabId: connectedContext.tabId, tabUrl: youtubeSource.url }
    : null;
  const selectedCreateMode = modeSelection?.selectedMode ?? null;
  const textDraftAttached = Boolean(
    draftRef.current && connectedContext && annotationDraftBelongsToContext(draftRef.current, connectedContext),
  );
  const videoDraftAttached = Boolean(youtubeSource
    ? youtubeDraftRef.current && youtubeClipDraftBelongsToSource(youtubeDraftRef.current, youtubeSource.url)
    : webVideoSource && webVideoDraftRef.current && webVideoClipDraftBelongsToSource(webVideoDraftRef.current, webVideoSource.url));
  const audioDraftAttached = Boolean(
    audioDraftRef.current && audioSource &&
    audioClipDraftBelongsToSource(audioDraftRef.current, audioSource.url, audioSource.canonicalUrl),
  );
  const detachedDraftModes: Record<CreateMode, boolean> = {
    text: draftRef.current !== null && !textDraftAttached,
    video: (youtubeDraftRef.current !== null || webVideoDraftRef.current !== null) && !videoDraftAttached,
    audio: audioDraftRef.current !== null && !audioDraftAttached,
  };
  const savedDraftModes: Record<CreateMode, boolean> = {
    text: draftRef.current !== null || hasCreateModeDraft(createDraftState, 'text'),
    video: youtubeDraftRef.current !== null || webVideoDraftRef.current !== null || hasCreateModeDraft(createDraftState, 'video'),
    audio: audioDraftRef.current !== null || hasCreateModeDraft(createDraftState, 'audio'),
  };
  const savedDraftLabels = CREATE_MODES
    .filter((mode) => savedDraftModes[mode])
    .map((mode) => CREATE_MODE_LABELS[mode]);
  const draftStatusMessage = savedDraftLabels.length > 0 ? ` Draft saved: ${savedDraftLabels.join(', ')}.` : '';
  const modeStatusMessage = modeAnnouncement || `${getModeCapabilitySummary(modeSelection)}${draftStatusMessage}`;
  const selectedModeIndex = selectedCreateMode ? CREATE_MODES.indexOf(selectedCreateMode) : -1;
  const discardSelectedDetachedDraft = () => {
    if (selectedCreateMode === 'text') {
      void clearDraft('explicit-clear');
    } else if (selectedCreateMode === 'video') {
      void clearVideoDraft();
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
  const videoRangeDisplay = getMediaRangeDisplay(videoDraftState.startMs, videoDraftState.endMs);
  const audioRangeDisplay = getMediaRangeDisplay(audioDraftState.startMs, audioDraftState.endMs);
  const videoPlayerSelected = videoPlayers.status === 'ready' &&
    videoPlayers.pageGeneration === modeSelection?.page.generation &&
    videoPlayers.candidates.some((candidate) => candidate.identity === videoDraftState.playerIdentity);
  const audioPlayerSelected = audioPlayers.status === 'ready' &&
    audioPlayers.pageGeneration === modeSelection?.page.generation &&
    audioPlayers.candidates.some((candidate) => candidate.identity === audioDraftState.playerIdentity);
  const canPublishYoutube = authState.status === 'signed-in' && youtubeSource !== null &&
    videoPlayerSelected &&
    videoClipRangeError === null && videoDraftState.commentary.trim().length > 0 &&
    videoDraftState.commentary.length <= 2_000 && youtubePublishState.status !== 'publishing' &&
    hostedMediaSession === null;
  const canPublishAudio = authState.status === 'signed-in' && audioSource !== null &&
    audioPlayerSelected &&
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
      {mediaCaptureState.status === 'processing' && <span>Uploaded and queued. Processing is in progress.</span>}
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

      {supabase && currentScreen.kind === 'annotation' && <AnnotationDetailView key={`annotation:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={() => void beginSignIn()} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} connectedVideoId={youtubeSource?.videoId ?? null} onPlayConnectedClip={playConnectedClip} connectedAudioNormalizedUrl={audioSource?.normalizedUrl ?? null} onPlayConnectedAudioClip={playConnectedAudioClip} youtubeHover={youtubeHover} onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'comments' && <AnnotationDetailView key={`comments:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={() => void beginSignIn()} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} connectedVideoId={youtubeSource?.videoId ?? null} onPlayConnectedClip={playConnectedClip} connectedAudioNormalizedUrl={audioSource?.normalizedUrl ?? null} onPlayConnectedAudioClip={playConnectedAudioClip} youtubeHover={youtubeHover} focusComments onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'profile' && <ProfileView key={`profile:${currentScreen.profileId}`} supabase={supabase} profileId={currentScreen.profileId} currentUserId={currentUserId} onSignIn={() => void beginSignIn()} navigation={navigationCallbacks} cache={socialCacheRef.current} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} />}

      {currentScreen.kind === 'root' && currentScreen.view === 'feed' && (
        <div className="root-view"><header className="view-intro"><span className="section-label">Public activity</span><h1>Recent annotations</h1><p>Published notes from across Annotated.</p></header>{supabase ? <AnnotationCollection supabase={supabase} cache={socialCacheRef.current} cacheKey="feed" navigation={navigationCallbacks} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} emptyTitle="No published annotations" emptyMessage="The public feed is quiet for now." /> : <div className="compact-state compact-state-error">Feed unavailable</div>}</div>
      )}

      {currentScreen.kind === 'root' && currentScreen.view === 'account' && (
        <div className="root-view"><header className="view-intro"><span className="section-label">Private account</span><h1>Me</h1></header><section className="account-view">
          {authState.status === 'loading' && <div className="compact-state" role="status">Restoring session…</div>}
          {authState.status === 'signed-out' && <div className="signed-out-account"><p>Sign in to publish, comment, and follow creators.</p><div className="account-sign-in-actions"><button className="button button-primary" type="button" onClick={() => void beginSignIn('google')}>Continue with Google</button>{EXTENSION_AUTH_CAPABILITIES.x ? <button className="button button-secondary" type="button" onClick={() => void beginSignIn('x')}>Continue with X</button> : null}</div></div>}
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
            <div
              className="create-mode-segmented"
              role="radiogroup"
              aria-label="Create mode"
              data-index={selectedModeIndex >= 0 ? String(selectedModeIndex) : undefined}
            >
              <span className="create-mode-thumb" hidden={selectedModeIndex < 0} />
              {CREATE_MODES.map((mode) => {
                const capability = modeSelection?.capabilities[mode] ?? modeCapabilities[mode];
                const selected = selectedCreateMode === mode;
                const unavailable = capability.status !== 'available';
                const checking = capability.status === 'checking';
                return (
                  <label
                    className={`create-mode-segment${selected ? ' selected' : ''}${unavailable ? ' unavailable' : ''}${checking ? ' checking' : ''}`}
                    key={mode}
                  >
                    <input type="radio" name="create-mode" value={mode} checked={selected} disabled={unavailable} onChange={() => chooseCreateMode(mode)} />
                    <CreateModeIcon mode={mode} />
                    <span className="create-mode-label">{CREATE_MODE_LABELS[mode]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="create-mode-status" role="status" aria-live="polite">{modeStatusMessage}</p>
          <section className="context-source"><SourceSummary state={sourceState} /><div className="source-actions"><button className="button button-secondary button-small" type="button" onClick={() => void loadSource()} disabled={isRefreshing || isCapturing}>{isRefreshing ? 'Refreshing…' : 'Refresh source'}</button>{refreshSuccess && <span role="status">Source updated</span>}</div></section>
          {selectedCreateMode && detachedDraftModes[selectedCreateMode] ? (
            <div className="compact-state detached-draft" role="status"><strong>{CREATE_MODE_LABELS[selectedCreateMode]} draft saved</strong><span>This draft belongs to another connected source. Return to that source to continue, or discard it to start here.</span><button className="button button-secondary" type="button" onClick={discardSelectedDetachedDraft}>Discard {CREATE_MODE_LABELS[selectedCreateMode]} draft and start here</button></div>
          ) : selectedCreateMode === 'video' && videoSource ? (
            <section className="create-panel youtube-clip-panel" aria-labelledby="create-heading" key="create-video">
              <div className="section-heading"><h2 id="create-heading">Create clip</h2><span>{youtubeSource ? 'YouTube time range' : 'Webpage video range'}</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this video for unpublished work…</span></div> : <>
                <p className="create-help">Play the connected video, set the start, continue watching, then set the end.</p>
                <PlayerSelector mode="video" discovery={videoPlayers} selectedIdentity={videoDraftState.playerIdentity} disabled={mediaEditorLocked} onSelect={(identity) => choosePlayer('video', identity)} />
                <dl className="clip-time-grid">
                  <div><dt>START</dt><dd>{videoRangeDisplay.start}</dd></div>
                  <div><dt>END</dt><dd>{videoRangeDisplay.end}</dd></div>
                  <div><dt>LENGTH</dt><dd>{videoRangeDisplay.length}</dd></div>
                </dl>
                {videoDraftState.playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTimeTenths(videoDraftState.playerTimeMs)}</strong>{videoDraftState.durationMs !== null && <> / {formatMediaTimeTenths(videoDraftState.durationMs)}</>}</p>}
                <div className="clip-control-row"><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('start')} disabled={!videoPlayerSelected || videoDraftState.playerReadState === 'reading' || mediaEditorLocked}>Set start</button><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('end')} disabled={!videoPlayerSelected || videoDraftState.playerReadState === 'reading' || mediaEditorLocked}>Set end</button><button className="text-button" type="button" onClick={() => void readConnectedPlayer('refresh')} disabled={!videoPlayerSelected || videoDraftState.playerReadState === 'reading' || mediaEditorLocked}>{videoDraftState.playerReadState === 'reading' ? 'Reading…' : 'Refresh time'}</button></div>
                {videoDraftState.startMs !== null && <button className="button button-secondary preview-clip" type="button" onClick={() => void previewYoutubeDraft()} disabled={!videoPlayerSelected || videoDraftState.playerReadState === 'reading' || mediaEditorLocked}>Preview from start</button>}
                {videoDraftState.startMs !== null && videoDraftState.endMs !== null && videoClipRangeError && <p className="inline-error" role="alert">{videoClipRangeError}</p>}
                {videoDraftState.playerReadState === 'error' && <p className="inline-error" role="alert">The current video player changed or could not be read. Reselect it and try again.</p>}
                <div className="annotation-field"><label htmlFor="youtube-commentary">Your commentary <span aria-hidden="true">*</span></label><textarea id="youtube-commentary" value={videoDraftState.commentary} maxLength={2_000} rows={6} required disabled={mediaEditorLocked} onChange={(event) => changeYoutubeCommentary(event.target.value)} /><span aria-live="polite">{videoDraftState.commentary.length.toLocaleString()} / 2,000</span></div>
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearVideoDraft()} disabled={youtubePublishState.status === 'publishing' || mediaEditorLocked}>Clear clip</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginSignIn()}>Continue with Google</button> : youtubeSource ? <button className="button button-primary" type="button" onClick={() => void publishYoutubeClip()} disabled={!canPublishYoutube}>{youtubePublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button> : <button className="button button-primary" type="button" disabled>Publishing not enabled</button>}</div>
                {webVideoSource && <p className="create-help" role="status">This readable webpage player can be selected and revalidated. Publishing remains closed until the separately authorized article-backed hosted-video server contract is available.</p>}
                {youtubePublishState.status === 'error' && <p className="inline-error" role="alert">{youtubePublishState.message}</p>}
              </>}
            </section>
          ) : selectedCreateMode === 'audio' && audioSource ? (
            <section className="create-panel audio-clip-panel" aria-labelledby="create-heading" key="create-audio">
              <div className="section-heading"><h2 id="create-heading">Create audio clip</h2><span>Podcast / web audio</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this episode for unpublished work…</span></div> : <>
                <p className="create-help">Play the connected page audio, set the start, continue listening, then set the end.</p>
                <PlayerSelector mode="audio" discovery={audioPlayers} selectedIdentity={audioDraftState.playerIdentity} disabled={mediaEditorLocked} onSelect={(identity) => choosePlayer('audio', identity)} />
                <dl className="clip-time-grid">
                  <div><dt>START</dt><dd>{audioRangeDisplay.start}</dd></div>
                  <div><dt>END</dt><dd>{audioRangeDisplay.end}</dd></div>
                  <div><dt>LENGTH</dt><dd>{audioRangeDisplay.length}</dd></div>
                </dl>
                {audioDraftState.playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTimeTenths(audioDraftState.playerTimeMs)}</strong>{audioDraftState.durationMs !== null && <> / {formatMediaTimeTenths(audioDraftState.durationMs)}</>}</p>}
                <div className="clip-control-row"><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('start')} disabled={!audioPlayerSelected || audioDraftState.playerReadState === 'reading' || mediaEditorLocked}>Set start</button><button className="button button-secondary" type="button" onClick={() => void readConnectedPlayer('end')} disabled={!audioPlayerSelected || audioDraftState.playerReadState === 'reading' || mediaEditorLocked}>Set end</button><button className="text-button" type="button" onClick={() => void readConnectedPlayer('refresh')} disabled={!audioPlayerSelected || audioDraftState.playerReadState === 'reading' || mediaEditorLocked}>{audioDraftState.playerReadState === 'reading' ? 'Reading…' : 'Refresh time'}</button></div>
                {audioDraftState.startMs !== null && <button className="button button-secondary preview-clip" type="button" onClick={() => void previewAudioDraft()} disabled={!audioPlayerSelected || audioDraftState.playerReadState === 'reading' || mediaEditorLocked}>Preview / Jump to start</button>}
                {audioDraftState.startMs !== null && audioDraftState.endMs !== null && audioClipRangeError && <p className="inline-error" role="alert">{audioClipRangeError}</p>}
                {audioDraftState.playerReadState === 'error' && <p className="inline-error" role="alert">The page audio player disappeared or its current time could not be read. Reconnect the episode and try again.</p>}
                <div className="annotation-field"><label htmlFor="audio-clip-commentary">Your commentary <span aria-hidden="true">*</span></label><textarea id="audio-clip-commentary" value={audioDraftState.commentary} maxLength={2_000} rows={6} required disabled={mediaEditorLocked} onChange={(event) => changeAudioCommentary(event.target.value)} /><span aria-live="polite">{audioDraftState.commentary.length.toLocaleString()} / 2,000</span></div>
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearAudioDraft()} disabled={audioPublishState.status === 'publishing' || mediaEditorLocked}>Clear clip</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAudioClip()} disabled={!canPublishAudio}>{audioPublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button>}</div>
                {audioPublishState.status === 'error' && <p className="inline-error" role="alert">{audioPublishState.message}</p>}
              </>}
            </section>
          ) : selectedCreateMode === 'text' ? (
            <section className="create-panel" aria-labelledby="create-heading" key="create-text"><div className="section-heading"><h2 id="create-heading">Create annotation</h2><span>Article text</span></div>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this source for unpublished work…</span></div> : captured ? <><blockquote className="captured-passage">{captured.selectedText}</blockquote><dl className="capture-metadata">{captured.author && <div><dt>Author</dt><dd>{captured.author}</dd></div>}{captured.publisher && <div><dt>Publisher</dt><dd>{captured.publisher}</dd></div>}<div><dt>Source</dt><dd>{captured.hostname}</dd></div></dl><div className="annotation-field"><label htmlFor="annotation-commentary">Your commentary</label><textarea id="annotation-commentary" value={commentary} maxLength={2_000} rows={6} disabled={publishState.status === 'publishing'} onChange={(event) => changeCommentary(event.target.value)} /><span aria-live="polite">{commentary.length.toLocaleString()} / 2,000</span></div><AudioRecorder controller={audioRecorder} disabled={publishState.status === 'publishing'} /><div className="create-actions"><button className="button button-secondary" type="button" onClick={clearCapture} disabled={publishState.status === 'publishing'}>Clear capture</button>{authState.status !== 'signed-in' ? <button className="button button-primary" type="button" onClick={() => void beginSignIn()}>Continue with Google</button> : <button className="button button-primary" type="button" onClick={() => void publishAnnotation()} disabled={!canPublish}>{publishState.status === 'publishing' ? 'Publishing…' : 'Publish annotation'}</button>}</div>{publishState.status === 'error' && <p className="inline-error" role="alert">{publishState.message}</p>}</> : <><p className="create-help">Highlight article text in the connected page, then capture it here. Selections and commentary may contain up to 2,000 characters each.</p><button className="button button-primary" type="button" onClick={() => void captureSelection()} disabled={sourceState.status !== 'connected' || isCapturing}>{isCapturing ? 'Capturing…' : 'Capture selected text'}</button>{(captureState.status === 'recoverable-error' || captureState.status === 'reconnect-required' || captureState.status === 'unexpected-error') && <p className="inline-error" role="alert">{captureState.message}</p>}</>}
            </section>
          ) : (
            <div className="compact-state" role="status"><strong>Choose an available mode</strong><span>Annotated is checking the connected page for supported creation options.</span></div>
          )}
          {hostedMediaPanel}
          {supabase && contextUrl && contextCacheKey && <AnnotationCollection key={contextCacheKey} supabase={supabase} cache={socialCacheRef.current} cacheKey={contextCacheKey} sourceUrl={audioSource?.normalizedUrl ?? contextUrl} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} emptyTitle={youtubeSource ? 'No clips on this video yet' : audioSource ? 'No clips on this episode yet' : 'Be the first to annotate this source'} emptyMessage={youtubeSource ? 'Create the first public time-coded annotation below.' : audioSource ? 'Create the first public audio clip below.' : 'Capture a passage below to add the first public annotation.'} compactHeading={youtubeSource ? 'Clips on this video' : audioSource ? 'Clips on this episode' : 'On this source'} />}
        </div>
      )}
      {pendingModeSwitch && (
        <dialog
          ref={modeSwitchDialogRef}
          className="mode-switch-dialog"
          aria-labelledby="mode-switch-dialog-title"
          aria-describedby="mode-switch-dialog-description"
          onCancel={(event) => { event.preventDefault(); dismissModeSwitch(); }}
          onClose={() => setPendingModeSwitch(null)}
        >
          <span className="section-label">Active hosted-media operation</span>
          <h2 id="mode-switch-dialog-title">Cancel {CREATE_MODE_LABELS[pendingModeSwitch.hostedMode]} capture and switch?</h2>
          <p id="mode-switch-dialog-description">
            Switching to {CREATE_MODE_LABELS[pendingModeSwitch.toMode]} will cancel the active {CREATE_MODE_LABELS[pendingModeSwitch.hostedMode]} range from {formatMediaTime(pendingModeSwitch.startMs)} to {formatMediaTime(pendingModeSwitch.endMs)}. Annotated will switch only after cancellation is confirmed.
          </p>
          <div className="mode-switch-dialog-actions">
            <button className="button button-secondary" type="button" autoFocus onClick={dismissModeSwitch}>Keep working</button>
            <button className="button button-secondary danger-button" type="button" onClick={() => void confirmModeSwitch()}>Cancel capture and switch</button>
          </div>
        </dialog>
      )}
    </main>
  );
}

export default App;
