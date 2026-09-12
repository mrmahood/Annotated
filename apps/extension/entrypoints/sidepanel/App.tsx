import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ANNOTATION_TITLE_MAX_LENGTH } from '@annotated/shared/annotation-title';
import { normalizeArticleUrl, ArticleUrlNormalizationError } from '@annotated/shared/url-normalization';
import {
  formatMediaTime,
  getNewMediaPublicationRangeError,
} from '@annotated/shared/media-time';
import { formatMediaTimeTenths, getMediaRangeDisplay } from '../../utils/media-time-display';
import { getTypedClipFieldError } from '../../utils/clip-range-entry';
import { applyClipPresetFromPlayhead } from '../../utils/clip-range';
import { applyCreateClipRangeMark, clearCreateClipRangeMark } from '../../utils/clip-range-mark';
import { ClipRangeEditor, useTypedClipRange } from './clip-range-fields';
import { AppearanceControl } from './appearance-control';
import { BrandLockup } from './logo-mark';
import { getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import { getTikTokVideoIdentity } from '@annotated/shared/tiktok';
import { getSpotifyEpisodeIdentity } from '@annotated/shared/spotify';
import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
import {
  AUDIO_CLIP_DRAFT_STORAGE_KEY,
  audioClipDraftBelongsToSource,
  deserializeAudioClipDraft,
  serializeAudioClipDraft,
  type AudioClipDraft,
} from '../../utils/audio-draft';
import {
  readAudioPageSnapshot,
  validateAudioPageSnapshot,
} from '../../utils/audio-page';
import {
  getSourceState,
  hostedVideoBeginRpc,
  isHostedWatchSource,
  isWebpageVideoCapableSource,
  videoPlayerSourceKey,
  type PageSource,
  type SourceState,
} from '../../utils/connected-source';
import {
  connectedAudioSource,
  connectedSpotifySource,
  createAudioIdentity,
  getModeCapabilities,
} from '../../utils/create-mode-capabilities';
import { beginHostedAudioClipAnnotation } from '../../utils/audio-publishing';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
  isActiveTabContextMessage,
  type ActiveTabContext,
} from '../../utils/active-tab-context';
import { applyPendingArticleHoverOnConnection } from '../../utils/article-hover-pending';
import {
  articleHoverConnectionForTab,
  clearArticleHoverOnConnectedTab,
  leaveArticleHoverLink,
  type ArticleHoverConnection,
} from '../../utils/article-hover-link';
import { applyPendingAudioHoverOnConnection } from '../../utils/audio-hover-pending';
import {
  audioHoverConnectionForTab,
  clearAudioHoverOnConnectedTab,
  leaveAudioHoverLink,
  type AudioHoverConnection,
} from '../../utils/audio-hover-link';
import { applyPendingPageVideoHoverOnConnection } from '../../utils/page-video-hover-pending';
import {
  pageVideoHoverConnectionForTab,
  clearPageVideoHoverOnConnectedTab,
  leavePageVideoHoverLink,
  type PageVideoHoverConnection,
} from '../../utils/page-video-hover-link';
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
  updateAnnotationDraftTitle,
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
import { publishArticleAnnotation, uploadAndAttachOwnerCommentaryAudio } from '../../utils/annotation-publishing';
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
  TIKTOK_CLIP_DRAFT_STORAGE_KEY,
  deserializeTikTokClipDraft,
  serializeTikTokClipDraft,
  tiktokClipDraftBelongsToSource,
  type TikTokClipDraft,
} from '../../utils/tiktok-draft';
import {
  WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY,
  deserializeWebVideoClipDraft,
  serializeWebVideoClipDraft,
  webVideoClipDraftBelongsToSource,
  type WebVideoClipDraft,
} from '../../utils/web-video-draft';
import {
  extractYouTubePageMetadata,
  validateYouTubePageMetadata,
} from '../../utils/youtube-page';
import {
  extractTikTokPageMetadata,
  validateTikTokPageMetadata,
} from '../../utils/tiktok-page';
import {
  actOnTopFramePlayer,
  readTopFramePlayerDiscovery,
  playerDiscoveryMakesModeAvailable,
  reconcilePlayerSelection,
  validatePlayerDiscovery,
  type PlayerDiscovery,
  type PlayerMode,
} from '../../utils/player-discovery';
import { beginHostedWebpageVideoAnnotation } from '../../utils/webpage-video-publishing';
import { beginHostedYouTubeAnnotation } from '../../utils/youtube-publishing';
import { beginHostedTikTokAnnotation } from '../../utils/tiktok-publishing';
import { applyPendingTikTokHoverOnConnection } from '../../utils/tiktok-hover-pending';
import {
  tiktokHoverConnectionForTab,
  clearTikTokHoverOnConnectedTab,
  leaveTikTokHoverLink,
  type TikTokHoverConnection,
} from '../../utils/tiktok-hover-link';
import {
  SPOTIFY_CLIP_DRAFT_STORAGE_KEY,
  deserializeSpotifyClipDraft,
  serializeSpotifyClipDraft,
  spotifyClipDraftBelongsToSource,
  type SpotifyClipDraft,
} from '../../utils/spotify-draft';
import { beginHostedSpotifyAnnotation } from '../../utils/spotify-publishing';
import {
  actOnSpotifyPlayer,
  extractSpotifyPageMetadata,
  readSpotifyPlayerDiscovery,
  validateSpotifyPageMetadata,
  validateSpotifyPlayerDiscovery,
} from '../../utils/spotify-page';
import { applyPendingSpotifyHoverOnConnection } from '../../utils/spotify-hover-pending';
import {
  spotifyHoverConnectionForTab,
  clearSpotifyHoverOnConnectedTab,
  leaveSpotifyHoverLink,
  type SpotifyHoverConnection,
} from '../../utils/spotify-hover-link';
import {
  MEDIA_CAPTURE_CANCEL,
  MEDIA_CAPTURE_EVENT,
  MEDIA_CAPTURE_RETRY,
  MEDIA_CAPTURE_START,
  MEDIA_CAPTURE_STATUS,
  isAudioOnlyCaptureSourceKind,
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
import {
  getCommentaryContractError,
  hasPublishableCommentary,
  isCommentaryRecordingBusy,
} from '../../utils/audio-commentary';
import type { RecordedAudioInput } from '../../utils/annotation-publishing';
import { AudioRecorder, useAudioRecorder, type AudioRecorderController } from './audio-recorder';

const RECONNECT_MESSAGE = 'Click the Annotated toolbar icon on this page to reconnect, then try again.';
const RESTRICTED_PAGE_MESSAGE = 'Annotated cannot capture text from this page.';
const UNEXPECTED_CAPTURE_MESSAGE = 'Something went wrong while capturing the passage. Try again.';

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

function audioCaptureSourceIdentity(
  source: PageSource,
  pageUrl: string,
  playerIdentity: string,
): CaptureSourceIdentity | null {
  if (source.classification === 'Spotify') {
    return { kind: 'spotify', pageUrl, sourceKey: source.episodeId, playerIdentity };
  }
  const pageAudio = connectedAudioSource(source);
  if (pageAudio) {
    return { kind: 'audio', pageUrl, sourceKey: pageAudio.normalizedUrl, playerIdentity };
  }
  return null;
}

function recordedCommentaryFrom(controller: AudioRecorderController): RecordedAudioInput | undefined {
  return controller.state.status === 'recorded'
    ? { blob: controller.state.blob, durationMs: controller.state.durationMs }
    : undefined;
}

function reportCommentaryCleanup(diagnostic: { message: string }) {
  if (import.meta.env.DEV) {
    console.warn('Audio upload cleanup failed after publication error.', diagnostic);
  }
}

async function attachHostedCommentaryOrCancel(
  supabase: SupabaseClient,
  operation: HostedMediaOperation,
  sourceUrl: string,
  mode: MediaCreateMode,
  startMs: number,
  endMs: number,
  recorded: RecordedAudioInput | undefined,
  cancel: (
    operation: HostedMediaOperation,
    sourceUrl: string,
    mode: MediaCreateMode,
    startMs: number,
    endMs: number,
  ) => Promise<void>,
): Promise<void> {
  if (!recorded) return;
  try {
    await uploadAndAttachOwnerCommentaryAudio(
      supabase,
      operation.annotationId,
      recorded,
      reportCommentaryCleanup,
    );
  } catch (error) {
    await cancel(operation, sourceUrl, mode, startMs, endMs);
    throw error;
  }
}

function persistableAudioIdentity(source: PageSource): { url: string; canonicalUrl: string } | null {
  const identity = createAudioIdentity(source);
  return identity && 'canonicalUrl' in identity
    ? { url: identity.url, canonicalUrl: identity.canonicalUrl }
    : null;
}

function getCreatePageSourceKey(url: string): string | null {
  try {
    return getYouTubeVideoIdentity(url).normalizedUrl;
  } catch {
    try {
      return getTikTokVideoIdentity(url).normalizedUrl;
    } catch {
      try {
        return getSpotifyEpisodeIdentity(url).normalizedUrl;
      } catch {
        try { return normalizeArticleUrl(url); } catch { return null; }
      }
    }
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
      <div><h2>{state.source.title}</h2>{state.source.classification === 'YouTube' && state.source.channelName && <p>{state.source.channelName}</p>}{state.source.classification === 'TikTok' && state.source.author && <p>{state.source.author}</p>}{state.source.classification === 'Spotify' && (state.source.showName || state.source.author) && <p>{state.source.showName ?? state.source.author}</p>}{state.source.classification === 'Podcast / web audio' && (state.source.showName || state.source.publisher) && <p>{state.source.showName ?? state.source.publisher}</p>}<p>{state.source.hostname}</p></div>
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

function SignInActions({
  onSignIn,
}: {
  onSignIn: (provider: AuthProvider) => void;
}) {
  return (
    <div className="account-sign-in-actions">
      <button className="button button-primary" type="button" onClick={() => void onSignIn('google')}>
        Continue with Google
      </button>
      {EXTENSION_AUTH_CAPABILITIES.x ? (
        <button className="button button-secondary" type="button" onClick={() => void onSignIn('x')}>
          Continue with X
        </button>
      ) : null}
    </div>
  );
}

function TitleField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="annotation-field annotation-title-field">
      <label className="visually-hidden" htmlFor={id}>Title</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={ANNOTATION_TITLE_MAX_LENGTH}
        disabled={disabled}
        placeholder="Add a title…"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function CommentaryField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="annotation-field">
      <label className="visually-hidden" htmlFor={id}>Commentary</label>
      <textarea
        id={id}
        value={value}
        maxLength={2_000}
        rows={5}
        disabled={disabled}
        placeholder="Add a note…"
        onChange={(event) => onChange(event.target.value)}
      />
      <span aria-live="polite">{value.length.toLocaleString()} / 2,000</span>
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
  const tiktokDraftRef = useRef<TikTokClipDraft | null>(null);
  const webVideoDraftRef = useRef<WebVideoClipDraft | null>(null);
  const audioDraftRef = useRef<AudioClipDraft | null>(null);
  const spotifyDraftRef = useRef<SpotifyClipDraft | null>(null);
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
  const articleHoverRef = useRef<ArticleHoverConnection | null>(null);
  const audioHoverRef = useRef<AudioHoverConnection | null>(null);
  const pageVideoHoverRef = useRef<PageVideoHoverConnection | null>(null);
  const tiktokHoverRef = useRef<TikTokHoverConnection | null>(null);
  const spotifyHoverRef = useRef<SpotifyHoverConnection | null>(null);
  const textCommentaryRecorder = useAudioRecorder();
  const videoCommentaryRecorder = useAudioRecorder();
  const audioCommentaryRecorder = useAudioRecorder();

  const title = createDraftState.text.title;
  const commentary = createDraftState.text.commentary;
  const videoDraftState = createDraftState.video;
  const audioDraftState = createDraftState.audio;
  createDraftStateRef.current = createDraftState;
  modeSelectionRef.current = modeSelection;
  playerIdentityRef.current = {
    video: videoDraftState.playerIdentity,
    audio: audioDraftState.playerIdentity,
  };
  const modeCapabilities = useMemo(
    () => getModeCapabilities(sourceState),
    [sourceState],
  );
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
    draftTitle = createDraftStateRef.current.video.title,
  ) => {
    try {
      const draft = serializeYouTubeClipDraft(sourceUrl, startMs, endMs, text, Date.now(), draftTitle);
      youtubeDraftRef.current = draft;
      webVideoDraftRef.current = null;
      tiktokDraftRef.current = null;
      void chrome.storage.session
        .set({ [YOUTUBE_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove([
          WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY,
          TIKTOK_CLIP_DRAFT_STORAGE_KEY,
        ]))
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

  const persistTikTokDraft = useCallback((
    sourceUrl: string,
    startMs: number | null,
    endMs: number | null,
    text: string,
    draftTitle = createDraftStateRef.current.video.title,
  ) => {
    try {
      const draft = serializeTikTokClipDraft(sourceUrl, startMs, endMs, text, Date.now(), draftTitle);
      tiktokDraftRef.current = draft;
      youtubeDraftRef.current = null;
      webVideoDraftRef.current = null;
      void chrome.storage.session
        .set({ [TIKTOK_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove([
          YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
          WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY,
        ]))
        .catch(() => console.warn('Unable to save the TikTok clip draft.'));
    } catch {
      // Invalid transient input is never persisted.
    }
  }, []);

  const clearTikTokDraft = useCallback(async () => {
    tiktokDraftRef.current = null;
    dispatchCreateDraft({ type: 'reset-mode', mode: 'video' });
    setYoutubePublishState({ status: 'idle' });
    try {
      await chrome.storage.session.remove(TIKTOK_CLIP_DRAFT_STORAGE_KEY);
    } catch {
      console.warn('Unable to clear the TikTok clip draft.');
    }
  }, []);

  const persistWebVideoDraft = useCallback((
    sourceUrl: string,
    startMs: number | null,
    endMs: number | null,
    text: string,
    draftTitle = createDraftStateRef.current.video.title,
  ) => {
    try {
      const draft = serializeWebVideoClipDraft(sourceUrl, startMs, endMs, text, Date.now(), draftTitle);
      webVideoDraftRef.current = draft;
      youtubeDraftRef.current = null;
      tiktokDraftRef.current = null;
      void chrome.storage.session.set({ [WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove([
          YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
          TIKTOK_CLIP_DRAFT_STORAGE_KEY,
        ]))
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
    videoCommentaryRecorder.discard();
    const source = sourceState.status === 'connected' ? sourceState.source : null;
    const context = connectedContextRef.current;
    if (source && context) {
      void clearCreateClipRangeMark({
        source,
        connection: { tabId: context.tabId, tabUrl: source.url },
        mode: 'video',
      });
    }
    if (source?.classification === 'YouTube' && youtubeDraftRef.current) await clearYoutubeDraft();
    else if (source?.classification === 'TikTok' && tiktokDraftRef.current) await clearTikTokDraft();
    else if (source && isWebpageVideoCapableSource(source) && webVideoDraftRef.current) await clearWebVideoDraft();
    else if (youtubeDraftRef.current) await clearYoutubeDraft();
    else if (tiktokDraftRef.current) await clearTikTokDraft();
    else await clearWebVideoDraft();
  }, [clearTikTokDraft, clearWebVideoDraft, clearYoutubeDraft, sourceState, videoCommentaryRecorder.discard]);

  const persistAudioDraft = useCallback((
    source: { url: string; canonicalUrl: string },
    startMs: number | null,
    endMs: number | null,
    text: string,
    draftTitle = createDraftStateRef.current.audio.title,
  ) => {
    try {
      const draft = serializeAudioClipDraft(
        source.url,
        source.canonicalUrl,
        startMs,
        endMs,
        text,
        Date.now(),
        draftTitle,
      );
      audioDraftRef.current = draft;
      spotifyDraftRef.current = null;
      void chrome.storage.session
        .set({ [AUDIO_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove(SPOTIFY_CLIP_DRAFT_STORAGE_KEY))
        .catch(() => console.warn('Unable to save the audio clip draft.'));
    } catch { /* Invalid transient input is never persisted. */ }
  }, []);

  const persistSpotifyDraft = useCallback((
    sourceUrl: string,
    startMs: number | null,
    endMs: number | null,
    text: string,
    draftTitle = createDraftStateRef.current.audio.title,
  ) => {
    try {
      const draft = serializeSpotifyClipDraft(sourceUrl, startMs, endMs, text, Date.now(), draftTitle);
      spotifyDraftRef.current = draft;
      audioDraftRef.current = null;
      void chrome.storage.session
        .set({ [SPOTIFY_CLIP_DRAFT_STORAGE_KEY]: draft })
        .then(() => chrome.storage.session.remove(AUDIO_CLIP_DRAFT_STORAGE_KEY))
        .catch(() => console.warn('Unable to save the Spotify clip draft.'));
    } catch {
      // Invalid transient input is never persisted.
    }
  }, []);

  const clearAudioDraft = useCallback(async () => {
    audioCommentaryRecorder.discard();
    const source = sourceState.status === 'connected' ? sourceState.source : null;
    const context = connectedContextRef.current;
    if (source && context) {
      void clearCreateClipRangeMark({
        source,
        connection: { tabId: context.tabId, tabUrl: source.url },
        mode: 'audio',
      });
    }
    audioDraftRef.current = null;
    spotifyDraftRef.current = null;
    dispatchCreateDraft({ type: 'reset-mode', mode: 'audio' });
    setAudioPublishState({ status: 'idle' });
    try {
      await chrome.storage.session.remove([
        AUDIO_CLIP_DRAFT_STORAGE_KEY,
        SPOTIFY_CLIP_DRAFT_STORAGE_KEY,
      ]);
    } catch { console.warn('Unable to clear the audio clip draft.'); }
  }, [audioCommentaryRecorder.discard, sourceState]);

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
    textCommentaryRecorder.discard();
    setCaptureState({ status: 'idle' });
    dispatchCreateDraft({ type: 'reset-mode', mode: 'text' });
    setPublishState({ status: 'idle' });
    await removePersistedDraft();
  }, [removePersistedDraft, textCommentaryRecorder.discard]);

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
      dispatchCreateDraft({ type: 'set-text-title', title: draft.title });
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
        title: youtubeDraft.title,
      });
    }
    const tiktokDraft = tiktokDraftRef.current;
    if (tiktokDraft && context && tiktokClipDraftBelongsToSource(tiktokDraft, context.url)) {
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'video',
        sourceKey: tiktokDraft.source.videoId,
        startMs: tiktokDraft.startMs,
        endMs: tiktokDraft.endMs,
        commentary: tiktokDraft.commentary,
        title: tiktokDraft.title,
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
        title: webVideoDraft.title,
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
        title: audioDraft.title,
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
        draft = serializeAnnotationDraft(context, result.data, '', Date.now(), createDraftStateRef.current.text.title);
      } catch {
        enterReconnectRequired();
        return;
      }
      textCommentaryRecorder.discard();
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
  }, [clearDraft, enterReconnectRequired, persistDraft, textCommentaryRecorder.discard]);

  const publishAnnotation = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      captureState.status !== 'captured' ||
      !hasPublishableCommentary(commentary, textCommentaryRecorder.state.status === 'recorded') ||
      isCommentaryRecordingBusy(textCommentaryRecorder.state.status)
    ) return;
    const page = createPageRef.current;
    if (!page) return;
    const token = createModeAsyncToken(page, getDraftRevisions(createDraftStateRef.current), 'text');
    publishInFlightRef.current = true;
    setPublishState({ status: 'publishing' });
    try {
      const captured = captureState.data;
      const normalizedUrl = normalizeArticleUrl(captured.canonicalUrl || captured.sourceUrl);
      const recordedAudio = recordedCommentaryFrom(textCommentaryRecorder);
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
          annotationTitle: title,
        },
        recordedAudio,
        reportCommentaryCleanup,
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
  }, [authState.status, captureState, clearDraft, commentary, supabase, textCommentaryRecorder, title]);

  const runSelectedPlayerAction = useCallback(async (
    token: PlayerActionToken,
    action: 'read' | 'play' | 'preview',
    startSeconds: number | null,
    endSeconds: number | null = null,
  ) => {
    const { mode, playerIdentity: identity } = token;
    if (!playerTokenIsCurrent(token)) throw new Error('This player action is no longer current.');
    if (sourceState.status !== 'connected') throw new Error('Choose a player first.');
    const context = connectedContextRef.current;
    if (!context) throw new Error(RECONNECT_MESSAGE);
    const genericVideo = mode === 'video' && isWebpageVideoCapableSource(sourceState.source);
    const audioIdentity = connectedAudioSource(sourceState.source);
    const spotifyIdentity = connectedSpotifySource(sourceState.source);
    if (mode === 'audio' && !audioIdentity && !spotifyIdentity) throw new Error(RECONNECT_MESSAGE);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id !== context.tabId) throw new Error(RECONNECT_MESSAGE);
    const execution = spotifyIdentity && mode === 'audio'
      ? await chrome.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        func: actOnSpotifyPlayer,
        args: [identity, spotifyIdentity.episodeId, action, startSeconds, endSeconds],
      })
      : await chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      // The page's own world is required to traverse readable same-origin frames.
      // Only bounded generic-video identity/time data crosses this call boundary.
      world: genericVideo ? 'MAIN' : 'ISOLATED',
      func: actOnTopFramePlayer,
      args: [
        mode,
        identity,
        sourceState.source.classification === 'YouTube' || sourceState.source.classification === 'TikTok'
          ? sourceState.source.videoId
          : mode === 'video'
            ? normalizeArticleUrl(sourceState.source.url)
            : audioIdentity?.normalizedUrl ?? '',
        action,
        startSeconds,
        genericVideo,
        endSeconds,
      ],
    });
    const result = execution[0]?.result;
    if (!result?.ok || result.identity !== identity) {
      if (spotifyIdentity && mode === 'audio' && result && !result.ok) {
        throw new Error(
          result.reason === 'playback-failed'
            ? 'The Spotify player could not seek to the clip start.'
            : result.reason === 'player-not-ready'
              ? 'The Spotify now-playing time could not be read.'
              : 'The selected player changed. Choose it again.',
        );
      }
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

  const readConnectedPlayer = useCallback(async () => {
    if (
      sourceState.status !== 'connected'
    ) return null;
    const mode: PlayerMode | null = modeSelection?.selectedMode === 'video'
      ? 'video'
      : modeSelection?.selectedMode === 'audio' ? 'audio' : null;
    const audioIdentity = connectedAudioSource(sourceState.source);
    const spotifyIdentity = connectedSpotifySource(sourceState.source);
    if (!mode || (mode === 'audio' && !audioIdentity && !spotifyIdentity)) return null;
    const draft = mode === 'video' ? videoDraftState : audioDraftState;
    let token: PlayerActionToken;
    try { token = getPlayerActionToken(mode, draft.playerIdentity); } catch { return null; }
    dispatchCreateDraft({ type: 'set-player-read-state', mode, state: 'reading' });
    try {
      const player = await runSelectedPlayerAction(token, 'read', null);
      if (!playerTokenIsCurrent(token)) return null;
      dispatchCreateDraft({
        type: 'patch-media', mode,
        patch: {
          sourceKey: mode === 'video'
            ? videoPlayerSourceKey(sourceState.source)
            : spotifyIdentity?.normalizedUrl ?? audioIdentity?.normalizedUrl ?? '',
          playerIdentity: draft.playerIdentity,
          playerTimeMs: player.currentTimeMs,
          durationMs: player.durationMs,
          playerReadState: 'idle',
        },
      });
      return player;
    } catch {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode, state: 'error' });
      }
      return null;
    }
  }, [audioDraftState, getPlayerActionToken, modeSelection?.selectedMode, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, videoDraftState]);

  const applyMediaClipPreset = useCallback(async (presetMs: number) => {
    const player = await readConnectedPlayer();
    if (!player) return;
    const mode: PlayerMode | null = modeSelection?.selectedMode === 'video'
      ? 'video'
      : modeSelection?.selectedMode === 'audio' ? 'audio' : null;
    if (!mode) return;
    const range = applyClipPresetFromPlayhead(player.currentTimeMs, player.durationMs, presetMs);
    const sourceKey = sourceState.status === 'connected'
      ? (mode === 'video'
        ? videoPlayerSourceKey(sourceState.source)
        : connectedSpotifySource(sourceState.source)?.normalizedUrl
          ?? connectedAudioSource(sourceState.source)?.normalizedUrl
          ?? '')
      : '';
    dispatchCreateDraft({
      type: 'patch-media',
      mode,
      patch: { startMs: range.startMs, endMs: range.endMs, sourceKey, durationMs: player.durationMs, playerTimeMs: player.currentTimeMs },
    });
    if (sourceState.status !== 'connected') return;
    const context = connectedContextRef.current;
    if (context) {
      void applyCreateClipRangeMark({
        source: sourceState.source,
        connection: { tabId: context.tabId, tabUrl: sourceState.source.url },
        startMs: range.startMs,
        endMs: range.endMs,
        mode,
      });
    }
    if (mode === 'video' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, range.startMs, range.endMs, videoDraftState.commentary);
    } else if (mode === 'video' && sourceState.source.classification === 'TikTok') {
      persistTikTokDraft(sourceState.source.url, range.startMs, range.endMs, videoDraftState.commentary);
    } else if (mode === 'video') {
      persistWebVideoDraft(sourceState.source.url, range.startMs, range.endMs, videoDraftState.commentary);
    } else if (mode === 'audio') {
      const spotifyIdentity = connectedSpotifySource(sourceState.source);
      const persistable = persistableAudioIdentity(sourceState.source);
      if (spotifyIdentity) persistSpotifyDraft(spotifyIdentity.url, range.startMs, range.endMs, audioDraftState.commentary);
      else if (persistable) persistAudioDraft(persistable, range.startMs, range.endMs, audioDraftState.commentary);
    }
  }, [audioDraftState.commentary, modeSelection?.selectedMode, persistAudioDraft, persistSpotifyDraft, persistTikTokDraft, persistWebVideoDraft, persistYoutubeDraft, readConnectedPlayer, sourceState, videoDraftState.commentary]);

  const changeYoutubeTitle = (value: string) => {
    const sourceKey = sourceState.status === 'connected'
      ? videoPlayerSourceKey(sourceState.source)
      : videoDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { title: value, sourceKey } });
    if (sourceState.status === 'connected' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, videoDraftState.commentary, value);
    } else if (sourceState.status === 'connected' && sourceState.source.classification === 'TikTok') {
      persistTikTokDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, videoDraftState.commentary, value);
    } else if (sourceState.status === 'connected') {
      persistWebVideoDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, videoDraftState.commentary, value);
    }
  };

  const changeYoutubeCommentary = (value: string) => {
    const sourceKey = sourceState.status === 'connected'
      ? videoPlayerSourceKey(sourceState.source)
      : videoDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { commentary: value, sourceKey } });
    if (sourceState.status === 'connected' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, value);
    } else if (sourceState.status === 'connected' && sourceState.source.classification === 'TikTok') {
      persistTikTokDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, value);
    } else if (sourceState.status === 'connected') {
      persistWebVideoDraft(sourceState.source.url, videoDraftState.startMs, videoDraftState.endMs, value);
    }
  };

  const changeAudioTitle = (value: string) => {
    const persistable = sourceState.status === 'connected'
      ? persistableAudioIdentity(sourceState.source)
      : null;
    const spotifyIdentity = sourceState.status === 'connected'
      ? connectedSpotifySource(sourceState.source)
      : null;
    const sourceKey = spotifyIdentity?.normalizedUrl
      ?? (sourceState.status === 'connected' ? createAudioIdentity(sourceState.source)?.normalizedUrl : null)
      ?? audioDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { title: value, sourceKey } });
    if (spotifyIdentity) {
      persistSpotifyDraft(spotifyIdentity.url, audioDraftState.startMs, audioDraftState.endMs, audioDraftState.commentary, value);
    } else if (persistable) {
      persistAudioDraft(persistable, audioDraftState.startMs, audioDraftState.endMs, audioDraftState.commentary, value);
    }
  };

  const changeAudioCommentary = (value: string) => {
    const persistable = sourceState.status === 'connected'
      ? persistableAudioIdentity(sourceState.source)
      : null;
    const spotifyIdentity = sourceState.status === 'connected'
      ? connectedSpotifySource(sourceState.source)
      : null;
    const sourceKey = spotifyIdentity?.normalizedUrl
      ?? (sourceState.status === 'connected' ? createAudioIdentity(sourceState.source)?.normalizedUrl : null)
      ?? audioDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { commentary: value, sourceKey } });
    if (spotifyIdentity) {
      persistSpotifyDraft(spotifyIdentity.url, audioDraftState.startMs, audioDraftState.endMs, value);
    } else if (persistable) {
      persistAudioDraft(persistable, audioDraftState.startMs, audioDraftState.endMs, value);
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
      mediaType: isAudioOnlyCaptureSourceKind(source.kind) ? 'audio' : 'video',
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
      !hasPublishableCommentary(videoDraftState.commentary, videoCommentaryRecorder.state.status === 'recorded') ||
      isCommentaryRecordingBusy(videoCommentaryRecorder.state.status) ||
      !videoDraftState.playerIdentity
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      videoDraftState.startMs,
      videoDraftState.endMs,
      videoDraftState.durationMs,
    );
    const commentaryError = getCommentaryContractError(
      videoDraftState.commentary,
      videoCommentaryRecorder.state.status === 'recorded',
    );
    if (rangeError || commentaryError) {
      setYoutubePublishState({ status: 'error', message: rangeError ?? commentaryError ?? 'Commentary cannot exceed 2,000 characters.' });
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
      const recordedCommentary = recordedCommentaryFrom(videoCommentaryRecorder);
      const operation = await beginHostedYouTubeAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        title: sourceState.source.title,
        channelName: sourceState.source.channelName,
        startMs: videoDraftState.startMs,
        endMs: videoDraftState.endMs,
        commentaryText: videoDraftState.commentary,
        annotationTitle: videoDraftState.title,
        hasRecordedCommentary: Boolean(recordedCommentary),
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
      await attachHostedCommentaryOrCancel(
        supabase,
        operation,
        sourceState.source.url,
        'video',
        videoDraftState.startMs,
        videoDraftState.endMs,
        recordedCommentary,
        cancelStaleHostedBegin,
      );
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
  }, [authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase, videoCommentaryRecorder, videoDraftState]);

  const publishTikTokClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' || sourceState.source.classification !== 'TikTok' ||
      videoDraftState.startMs === null || videoDraftState.endMs === null ||
      !hasPublishableCommentary(videoDraftState.commentary, videoCommentaryRecorder.state.status === 'recorded') ||
      isCommentaryRecordingBusy(videoCommentaryRecorder.state.status) ||
      !videoDraftState.playerIdentity
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      videoDraftState.startMs,
      videoDraftState.endMs,
      videoDraftState.durationMs,
    );
    const commentaryError = getCommentaryContractError(
      videoDraftState.commentary,
      videoCommentaryRecorder.state.status === 'recorded',
    );
    if (rangeError || commentaryError) {
      setYoutubePublishState({ status: 'error', message: rangeError ?? commentaryError ?? 'Commentary cannot exceed 2,000 characters.' });
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
      const recordedCommentary = recordedCommentaryFrom(videoCommentaryRecorder);
      const operation = await beginHostedTikTokAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        title: sourceState.source.title,
        author: sourceState.source.author,
        startMs: videoDraftState.startMs,
        endMs: videoDraftState.endMs,
        commentaryText: videoDraftState.commentary,
        annotationTitle: videoDraftState.title,
        hasRecordedCommentary: Boolean(recordedCommentary),
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
      await attachHostedCommentaryOrCancel(
        supabase,
        operation,
        sourceState.source.url,
        'video',
        videoDraftState.startMs,
        videoDraftState.endMs,
        recordedCommentary,
        cancelStaleHostedBegin,
      );
      await startHostedCapture(operation, {
        kind: 'tiktok',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.videoId,
        playerIdentity: videoDraftState.playerIdentity,
      }, videoDraftState.startMs, videoDraftState.endMs);
      setYoutubePublishState({ status: 'idle' });
    } catch (error) {
      setYoutubePublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The TikTok clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
      if (hostedBeginModeRef.current === 'video') {
        hostedBeginModeRef.current = null;
        setHostedBeginMode(null);
      }
    }
  }, [authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase, videoCommentaryRecorder, videoDraftState]);

  const publishWebpageVideoClip = useCallback(async () => {
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' ||
      videoDraftState.startMs === null || videoDraftState.endMs === null ||
      !hasPublishableCommentary(videoDraftState.commentary, videoCommentaryRecorder.state.status === 'recorded') ||
      isCommentaryRecordingBusy(videoCommentaryRecorder.state.status) ||
      !videoDraftState.playerIdentity
    ) return;
    if (!isWebpageVideoCapableSource(sourceState.source)) return;
    if (hostedVideoBeginRpc(sourceState.source.url) !== 'begin_hosted_webpage_video_annotation') {
      setYoutubePublishState({
        status: 'error',
        message: hostedVideoBeginRpc(sourceState.source.url) === 'begin_hosted_tiktok_annotation'
          ? 'Webpage video clips cannot use a TikTok watch URL. Use the TikTok hosted begin path.'
          : 'Webpage video clips cannot use a YouTube watch URL. Use the YouTube hosted begin path.',
      });
      return;
    }
    if (!sourceState.source.videoDetectionResolved || !sourceState.source.videoAvailable) return;
    const rangeError = getNewMediaPublicationRangeError(
      videoDraftState.startMs,
      videoDraftState.endMs,
      videoDraftState.durationMs,
    );
    const commentaryError = getCommentaryContractError(
      videoDraftState.commentary,
      videoCommentaryRecorder.state.status === 'recorded',
    );
    if (rangeError || commentaryError) {
      setYoutubePublishState({ status: 'error', message: rangeError ?? commentaryError ?? 'Commentary cannot exceed 2,000 characters.' });
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
      const normalizedUrl = normalizeArticleUrl(sourceState.source.url);
      const recordedCommentary = recordedCommentaryFrom(videoCommentaryRecorder);
      const operation = await beginHostedWebpageVideoAnnotation(supabase, {
        sourceUrl: sourceState.source.url,
        title: sourceState.source.title,
        author: null,
        publisher: null,
        startMs: videoDraftState.startMs,
        endMs: videoDraftState.endMs,
        commentaryText: videoDraftState.commentary,
        annotationTitle: videoDraftState.title,
        hasRecordedCommentary: Boolean(recordedCommentary),
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
      await attachHostedCommentaryOrCancel(
        supabase,
        operation,
        sourceState.source.url,
        'video',
        videoDraftState.startMs,
        videoDraftState.endMs,
        recordedCommentary,
        cancelStaleHostedBegin,
      );
      await startHostedCapture(operation, {
        kind: 'web-video',
        pageUrl: sourceState.source.url,
        sourceKey: normalizedUrl,
        playerIdentity: videoDraftState.playerIdentity,
      }, videoDraftState.startMs, videoDraftState.endMs);
      setYoutubePublishState({ status: 'idle' });
    } catch (error) {
      setYoutubePublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The webpage video clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
      if (hostedBeginModeRef.current === 'video') {
        hostedBeginModeRef.current = null;
        setHostedBeginMode(null);
      }
    }
  }, [authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase, videoCommentaryRecorder, videoDraftState]);

  const publishSpotifyClip = useCallback(async () => {
    const spotifyIdentity = sourceState.status === 'connected'
      ? connectedSpotifySource(sourceState.source)
      : null;
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' || !spotifyIdentity ||
      audioDraftState.startMs === null || audioDraftState.endMs === null ||
      !hasPublishableCommentary(audioDraftState.commentary, audioCommentaryRecorder.state.status === 'recorded') ||
      isCommentaryRecordingBusy(audioCommentaryRecorder.state.status) ||
      !audioDraftState.playerIdentity
    ) return;
    if (spotifyIdentity.pageBlock === 'login') {
      setAudioPublishState({ status: 'error', message: 'This Spotify tab is not playing an episode. Start the preview or sign in if it is gated, then try again.' });
      return;
    }
    const rangeError = getNewMediaPublicationRangeError(
      audioDraftState.startMs,
      audioDraftState.endMs,
      audioDraftState.durationMs,
    );
    const commentaryError = getCommentaryContractError(
      audioDraftState.commentary,
      audioCommentaryRecorder.state.status === 'recorded',
    );
    if (rangeError || commentaryError) {
      setAudioPublishState({ status: 'error', message: rangeError ?? commentaryError ?? 'Commentary cannot exceed 2,000 characters.' });
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
      const actionRangeError = getNewMediaPublicationRangeError(
        audioDraftState.startMs, audioDraftState.endMs, player.durationMs,
      );
      if (actionRangeError) throw new Error(actionRangeError);
      const recordedCommentary = recordedCommentaryFrom(audioCommentaryRecorder);
      const operation = await beginHostedSpotifyAnnotation(supabase, {
        sourceUrl: spotifyIdentity.url,
        title: spotifyIdentity.title,
        author: spotifyIdentity.author,
        showName: spotifyIdentity.showName,
        startMs: audioDraftState.startMs,
        endMs: audioDraftState.endMs,
        commentaryText: audioDraftState.commentary,
        annotationTitle: audioDraftState.title,
        hasRecordedCommentary: Boolean(recordedCommentary),
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
      await attachHostedCommentaryOrCancel(
        supabase,
        operation,
        sourceState.source.url,
        'audio',
        audioDraftState.startMs,
        audioDraftState.endMs,
        recordedCommentary,
        cancelStaleHostedBegin,
      );
      await startHostedCapture(operation, {
        kind: 'spotify',
        pageUrl: sourceState.source.url,
        sourceKey: spotifyIdentity.episodeId,
        playerIdentity: audioDraftState.playerIdentity,
      }, audioDraftState.startMs, audioDraftState.endMs);
      setAudioPublishState({ status: 'idle' });
    } catch (error) {
      setAudioPublishState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The Spotify clip could not be published.',
      });
    } finally {
      publishInFlightRef.current = false;
      if (hostedBeginModeRef.current === 'audio') {
        hostedBeginModeRef.current = null;
        setHostedBeginMode(null);
      }
    }
  }, [audioCommentaryRecorder, audioDraftState, authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase]);

  const publishAudioClip = useCallback(async () => {
    const audioIdentity = sourceState.status === 'connected'
      ? connectedAudioSource(sourceState.source)
      : null;
    if (
      !supabase || publishInFlightRef.current || authState.status !== 'signed-in' ||
      sourceState.status !== 'connected' || !audioIdentity ||
      connectedSpotifySource(sourceState.source) ||
      audioDraftState.startMs === null || audioDraftState.endMs === null ||
      !hasPublishableCommentary(audioDraftState.commentary, audioCommentaryRecorder.state.status === 'recorded') ||
      isCommentaryRecordingBusy(audioCommentaryRecorder.state.status) ||
      audioDraftState.durationMs === null ||
      !audioDraftState.playerIdentity
    ) return;
    const rangeError = getNewMediaPublicationRangeError(
      audioDraftState.startMs,
      audioDraftState.endMs,
      audioDraftState.durationMs,
    );
    const commentaryError = getCommentaryContractError(
      audioDraftState.commentary,
      audioCommentaryRecorder.state.status === 'recorded',
    );
    if (rangeError || commentaryError) {
      setAudioPublishState({ status: 'error', message: rangeError ?? commentaryError ?? 'Commentary cannot exceed 2,000 characters.' });
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
      if (!('canonicalUrl' in audioIdentity)) {
        throw new Error('The connected audio source could not be published.');
      }
      const captureSource = audioCaptureSourceIdentity(
        sourceState.source,
        sourceState.source.url,
        audioDraftState.playerIdentity,
      );
      if (!captureSource) throw new Error('The connected audio source could not be published.');
      const recordedCommentary = recordedCommentaryFrom(audioCommentaryRecorder);
      const operation = await beginHostedAudioClipAnnotation(supabase, {
        sourceUrl: audioIdentity.url,
        canonicalUrl: audioIdentity.canonicalUrl,
        title: audioIdentity.title,
        author: audioIdentity.author,
        publisher: audioIdentity.publisher,
        showName: audioIdentity.showName,
        startMs: audioDraftState.startMs,
        endMs: audioDraftState.endMs,
        commentaryText: audioDraftState.commentary,
        annotationTitle: audioDraftState.title,
        hasRecordedCommentary: Boolean(recordedCommentary),
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
      await attachHostedCommentaryOrCancel(
        supabase,
        operation,
        sourceState.source.url,
        'audio',
        audioDraftState.startMs,
        audioDraftState.endMs,
        recordedCommentary,
        cancelStaleHostedBegin,
      );
      await startHostedCapture(operation, captureSource, audioDraftState.startMs, audioDraftState.endMs);
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
  }, [audioCommentaryRecorder, audioDraftState, authState.status, cancelStaleHostedBegin, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, supabase]);

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
    } else if (session.mediaType === 'video' && sourceState.source.classification === 'TikTok') {
      let originalVideoId: string | null = null;
      try { originalVideoId = getTikTokVideoIdentity(session.sourceUrl).videoId; } catch { /* Invalid persisted source. */ }
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
        kind: 'tiktok',
        pageUrl: sourceState.source.url,
        sourceKey: sourceState.source.videoId,
        playerIdentity: videoDraftState.playerIdentity,
      }, session.startMs, session.endMs);
    } else if (
      session.mediaType === 'video' &&
      isWebpageVideoCapableSource(sourceState.source) &&
      sourceState.source.videoAvailable
    ) {
      let originalPageIdentity: string | null = null;
      try { originalPageIdentity = normalizeArticleUrl(session.sourceUrl); } catch { /* Invalid persisted source. */ }
      let connectedPageIdentity: string | null = null;
      try { connectedPageIdentity = normalizeArticleUrl(sourceState.source.url); } catch { /* Invalid connected source. */ }
      if (!originalPageIdentity || originalPageIdentity !== connectedPageIdentity) {
        setMediaCaptureState({
          status: 'error',
          captureId: null,
          code: 'connected-source-changed',
          message: 'Reconnect the original page before recapturing this draft.',
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
        kind: 'web-video',
        pageUrl: sourceState.source.url,
        sourceKey: connectedPageIdentity,
        playerIdentity: videoDraftState.playerIdentity,
      }, session.startMs, session.endMs);
    } else if (
      session.mediaType === 'audio' &&
      connectedSpotifySource(sourceState.source)
    ) {
      const spotifyIdentity = connectedSpotifySource(sourceState.source)!;
      let originalEpisodeId: string | null = null;
      try { originalEpisodeId = getSpotifyEpisodeIdentity(session.sourceUrl).episodeId; } catch { /* Invalid persisted source. */ }
      if (originalEpisodeId !== spotifyIdentity.episodeId) {
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
        kind: 'spotify',
        pageUrl: sourceState.source.url,
        sourceKey: spotifyIdentity.episodeId,
        playerIdentity: audioDraftState.playerIdentity,
      }, session.startMs, session.endMs);
    } else if (
      session.mediaType === 'audio' &&
      connectedAudioSource(sourceState.source)
    ) {
      const audioIdentity = connectedAudioSource(sourceState.source)!;
      let originalAudioIdentity: string | null = null;
      try { originalAudioIdentity = getAudioSourceIdentity(session.sourceUrl).normalizedUrl; } catch { /* Invalid persisted source. */ }
      if (originalAudioIdentity !== audioIdentity.normalizedUrl) {
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
        sourceKey: audioIdentity.normalizedUrl,
        playerIdentity: audioDraftState.playerIdentity,
      }, session.startMs, session.endMs);
    }
  }, [audioDraftState.playerIdentity, getPlayerActionToken, hostedMediaSession, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, startHostedCapture, videoDraftState.playerIdentity]);

  const playConnectedClip = useCallback(async (
    annotation: Extract<PublicAnnotation, { kind: 'youtube' | 'tiktok' }>,
  ) => {
    if (
      sourceState.status !== 'connected' ||
      !isHostedWatchSource(sourceState.source) ||
      sourceState.source.videoId !== annotation.source.videoId
    ) throw new Error('The connected video does not match this clip.');
    const token = getPlayerActionToken('video', videoDraftState.playerIdentity);
    await runSelectedPlayerAction(token, 'play', annotation.startMs / 1_000);
  }, [getPlayerActionToken, runSelectedPlayerAction, sourceState, videoDraftState.playerIdentity]);

  const playConnectedAudioClip = useCallback(async (
    annotation: Extract<PublicAnnotation, { kind: 'audio' | 'spotify' }>,
  ) => {
    const audioIdentity = sourceState.status === 'connected'
      ? connectedAudioSource(sourceState.source)
      : null;
    const spotifyIdentity = sourceState.status === 'connected'
      ? connectedSpotifySource(sourceState.source)
      : null;
    if (annotation.kind === 'spotify') {
      if (
        sourceState.status !== 'connected' ||
        !spotifyIdentity ||
        spotifyIdentity.episodeId !== annotation.source.episodeId
      ) throw new Error('The connected Spotify episode does not match this clip.');
    } else if (
      sourceState.status !== 'connected' ||
      !audioIdentity ||
      audioIdentity.normalizedUrl !== annotation.source.normalizedUrl
    ) throw new Error('The connected audio source does not match this clip.');
    const token = getPlayerActionToken('audio', audioDraftState.playerIdentity);
    await runSelectedPlayerAction(token, 'play', annotation.startMs / 1_000);
  }, [audioDraftState.playerIdentity, getPlayerActionToken, runSelectedPlayerAction, sourceState]);

  const previewYoutubeDraft = useCallback(async () => {
    if (
      videoDraftState.startMs === null || videoDraftState.endMs === null || sourceState.status !== 'connected'
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    let token: PlayerActionToken;
    try { token = getPlayerActionToken('video', videoDraftState.playerIdentity); } catch { return; }
    dispatchCreateDraft({ type: 'set-player-read-state', mode: 'video', state: 'reading' });
    try {
      await applyCreateClipRangeMark({
        source: sourceState.source,
        connection: { tabId: context.tabId, tabUrl: sourceState.source.url },
        startMs: videoDraftState.startMs,
        endMs: videoDraftState.endMs,
        mode: 'video',
      });
      await runSelectedPlayerAction(
        token,
        'preview',
        videoDraftState.startMs / 1_000,
        videoDraftState.endMs / 1_000,
      );
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'video', state: 'idle' });
      }
    } catch {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'video', state: 'error' });
      }
    }
  }, [getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState, videoDraftState.endMs, videoDraftState.playerIdentity, videoDraftState.startMs]);

  const previewAudioDraft = useCallback(async () => {
    if (
      audioDraftState.startMs === null || audioDraftState.endMs === null || sourceState.status !== 'connected' ||
      (!connectedAudioSource(sourceState.source) && !connectedSpotifySource(sourceState.source))
    ) return;
    const context = connectedContextRef.current;
    if (!context) return;
    let token: PlayerActionToken;
    try { token = getPlayerActionToken('audio', audioDraftState.playerIdentity); } catch { return; }
    dispatchCreateDraft({ type: 'set-player-read-state', mode: 'audio', state: 'reading' });
    try {
      await applyCreateClipRangeMark({
        source: sourceState.source,
        connection: { tabId: context.tabId, tabUrl: sourceState.source.url },
        startMs: audioDraftState.startMs,
        endMs: audioDraftState.endMs,
        mode: 'audio',
      });
      await runSelectedPlayerAction(
        token,
        'preview',
        audioDraftState.startMs / 1_000,
        audioDraftState.endMs / 1_000,
      );
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'audio', state: 'idle' });
        if (connectedSpotifySource(sourceState.source)) {
          setAudioPublishState({ status: 'idle' });
        }
      }
    } catch (error) {
      if (playerTokenIsCurrent(token)) {
        dispatchCreateDraft({ type: 'set-player-read-state', mode: 'audio', state: 'error' });
        if (connectedSpotifySource(sourceState.source)) {
          setAudioPublishState({
            status: 'error',
            message: error instanceof Error ? error.message : 'The Spotify player could not seek to the clip start.',
          });
        }
      }
    }
  }, [audioDraftState.endMs, audioDraftState.playerIdentity, audioDraftState.startMs, getPlayerActionToken, playerTokenIsCurrent, runSelectedPlayerAction, sourceState]);

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
              ...state.source,
              audioDetectionResolved: true,
              audioAvailable: true,
              audioIdentity: detection.source,
              exclusivePodcast: detection.exclusivePodcast,
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
    const spotifyIdentity = sourceState.status === 'connected'
      ? connectedSpotifySource(sourceState.source)
      : null;
    if (
      draftRestorationStatus !== 'ready' || sourceState.status !== 'connected' ||
      !spotifyIdentity
    ) return;
    const draft = spotifyDraftRef.current;
    if (draft && spotifyClipDraftBelongsToSource(draft, spotifyIdentity.url)) {
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'audio',
        sourceKey: draft.source.episodeId,
        startMs: draft.startMs,
        endMs: draft.endMs,
        commentary: draft.commentary,
        title: draft.title,
      });
    }
  }, [draftRestorationStatus, sourceState]);

  useEffect(() => {
    const audioIdentity = sourceState.status === 'connected'
      ? persistableAudioIdentity(sourceState.source)
      : null;
    if (
      draftRestorationStatus !== 'ready' || sourceState.status !== 'connected' ||
      !audioIdentity || connectedSpotifySource(sourceState.source)
    ) return;
    const draft = audioDraftRef.current;
    if (
      draft && audioClipDraftBelongsToSource(
        draft,
        audioIdentity.url,
        audioIdentity.canonicalUrl,
      )
    ) {
      dispatchCreateDraft({
        type: 'restore-media',
        mode: 'audio',
        sourceKey: draft.source.normalizedUrl,
        startMs: draft.startMs,
        endMs: draft.endMs,
        commentary: draft.commentary,
        title: draft.title,
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
    if (
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'TikTok' ||
      sourceState.source.metadataResolved
    ) return;
    const context = connectedContextRef.current;
    const videoId = sourceState.source.videoId;
    if (!context) return;
    let current = true;
    void chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      func: extractTikTokPageMetadata,
    }).then((execution) => {
      const metadata = validateTikTokPageMetadata(sourceState.source.url, execution[0]?.result);
      if (!current) return;
      setSourceState((state) => {
        if (
          state.status !== 'connected' || state.source.classification !== 'TikTok' ||
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
      setSourceState((state) => state.status === 'connected' && state.source.classification === 'TikTok' && state.source.videoId === videoId
        ? { status: 'connected', source: { ...state.source, metadataResolved: true } }
        : state);
    });
    return () => { current = false; };
  }, [sourceState]);

  useEffect(() => {
    if (
      sourceState.status !== 'connected' ||
      sourceState.source.classification !== 'Spotify' ||
      sourceState.source.metadataResolved
    ) return;
    const context = connectedContextRef.current;
    const episodeId = sourceState.source.episodeId;
    if (!context) return;
    let current = true;
    void chrome.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [0] },
      func: extractSpotifyPageMetadata,
    }).then((execution) => {
      const metadata = validateSpotifyPageMetadata(sourceState.source.url, execution[0]?.result);
      if (!current) return;
      setSourceState((state) => {
        if (
          state.status !== 'connected' || state.source.classification !== 'Spotify' ||
          state.source.episodeId !== episodeId
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
      setSourceState((state) => state.status === 'connected' && state.source.classification === 'Spotify' && state.source.episodeId === episodeId
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
        TIKTOK_CLIP_DRAFT_STORAGE_KEY,
        WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY,
        AUDIO_CLIP_DRAFT_STORAGE_KEY,
        SPOTIFY_CLIP_DRAFT_STORAGE_KEY,
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
          dispatchCreateDraft({ type: 'set-text-title', title: draft.title });
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
            title: youtubeDraft.title,
          });
        } else if (
          restorationRevision === draftRevisionRef.current &&
          storedYoutubeDraftValue !== undefined && youtubeDraft === null
        ) {
          void chrome.storage.session.remove(YOUTUBE_CLIP_DRAFT_STORAGE_KEY);
        }
        const storedTikTokDraftValue = stored[TIKTOK_CLIP_DRAFT_STORAGE_KEY];
        const tiktokDraft = deserializeTikTokClipDraft(storedTikTokDraftValue);
        tiktokDraftRef.current = tiktokDraft;
        if (
          restorationRevision === draftRevisionRef.current && tiktokDraft && context &&
          tiktokClipDraftBelongsToSource(tiktokDraft, context.url)
        ) {
          tiktokDraftRef.current = tiktokDraft;
          dispatchCreateDraft({
            type: 'restore-media',
            mode: 'video',
            sourceKey: tiktokDraft.source.videoId,
            startMs: tiktokDraft.startMs,
            endMs: tiktokDraft.endMs,
            commentary: tiktokDraft.commentary,
            title: tiktokDraft.title,
          });
        } else if (
          restorationRevision === draftRevisionRef.current &&
          storedTikTokDraftValue !== undefined && tiktokDraft === null
        ) {
          void chrome.storage.session.remove(TIKTOK_CLIP_DRAFT_STORAGE_KEY);
        }
        const storedWebVideoDraftValue = stored[WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY];
        let webVideoDraft = deserializeWebVideoClipDraft(storedWebVideoDraftValue);
        const newerHostedDraft = [youtubeDraft, tiktokDraft]
          .filter((draft): draft is NonNullable<typeof draft> => Boolean(draft))
          .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
        if (newerHostedDraft && webVideoDraft) {
          if (newerHostedDraft.updatedAt >= webVideoDraft.updatedAt) {
            webVideoDraft = null;
            void chrome.storage.session.remove(WEB_VIDEO_CLIP_DRAFT_STORAGE_KEY);
          } else {
            youtubeDraftRef.current = null;
            tiktokDraftRef.current = null;
            void chrome.storage.session.remove([
              YOUTUBE_CLIP_DRAFT_STORAGE_KEY,
              TIKTOK_CLIP_DRAFT_STORAGE_KEY,
            ]);
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
            title: webVideoDraft.title,
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
        const storedSpotifyDraftValue = stored[SPOTIFY_CLIP_DRAFT_STORAGE_KEY];
        const spotifyDraft = deserializeSpotifyClipDraft(storedSpotifyDraftValue);
        spotifyDraftRef.current = spotifyDraft;
        if (
          restorationRevision === draftRevisionRef.current && spotifyDraft && context &&
          spotifyClipDraftBelongsToSource(spotifyDraft, context.url)
        ) {
          spotifyDraftRef.current = spotifyDraft;
          audioDraftRef.current = null;
          dispatchCreateDraft({
            type: 'restore-media',
            mode: 'audio',
            sourceKey: spotifyDraft.source.episodeId,
            startMs: spotifyDraft.startMs,
            endMs: spotifyDraft.endMs,
            commentary: spotifyDraft.commentary,
            title: spotifyDraft.title,
          });
        } else if (
          restorationRevision === draftRevisionRef.current &&
          storedSpotifyDraftValue !== undefined && spotifyDraft === null
        ) {
          void chrome.storage.session.remove(SPOTIFY_CLIP_DRAFT_STORAGE_KEY);
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
    const preferText = sourceState.source.classification === 'Web page' &&
      !sourceState.source.exclusivePodcast;
    setModeSelection((current) => {
      let next = current
        ? moveSelectionToPage(current, page, modeCapabilities, preferText)
        : createModeSelectionState(page, modeCapabilities, preferText);
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
    const spotifyIdentity = connectedSpotifySource(sourceState.source);
    const genericVideo = isWebpageVideoCapableSource(sourceState.source);
    const videoSourceKey = videoPlayerSourceKey(sourceState.source);
    const probes: Array<{
      mode: PlayerMode;
      genericVideo: boolean;
      sourceKey: string;
      reader: 'top' | 'spotify';
    }> = [];
    if (!spotifyIdentity) {
      probes.push({ mode: 'video', genericVideo, sourceKey: videoSourceKey, reader: 'top' });
    } else {
      setVideoPlayers(EMPTY_PLAYER_DISCOVERY);
    }
    const audioIdentity = connectedAudioSource(sourceState.source);
    if (spotifyIdentity) {
      probes.push({ mode: 'audio', genericVideo: false, sourceKey: spotifyIdentity.episodeId, reader: 'spotify' });
    } else if (audioIdentity) {
      probes.push({ mode: 'audio', genericVideo: false, sourceKey: audioIdentity.normalizedUrl, reader: 'top' });
    } else {
      setAudioPlayers(EMPTY_PLAYER_DISCOVERY);
    }
    let current = true;
    for (const probe of probes) {
      const execution = probe.reader === 'spotify'
        ? chrome.scripting.executeScript({
          target: { tabId: context.tabId, frameIds: [0] },
          func: readSpotifyPlayerDiscovery,
        })
        : chrome.scripting.executeScript({
          target: { tabId: context.tabId, frameIds: [0] },
          // Generic video needs the page origin to traverse readable same-origin frames.
          world: probe.genericVideo ? 'MAIN' : 'ISOLATED',
          func: readTopFramePlayerDiscovery,
          args: [probe.mode, probe.genericVideo],
        });
      void execution.then((execution) => {
        if (!current || createPageRef.current?.generation !== pageGeneration) return;
        const discovery = probe.reader === 'spotify'
          ? validateSpotifyPlayerDiscovery(pageUrl, execution[0]?.result)
          : validatePlayerDiscovery(pageUrl, probe.mode, execution[0]?.result, probe.genericVideo);
        const state: PlayerDiscoveryState = { ...discovery, pageGeneration };
        if (probe.mode === 'video') {
          setVideoPlayers(state);
          if (probe.genericVideo) setSourceState((currentState) =>
            currentState.status === 'connected' && isWebpageVideoCapableSource(currentState.source) &&
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
            currentState.status === 'connected' && isWebpageVideoCapableSource(currentState.source) && currentState.source.url === pageUrl
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
    const context = connectedContextRef.current;
    const next = sourceState.status === 'connected'
      ? articleHoverConnectionForTab(
        sourceState.source.classification,
        context?.tabId,
        sourceState.source.url,
      )
      : null;
    const previous = articleHoverRef.current;
    articleHoverRef.current = next;
    if (previous && (!next || previous.tabId !== next.tabId || previous.tabUrl !== next.tabUrl)) {
      void clearArticleHoverOnConnectedTab(previous);
    }
    if (next) {
      void applyPendingArticleHoverOnConnection(next);
    }
  }, [sourceState]);

  useEffect(() => {
    const context = connectedContextRef.current;
    const next = sourceState.status === 'connected'
      ? audioHoverConnectionForTab(
        sourceState.source.classification,
        context?.tabId,
        sourceState.source.url,
      )
      : null;
    const previous = audioHoverRef.current;
    audioHoverRef.current = next;
    if (previous && (!next || previous.tabId !== next.tabId || previous.tabUrl !== next.tabUrl)) {
      void clearAudioHoverOnConnectedTab(previous);
    }
    if (next) {
      void applyPendingAudioHoverOnConnection(next);
    }
  }, [sourceState]);

  useEffect(() => {
    const context = connectedContextRef.current;
    const next = sourceState.status === 'connected'
      ? pageVideoHoverConnectionForTab(
        sourceState.source.classification,
        context?.tabId,
        sourceState.source.url,
      )
      : null;
    const previous = pageVideoHoverRef.current;
    pageVideoHoverRef.current = next;
    if (previous && (!next || previous.tabId !== next.tabId || previous.tabUrl !== next.tabUrl)) {
      void clearPageVideoHoverOnConnectedTab(previous);
    }
    if (next) {
      void applyPendingPageVideoHoverOnConnection(next);
    }
  }, [sourceState]);

  useEffect(() => {
    const context = connectedContextRef.current;
    const next = sourceState.status === 'connected'
      ? tiktokHoverConnectionForTab(
        sourceState.source.classification,
        context?.tabId,
        sourceState.source.url,
      )
      : null;
    const previous = tiktokHoverRef.current;
    tiktokHoverRef.current = next;
    if (previous && (!next || previous.tabId !== next.tabId || previous.tabUrl !== next.tabUrl)) {
      void clearTikTokHoverOnConnectedTab(previous);
    }
    if (next) {
      void applyPendingTikTokHoverOnConnection(next);
    }
  }, [sourceState]);

  useEffect(() => {
    const context = connectedContextRef.current;
    const next = sourceState.status === 'connected'
      ? spotifyHoverConnectionForTab(
        sourceState.source.classification,
        context?.tabId,
        sourceState.source.url,
      )
      : null;
    const previous = spotifyHoverRef.current;
    spotifyHoverRef.current = next;
    if (previous && (!next || previous.tabId !== next.tabId || previous.tabUrl !== next.tabUrl)) {
      void clearSpotifyHoverOnConnectedTab(previous);
    }
    if (next) {
      void applyPendingSpotifyHoverOnConnection(next);
    }
  }, [sourceState]);

  useEffect(() => {
    const onBlur = () => {
      const articleConnection = articleHoverRef.current;
      if (articleConnection) leaveArticleHoverLink(articleConnection);
      const audioConnection = audioHoverRef.current;
      if (audioConnection) leaveAudioHoverLink(audioConnection);
      const pageVideoConnection = pageVideoHoverRef.current;
      if (pageVideoConnection) leavePageVideoHoverLink(pageVideoConnection);
      const tiktokConnection = tiktokHoverRef.current;
      if (tiktokConnection) leaveTikTokHoverLink(tiktokConnection);
      const spotifyConnection = spotifyHoverRef.current;
      if (spotifyConnection) leaveSpotifyHoverLink(spotifyConnection);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  useEffect(() => {
    if (!refreshSuccess) return;
    const timer = window.setTimeout(() => setRefreshSuccess(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [refreshSuccess]);

  useEffect(() => {
    const dialog = modeSwitchDialogRef.current;
    if (pendingModeSwitch && dialog && !dialog.open) dialog.showModal();
  }, [pendingModeSwitch]);

  const commitVideoRange = (startMs: number | null, endMs: number | null) => {
    const sourceKey = sourceState.status === 'connected'
      ? videoPlayerSourceKey(sourceState.source)
      : videoDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'video', patch: { startMs, endMs, sourceKey } });
    if (sourceState.status === 'connected' && sourceState.source.classification === 'YouTube') {
      persistYoutubeDraft(sourceState.source.url, startMs, endMs, videoDraftState.commentary);
    } else if (sourceState.status === 'connected' && sourceState.source.classification === 'TikTok') {
      persistTikTokDraft(sourceState.source.url, startMs, endMs, videoDraftState.commentary);
    } else if (sourceState.status === 'connected') {
      persistWebVideoDraft(sourceState.source.url, startMs, endMs, videoDraftState.commentary);
    }
    const context = connectedContextRef.current;
    if (sourceState.status === 'connected' && context && startMs !== null && endMs !== null && endMs > startMs) {
      void applyCreateClipRangeMark({
        source: sourceState.source,
        connection: { tabId: context.tabId, tabUrl: sourceState.source.url },
        startMs,
        endMs,
        mode: 'video',
      });
    }
  };

  const commitAudioRange = (startMs: number | null, endMs: number | null) => {
    const persistable = sourceState.status === 'connected'
      ? persistableAudioIdentity(sourceState.source)
      : null;
    const spotifyIdentity = sourceState.status === 'connected'
      ? connectedSpotifySource(sourceState.source)
      : null;
    const sourceKey = spotifyIdentity?.normalizedUrl
      ?? (sourceState.status === 'connected' ? createAudioIdentity(sourceState.source)?.normalizedUrl : null)
      ?? audioDraftState.sourceKey;
    dispatchCreateDraft({ type: 'patch-media', mode: 'audio', patch: { startMs, endMs, sourceKey } });
    if (spotifyIdentity) persistSpotifyDraft(spotifyIdentity.url, startMs, endMs, audioDraftState.commentary);
    else if (persistable) persistAudioDraft(persistable, startMs, endMs, audioDraftState.commentary);
    const context = connectedContextRef.current;
    if (sourceState.status === 'connected' && context && startMs !== null && endMs !== null && endMs > startMs) {
      void applyCreateClipRangeMark({
        source: sourceState.source,
        connection: { tabId: context.tabId, tabUrl: sourceState.source.url },
        startMs,
        endMs,
        mode: 'audio',
      });
    }
  };

  const videoRangeEntry = useTypedClipRange(
    videoDraftState.startMs,
    videoDraftState.endMs,
    commitVideoRange,
  );
  const audioRangeEntry = useTypedClipRange(
    audioDraftState.startMs,
    audioDraftState.endMs,
    commitAudioRange,
  );

  const changeTitle = (value: string) => {
    draftRevisionRef.current += 1;
    dispatchCreateDraft({ type: 'set-text-title', title: value });
    const draft = draftRef.current;
    if (!draft) return;
    const updatedDraft = updateAnnotationDraftTitle(draft, value);
    if (updatedDraft) persistDraft(updatedDraft);
  };

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
  const textCommentaryBusy = isCommentaryRecordingBusy(textCommentaryRecorder.state.status);
  const videoCommentaryBusy = isCommentaryRecordingBusy(videoCommentaryRecorder.state.status);
  const audioCommentaryBusy = isCommentaryRecordingBusy(audioCommentaryRecorder.state.status);
  const hasTextCommentary = hasPublishableCommentary(
    commentary,
    textCommentaryRecorder.state.status === 'recorded',
  );
  const hasVideoCommentary = hasPublishableCommentary(
    videoDraftState.commentary,
    videoCommentaryRecorder.state.status === 'recorded',
  );
  const hasAudioCommentary = hasPublishableCommentary(
    audioDraftState.commentary,
    audioCommentaryRecorder.state.status === 'recorded',
  );
  const canPublish = authState.status === 'signed-in' && captured && hasTextCommentary &&
    publishState.status !== 'publishing' && !textCommentaryBusy;
  const contextUrl = sourceState.status === 'connected' ? sourceState.source.url : null;
  const youtubeSource = sourceState.status === 'connected' && sourceState.source.classification === 'YouTube'
    ? sourceState.source
    : null;
  const tiktokSource = sourceState.status === 'connected' && sourceState.source.classification === 'TikTok'
    ? sourceState.source
    : null;
  const spotifySource = sourceState.status === 'connected' && sourceState.source.classification === 'Spotify'
    ? sourceState.source
    : null;
  const webVideoSource = sourceState.status === 'connected' && isWebpageVideoCapableSource(sourceState.source) &&
    sourceState.source.videoDetectionResolved && sourceState.source.videoAvailable
    ? sourceState.source
    : null;
  const videoSource = youtubeSource ?? tiktokSource ?? webVideoSource;
  const audioSource = sourceState.status === 'connected'
    ? createAudioIdentity(sourceState.source)
    : null;
  const audioPlayerDiscovery = audioPlayers;
  const exclusivePodcast = sourceState.status === 'connected' && (
    sourceState.source.classification === 'Podcast / web audio' ||
    (sourceState.source.classification === 'Web page' && sourceState.source.exclusivePodcast)
  );
  const connectedContext = sourceState.status === 'connected' ? connectedContextRef.current : null;
  const youtubeHover = youtubeSource && connectedContext
    ? { tabId: connectedContext.tabId, tabUrl: youtubeSource.url }
    : null;
  const tiktokHover = sourceState.status === 'connected' && connectedContext
    ? tiktokHoverConnectionForTab(
      sourceState.source.classification,
      connectedContext.tabId,
      sourceState.source.url,
    )
    : null;
  const spotifyHover = sourceState.status === 'connected' && connectedContext
    ? spotifyHoverConnectionForTab(
      sourceState.source.classification,
      connectedContext.tabId,
      sourceState.source.url,
    )
    : null;
  const articleHover = sourceState.status === 'connected' && connectedContext
    ? articleHoverConnectionForTab(
      sourceState.source.classification,
      connectedContext.tabId,
      sourceState.source.url,
    )
    : null;
  const audioHover = sourceState.status === 'connected' && connectedContext
    ? audioHoverConnectionForTab(
      sourceState.source.classification,
      connectedContext.tabId,
      sourceState.source.url,
    )
    : null;
  const pageVideoHover = sourceState.status === 'connected' && connectedContext
    ? pageVideoHoverConnectionForTab(
      sourceState.source.classification,
      connectedContext.tabId,
      sourceState.source.url,
    )
    : null;
  const selectedCreateMode = modeSelection?.selectedMode ?? null;
  const textDraftAttached = Boolean(
    draftRef.current && connectedContext && annotationDraftBelongsToContext(draftRef.current, connectedContext),
  );
  const videoDraftAttached = Boolean(
    youtubeSource
      ? youtubeDraftRef.current && youtubeClipDraftBelongsToSource(youtubeDraftRef.current, youtubeSource.url)
      : tiktokSource
        ? tiktokDraftRef.current && tiktokClipDraftBelongsToSource(tiktokDraftRef.current, tiktokSource.url)
        : webVideoSource && webVideoDraftRef.current && webVideoClipDraftBelongsToSource(webVideoDraftRef.current, webVideoSource.url),
  );
  const audioDraftAttached = Boolean(
    spotifySource
      ? spotifyDraftRef.current && spotifyClipDraftBelongsToSource(spotifyDraftRef.current, spotifySource.url)
      : audioDraftRef.current && audioSource &&
        'canonicalUrl' in audioSource &&
        audioClipDraftBelongsToSource(audioDraftRef.current, audioSource.url, audioSource.canonicalUrl),
  );
  const detachedDraftModes: Record<CreateMode, boolean> = {
    text: draftRef.current !== null && !textDraftAttached,
    video: (youtubeDraftRef.current !== null || tiktokDraftRef.current !== null || webVideoDraftRef.current !== null) && !videoDraftAttached,
    audio: (audioDraftRef.current !== null || spotifyDraftRef.current !== null) && !audioDraftAttached,
  };
  const savedDraftModes: Record<CreateMode, boolean> = {
    text: draftRef.current !== null || hasCreateModeDraft(createDraftState, 'text') ||
      textCommentaryRecorder.state.status === 'recorded',
    video: youtubeDraftRef.current !== null || tiktokDraftRef.current !== null || webVideoDraftRef.current !== null || hasCreateModeDraft(createDraftState, 'video') ||
      videoCommentaryRecorder.state.status === 'recorded',
    audio: audioDraftRef.current !== null || spotifyDraftRef.current !== null || hasCreateModeDraft(createDraftState, 'audio') ||
      audioCommentaryRecorder.state.status === 'recorded',
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
  const videoStartError = getTypedClipFieldError(
    videoRangeEntry.startField,
    videoDraftState.startMs,
    videoDraftState.durationMs,
    'start',
  );
  const videoEndError = getTypedClipFieldError(
    videoRangeEntry.endField,
    videoDraftState.endMs,
    videoDraftState.durationMs,
    'end',
  );
  const audioStartError = getTypedClipFieldError(
    audioRangeEntry.startField,
    audioDraftState.startMs,
    audioDraftState.durationMs,
    'start',
  );
  const audioEndError = getTypedClipFieldError(
    audioRangeEntry.endField,
    audioDraftState.endMs,
    audioDraftState.durationMs,
    'end',
  );
  const showVideoRangeError = videoRangeEntry.allowsPublish
    && videoDraftState.startMs !== null
    && videoDraftState.endMs !== null
    && videoClipRangeError !== null
    && videoClipRangeError !== videoStartError
    && videoClipRangeError !== videoEndError;
  const showAudioRangeError = audioRangeEntry.allowsPublish
    && audioDraftState.startMs !== null
    && audioDraftState.endMs !== null
    && audioClipRangeError !== null
    && audioClipRangeError !== audioStartError
    && audioClipRangeError !== audioEndError;
  const videoPlayerSelected = videoPlayers.status === 'ready' &&
    videoPlayers.pageGeneration === modeSelection?.page.generation &&
    videoPlayers.candidates.some((candidate) => candidate.identity === videoDraftState.playerIdentity);
  const audioPlayerSelected = audioPlayerDiscovery.status === 'ready' &&
    audioPlayerDiscovery.pageGeneration === modeSelection?.page.generation &&
    audioPlayerDiscovery.candidates.some((candidate) => candidate.identity === audioDraftState.playerIdentity);
  const canPublishYoutube = authState.status === 'signed-in' && youtubeSource !== null &&
    videoPlayerSelected && videoRangeEntry.allowsPublish &&
    videoClipRangeError === null && hasVideoCommentary && !videoCommentaryBusy &&
    youtubePublishState.status !== 'publishing' &&
    hostedMediaSession === null;
  const canPublishTikTok = authState.status === 'signed-in' && tiktokSource !== null &&
    videoPlayerSelected && videoRangeEntry.allowsPublish &&
    videoClipRangeError === null && hasVideoCommentary && !videoCommentaryBusy &&
    youtubePublishState.status !== 'publishing' &&
    hostedMediaSession === null;
  const canPublishWebpageVideo = authState.status === 'signed-in' && webVideoSource !== null &&
    videoPlayerSelected && videoRangeEntry.allowsPublish &&
    videoClipRangeError === null && hasVideoCommentary && !videoCommentaryBusy &&
    youtubePublishState.status !== 'publishing' &&
    hostedMediaSession === null;
  const canPublishAudio = authState.status === 'signed-in' && audioSource !== null &&
    audioPlayerSelected && audioRangeEntry.allowsPublish &&
    (spotifySource !== null || audioDraftState.durationMs !== null) && audioClipRangeError === null &&
    hasAudioCommentary && !audioCommentaryBusy &&
    audioPublishState.status !== 'publishing' &&
    hostedMediaSession === null &&
    !(spotifySource && spotifySource.pageBlock === 'login');
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
      contextCacheKey = `context:${youtubeSource?.normalizedUrl ?? tiktokSource?.normalizedUrl ?? spotifySource?.normalizedUrl ?? normalizeArticleUrl(contextUrl)}`;
    } catch { contextCacheKey = null; }
  }

  return (
    <main className="panel">
      <header className="app-header">
        {currentScreen.kind !== 'root' && (
          <div className="app-bar">
            <button className="back-button" type="button" onClick={() => dispatchNavigation({ type: 'back' })} aria-label="Go back">←</button>
            <span className="view-title">{currentScreen.kind === 'profile' ? 'Creator' : 'Annotation'}</span>
          </div>
        )}
        <nav className="top-tabs" aria-label="Primary">
          {(['context', 'feed', 'account'] as const).map((view) => <button key={view} type="button" className={currentScreen.kind === 'root' && currentScreen.view === view ? 'active' : ''} aria-current={currentScreen.kind === 'root' && currentScreen.view === view ? 'page' : undefined} onClick={() => selectRoot(view)}>{view === 'context' ? 'Create' : view === 'account' ? 'Me' : 'Feed'}</button>)}
        </nav>
      </header>

      {!supabase && currentScreen.kind !== 'root' && <div className="compact-state compact-state-error view-state" role="alert"><strong>Annotated is unavailable</strong><span>Check the extension configuration and try again.</span></div>}

      {supabase && currentScreen.kind === 'annotation' && <AnnotationDetailView key={`annotation:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={(provider) => void beginSignIn(provider)} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} connectedVideoId={youtubeSource?.videoId ?? tiktokSource?.videoId ?? null} onPlayConnectedClip={playConnectedClip} connectedAudioNormalizedUrl={audioSource?.normalizedUrl ?? null} onPlayConnectedAudioClip={playConnectedAudioClip} youtubeHover={youtubeHover} articleHover={articleHover} audioHover={audioHover} pageVideoHover={pageVideoHover} tiktokHover={tiktokHover} spotifyHover={spotifyHover} onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'comments' && <AnnotationDetailView key={`comments:${currentScreen.annotationId}`} supabase={supabase} annotationId={currentScreen.annotationId} currentUserId={currentUserId} onSignIn={(provider) => void beginSignIn(provider)} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} connectedVideoId={youtubeSource?.videoId ?? tiktokSource?.videoId ?? null} onPlayConnectedClip={playConnectedClip} connectedAudioNormalizedUrl={audioSource?.normalizedUrl ?? null} onPlayConnectedAudioClip={playConnectedAudioClip} youtubeHover={youtubeHover} articleHover={articleHover} audioHover={audioHover} pageVideoHover={pageVideoHover} tiktokHover={tiktokHover} spotifyHover={spotifyHover} focusComments onSocialMutation={() => socialCacheRef.current.clear()} />}
      {supabase && currentScreen.kind === 'profile' && <ProfileView key={`profile:${currentScreen.profileId}`} supabase={supabase} profileId={currentScreen.profileId} currentUserId={currentUserId} onSignIn={(provider) => void beginSignIn(provider)} navigation={navigationCallbacks} cache={socialCacheRef.current} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} articleHover={articleHover} audioHover={audioHover} pageVideoHover={pageVideoHover} tiktokHover={tiktokHover} spotifyHover={spotifyHover} />}

      {currentScreen.kind === 'root' && currentScreen.view === 'feed' && (
        <div className="root-view"><h1 className="visually-hidden">Feed</h1>{supabase ? <AnnotationCollection supabase={supabase} cache={socialCacheRef.current} cacheKey="feed" navigation={navigationCallbacks} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} articleHover={articleHover} audioHover={audioHover} pageVideoHover={pageVideoHover} tiktokHover={tiktokHover} spotifyHover={spotifyHover} emptyTitle="No published annotations" emptyMessage="The public feed is quiet for now." /> : <div className="compact-state compact-state-error">Feed unavailable</div>}</div>
      )}

      {currentScreen.kind === 'root' && currentScreen.view === 'account' && (
        <div className="root-view"><h1 className="visually-hidden">Me</h1><section className="account-view">
          {authState.status === 'loading' && <div className="compact-state compact-state-quiet" role="status">Restoring session…</div>}
          {authState.status === 'signed-out' && <div className="signed-out-account"><p>Sign in to publish, comment, and follow.</p><SignInActions onSignIn={beginSignIn} /></div>}
          {authState.status === 'signing-in' && <button className="button button-primary" type="button" disabled>Signing in…</button>}
          {authState.status === 'error' && <div className="compact-state compact-state-error" role="alert"><strong>Account unavailable</strong><span>{authState.message}</span><button className="button button-secondary" type="button" onClick={() => void retryAuthentication()}>Try again</button></div>}
          {authState.status === 'signed-in' && <><div className="account-identity">{authState.account.avatarUrl ? <img className="account-avatar" src={authState.account.avatarUrl} alt="" width="44" height="44" referrerPolicy="no-referrer" /> : <span className="account-avatar" aria-hidden="true">{getInitial(authState.account.name)}</span>}<div><strong>{authState.account.name}</strong><span>{authState.account.email}</span></div></div>{authState.profileError && <p className="inline-error" role="alert">{authState.profileError}</p>}<button className="button button-secondary" type="button" onClick={() => navigationCallbacks.openProfile(authState.account.id)}>View my profile</button><button className="text-button danger-text" type="button" onClick={() => void signOut()} disabled={isSigningOut}>{isSigningOut ? 'Signing out…' : 'Sign out'}</button></>}
          <AppearanceControl />
          <BrandLockup />
        </section></div>
      )}

      {currentScreen.kind === 'root' && currentScreen.view === 'context' && (
        <div className="root-view context-view">
          <h1 className="visually-hidden">Create</h1>
          <fieldset className="create-mode-switcher">
            <legend className="visually-hidden">Create mode</legend>
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
              <h2 id="create-heading" className="visually-hidden">Create clip</h2>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this video for unpublished work…</span></div> : <>
                <p className="create-help">Drag the clip range, or set 30s / 60s from the current playhead. Type times if you prefer. Clips can be at most 90 seconds.</p>
                <PlayerSelector mode="video" discovery={videoPlayers} selectedIdentity={videoDraftState.playerIdentity} disabled={mediaEditorLocked} onSelect={(identity) => choosePlayer('video', identity)} />
                {videoDraftState.playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTimeTenths(videoDraftState.playerTimeMs)}</strong>{videoDraftState.durationMs !== null && <> / {formatMediaTimeTenths(videoDraftState.durationMs)}</>}</p>}
                <ClipRangeEditor
                  idPrefix="video"
                  startMs={videoDraftState.startMs}
                  endMs={videoDraftState.endMs}
                  durationMs={videoDraftState.durationMs}
                  playheadMs={videoDraftState.playerTimeMs}
                  startField={videoRangeEntry.startField}
                  endField={videoRangeEntry.endField}
                  lengthDisplay={videoRangeDisplay.length}
                  startError={videoStartError}
                  endError={videoEndError}
                  rangeError={showVideoRangeError ? videoClipRangeError : null}
                  disabled={mediaEditorLocked}
                  playerSelected={videoPlayerSelected}
                  playerReading={videoDraftState.playerReadState === 'reading'}
                  previewEnabled={
                    videoDraftState.startMs !== null
                    && videoDraftState.endMs !== null
                    && videoDraftState.endMs > videoDraftState.startMs
                  }
                  previewLabel="Preview range"
                  onCommitRange={(startMs, endMs) => commitVideoRange(startMs, endMs)}
                  onStartChange={videoRangeEntry.changeStart}
                  onEndChange={videoRangeEntry.changeEnd}
                  onStartBlur={videoRangeEntry.commitStart}
                  onEndBlur={videoRangeEntry.commitEnd}
                  onPreset={(presetMs) => void applyMediaClipPreset(presetMs)}
                  onPreview={() => void previewYoutubeDraft()}
                  onRefresh={() => { void readConnectedPlayer(); }}
                />
                {videoDraftState.playerReadState === 'error' && <p className="inline-error" role="alert">The current video player changed or could not be read. Reselect it and try again.</p>}
                <TitleField id="youtube-title" value={videoDraftState.title} disabled={mediaEditorLocked} onChange={changeYoutubeTitle} />
                <CommentaryField id="youtube-commentary" value={videoDraftState.commentary} disabled={mediaEditorLocked} onChange={changeYoutubeCommentary} />
                <AudioRecorder controller={videoCommentaryRecorder} disabled={mediaEditorLocked} />
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearVideoDraft()} disabled={youtubePublishState.status === 'publishing' || mediaEditorLocked}>Clear clip</button>{authState.status !== 'signed-in' ? <SignInActions onSignIn={beginSignIn} /> : youtubeSource ? <button className="button button-primary" type="button" onClick={() => void publishYoutubeClip()} disabled={!canPublishYoutube}>{youtubePublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button> : tiktokSource ? <button className="button button-primary" type="button" onClick={() => void publishTikTokClip()} disabled={!canPublishTikTok}>{youtubePublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button> : <button className="button button-primary" type="button" onClick={() => void publishWebpageVideoClip()} disabled={!canPublishWebpageVideo}>{youtubePublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button>}</div>
                {youtubePublishState.status === 'error' && <p className="inline-error" role="alert">{youtubePublishState.message}</p>}
              </>}
            </section>
          ) : selectedCreateMode === 'audio' && audioSource ? (
            <section className="create-panel audio-clip-panel" aria-labelledby="create-heading" key="create-audio">
              <h2 id="create-heading" className="visually-hidden">Create audio clip</h2>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this episode for unpublished work…</span></div> : <>
                <p className="create-help">{spotifySource ? 'Drag the clip range, or set 30s / 60s from the current playhead. Preview plays only that range on the now-playing bar and stops at the end. Type times if you prefer. Clips can be at most 90 seconds.' : 'Drag the clip range, or set 30s / 60s from the current playhead. Type times if you prefer. Clips can be at most 90 seconds.'}</p>
                <PlayerSelector mode="audio" discovery={audioPlayerDiscovery} selectedIdentity={audioDraftState.playerIdentity} disabled={mediaEditorLocked} onSelect={(identity) => choosePlayer('audio', identity)} />
                {audioDraftState.playerTimeMs !== null && <p className="player-readout">Player now: <strong>{formatMediaTimeTenths(audioDraftState.playerTimeMs)}</strong>{audioDraftState.durationMs !== null && <> / {formatMediaTimeTenths(audioDraftState.durationMs)}</>}</p>}
                <ClipRangeEditor
                  idPrefix="audio"
                  startMs={audioDraftState.startMs}
                  endMs={audioDraftState.endMs}
                  durationMs={audioDraftState.durationMs}
                  playheadMs={audioDraftState.playerTimeMs}
                  startField={audioRangeEntry.startField}
                  endField={audioRangeEntry.endField}
                  lengthDisplay={audioRangeDisplay.length}
                  startError={audioStartError}
                  endError={audioEndError}
                  rangeError={showAudioRangeError ? audioClipRangeError : null}
                  disabled={mediaEditorLocked}
                  playerSelected={audioPlayerSelected}
                  playerReading={audioDraftState.playerReadState === 'reading'}
                  previewEnabled={
                    audioDraftState.startMs !== null
                    && audioDraftState.endMs !== null
                    && audioDraftState.endMs > audioDraftState.startMs
                  }
                  previewLabel="Preview range"
                  onCommitRange={(startMs, endMs) => commitAudioRange(startMs, endMs)}
                  onStartChange={audioRangeEntry.changeStart}
                  onEndChange={audioRangeEntry.changeEnd}
                  onStartBlur={audioRangeEntry.commitStart}
                  onEndBlur={audioRangeEntry.commitEnd}
                  onPreset={(presetMs) => void applyMediaClipPreset(presetMs)}
                  onPreview={() => void previewAudioDraft()}
                  onRefresh={() => { void readConnectedPlayer(); }}
                />
                {audioDraftState.playerReadState === 'error' && <p className="inline-error" role="alert">{spotifySource ? 'The Spotify now-playing bar could not be read or could not seek. Reconnect the episode and try again.' : 'The page audio player disappeared or its current time could not be read. Reconnect the episode and try again.'}</p>}
                <TitleField id="audio-clip-title" value={audioDraftState.title} disabled={mediaEditorLocked} onChange={changeAudioTitle} />
                <CommentaryField id="audio-clip-commentary" value={audioDraftState.commentary} disabled={mediaEditorLocked} onChange={changeAudioCommentary} />
                <AudioRecorder controller={audioCommentaryRecorder} disabled={mediaEditorLocked} />
                <div className="create-actions"><button className="button button-secondary" type="button" onClick={() => void clearAudioDraft()} disabled={audioPublishState.status === 'publishing' || mediaEditorLocked}>Clear clip</button>{authState.status !== 'signed-in' ? <SignInActions onSignIn={beginSignIn} /> : <button className="button button-primary" type="button" onClick={() => void (spotifySource ? publishSpotifyClip() : publishAudioClip())} disabled={!canPublishAudio}>{audioPublishState.status === 'publishing' ? 'Creating draft…' : 'Publish clip'}</button>}</div>
                {audioPublishState.status === 'error' && <p className="inline-error" role="alert">{audioPublishState.message}</p>}
              </>}
            </section>
          ) : selectedCreateMode === 'text' ? (
            <section className="create-panel" aria-labelledby="create-heading" key="create-text"><h2 id="create-heading" className="visually-hidden">Create annotation</h2>
              {draftRestorationStatus === 'loading' ? <div className="compact-state" role="status"><strong>Restoring draft</strong><span>Checking this source for unpublished work…</span></div> : captured ? <><blockquote className="captured-passage">{captured.selectedText}</blockquote><dl className="capture-metadata">{captured.author && <div><dt>Author</dt><dd>{captured.author}</dd></div>}{captured.publisher && <div><dt>Publisher</dt><dd>{captured.publisher}</dd></div>}<div><dt>Source</dt><dd>{captured.hostname}</dd></div></dl><TitleField id="annotation-title" value={title} disabled={publishState.status === 'publishing'} onChange={changeTitle} /><CommentaryField id="annotation-commentary" value={commentary} disabled={publishState.status === 'publishing'} onChange={changeCommentary} /><AudioRecorder controller={textCommentaryRecorder} disabled={publishState.status === 'publishing'} /><div className="create-actions"><button className="button button-secondary" type="button" onClick={clearCapture} disabled={publishState.status === 'publishing'}>Clear capture</button>{authState.status !== 'signed-in' ? <SignInActions onSignIn={beginSignIn} /> : <button className="button button-primary" type="button" onClick={() => void publishAnnotation()} disabled={!canPublish}>{publishState.status === 'publishing' ? 'Publishing…' : 'Publish annotation'}</button>}</div>{publishState.status === 'error' && <p className="inline-error" role="alert">{publishState.message}</p>}</> : <><p className="create-help">Highlight article text in the connected page, then capture it here.</p><button className="button button-primary" type="button" onClick={() => void captureSelection()} disabled={sourceState.status !== 'connected' || isCapturing}>{isCapturing ? 'Capturing…' : 'Capture selected text'}</button>{(captureState.status === 'recoverable-error' || captureState.status === 'reconnect-required' || captureState.status === 'unexpected-error') && <p className="inline-error" role="alert">{captureState.message}</p>}</>}
            </section>
          ) : (
            <div className="compact-state" role="status"><strong>Choose an available mode</strong><span>Annotated is checking the connected page for supported creation options.</span></div>
          )}
          {hostedMediaPanel}
          {supabase && contextUrl && contextCacheKey && <AnnotationCollection key={contextCacheKey} supabase={supabase} cache={socialCacheRef.current} cacheKey={contextCacheKey} sourceUrl={youtubeSource?.normalizedUrl ?? tiktokSource?.normalizedUrl ?? spotifySource?.normalizedUrl ?? contextUrl} navigation={navigationCallbacks} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} articleHover={articleHover} audioHover={audioHover} pageVideoHover={pageVideoHover} tiktokHover={tiktokHover} spotifyHover={spotifyHover} emptyTitle={youtubeSource || tiktokSource ? 'No clips on this video yet' : exclusivePodcast || spotifySource ? 'No clips on this episode yet' : 'Be the first to annotate this source'} emptyMessage={youtubeSource || tiktokSource ? 'Create the first public time-coded annotation below.' : exclusivePodcast || spotifySource ? 'Create the first public audio clip below.' : 'Capture a passage below to add the first public annotation.'} compactHeading={youtubeSource || tiktokSource ? 'Clips on this video' : exclusivePodcast || spotifySource ? 'Clips on this episode' : 'On this source'} />}
          <BrandLockup />
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
