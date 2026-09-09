export const ANNOTATION_AUDIO_BUCKET = 'annotation-audio';
export const ANNOTATION_AUDIO_MIME_TYPE = 'audio/webm';
export const AUDIO_MIN_DURATION_MS = 1_000;
export const AUDIO_MAX_DURATION_MS = 300_000;
export const AUDIO_MAX_BYTE_SIZE = 6 * 1024 * 1024;

const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
] as const;

const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const STORAGE_PATH_PATTERN = new RegExp(
  `^(${UUID_PATTERN})/(${UUID_PATTERN})\\.webm$`,
  'i',
);

export type AnnotationAudio = {
  storagePath: string;
  durationMs: number;
  mimeType: typeof ANNOTATION_AUDIO_MIME_TYPE;
  byteSize: number;
};

export type RecordingState =
  | { status: 'idle' }
  | { status: 'requesting_permission' }
  | { status: 'recording'; elapsedMs: number }
  | {
      status: 'recorded';
      blob: Blob;
      previewUrl: string;
      durationMs: number;
    }
  | { status: 'error'; message: string };

export type RecordingAction =
  | { type: 'request' }
  | { type: 'start' }
  | { type: 'tick'; elapsedMs: number }
  | {
      type: 'finish';
      blob: Blob;
      previewUrl: string;
      durationMs: number;
    }
  | { type: 'fail'; message: string }
  | { type: 'discard' };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getSingleRelation(value: unknown): UnknownRecord | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.length === 1 && isRecord(value[0]) ? value[0] : null;
  }
  return isRecord(value) ? value : null;
}

function getSafeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function selectRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  return RECORDING_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType)) ?? null;
}

export function formatAudioDuration(durationMs: number): string {
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : 0;
  const totalSeconds = Math.min(
    Math.ceil(safeDuration / 1_000),
    AUDIO_MAX_DURATION_MS / 1_000,
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getAudioValidationError(
  blob: Pick<Blob, 'size' | 'type'>,
  durationMs: number,
): string | null {
  if (!Number.isFinite(durationMs) || durationMs < AUDIO_MIN_DURATION_MS) {
    return 'Record at least 1 second of audio.';
  }
  if (durationMs > AUDIO_MAX_DURATION_MS) {
    return 'Audio commentary cannot exceed 5 minutes.';
  }
  if (blob.size <= 0) {
    return 'The recording did not contain audio. Try recording again.';
  }
  if (blob.size > AUDIO_MAX_BYTE_SIZE) {
    return 'The recording exceeds the 6 MiB upload limit. Discard it and record a shorter clip.';
  }
  if (blob.type !== ANNOTATION_AUDIO_MIME_TYPE) {
    return 'The recording is not a supported WebM audio file.';
  }
  return null;
}

export function createAudioStoragePath(
  userId: string,
  createUuid: () => string = () => crypto.randomUUID(),
): string {
  const fileId = createUuid();
  const path = `${userId}/${fileId}.webm`;
  const match = STORAGE_PATH_PATTERN.exec(path);
  if (!match || match[1]?.toLowerCase() !== userId.toLowerCase()) {
    throw new Error('A safe audio storage path could not be generated.');
  }
  return path.toLowerCase();
}

export function parseAnnotationAudio(value: unknown): AnnotationAudio | null {
  const audio = getSingleRelation(value);
  if (!audio) return null;
  const storagePath = typeof audio.storage_path === 'string'
    ? audio.storage_path.trim()
    : '';
  const durationMs = getSafeInteger(audio.duration_ms);
  const byteSize = getSafeInteger(audio.byte_size);
  const mimeType = audio.mime_type;

  if (
    !STORAGE_PATH_PATTERN.test(storagePath) ||
    durationMs === null ||
    durationMs < AUDIO_MIN_DURATION_MS ||
    durationMs > AUDIO_MAX_DURATION_MS ||
    byteSize === null ||
    byteSize <= 0 ||
    byteSize > AUDIO_MAX_BYTE_SIZE ||
    mimeType !== ANNOTATION_AUDIO_MIME_TYPE
  ) {
    return null;
  }

  return { storagePath, durationMs, byteSize, mimeType };
}

export function reduceRecordingState(
  state: RecordingState,
  action: RecordingAction,
): RecordingState {
  if (action.type === 'discard') return { status: 'idle' };
  if (action.type === 'request') return { status: 'requesting_permission' };
  if (action.type === 'fail') return { status: 'error', message: action.message };
  if (action.type === 'start' && state.status === 'requesting_permission') {
    return { status: 'recording', elapsedMs: 0 };
  }
  if (action.type === 'tick' && state.status === 'recording') {
    return {
      status: 'recording',
      elapsedMs: Math.min(Math.max(0, action.elapsedMs), AUDIO_MAX_DURATION_MS),
    };
  }
  if (action.type === 'finish' && state.status === 'recording') {
    return {
      status: 'recorded',
      blob: action.blob,
      previewUrl: action.previewUrl,
      durationMs: action.durationMs,
    };
  }
  return state;
}

export function getPublishRpcName(hasAudio: boolean) {
  return hasAudio
    ? 'publish_article_annotation_with_audio'
    : 'publish_article_annotation';
}

export const COMMENTARY_TEXT_LIMIT = 2_000;
export const COMMENTARY_CONTRACT_HINT =
  'Add typed commentary, a voice clip, or both.';
export const ATTACH_OWNER_ANNOTATION_AUDIO_RPC = 'attach_owner_annotation_audio';

export function getCommentaryContractError(
  text: string,
  hasRecordedCommentary: boolean,
): string | null {
  if (text.length > COMMENTARY_TEXT_LIMIT) {
    return 'Commentary cannot exceed 2,000 characters.';
  }
  if (!text.trim() && !hasRecordedCommentary) {
    return COMMENTARY_CONTRACT_HINT;
  }
  return null;
}

export function hasPublishableCommentary(
  text: string,
  hasRecordedCommentary: boolean,
): boolean {
  return getCommentaryContractError(text, hasRecordedCommentary) === null;
}

export function isCommentaryRecordingBusy(status: RecordingState['status']): boolean {
  return status === 'requesting_permission' || status === 'recording';
}

export function readStoredCommentaryText(value: unknown): string | null {
  return typeof value === 'string' && value.length <= COMMENTARY_TEXT_LIMIT
    ? value
    : null;
}
