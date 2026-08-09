export const ANNOTATION_AUDIO_BUCKET = "annotation-audio";
export const ANNOTATION_AUDIO_MIME_TYPE = "audio/webm";
export const AUDIO_MAX_BYTE_SIZE = 6 * 1024 * 1024;

const STORAGE_PATH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webm$/i;

export type PublicAnnotationAudio = {
  storagePath: string;
  durationMs: number;
  byteSize: number;
};

type UnknownRecord = Record<string, unknown>;

function getSingleRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    return value.length === 1 && typeof value[0] === "object" && value[0] !== null
      ? value[0] as UnknownRecord
      : null;
  }
  return typeof value === "object" && value !== null
    ? value as UnknownRecord
    : null;
}

export function parsePublicAnnotationAudio(value: unknown): PublicAnnotationAudio | null {
  const row = getSingleRelation(value);
  if (!row) return null;
  const storagePath = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
  const durationMs = Number(row.duration_ms);
  const byteSize = Number(row.byte_size);
  if (
    !STORAGE_PATH_PATTERN.test(storagePath) ||
    row.mime_type !== ANNOTATION_AUDIO_MIME_TYPE ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1_000 ||
    durationMs > 300_000 ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > AUDIO_MAX_BYTE_SIZE
  ) {
    return null;
  }
  return { storagePath, durationMs, byteSize };
}

export function formatAudioDuration(durationMs: number): string {
  const totalSeconds = Math.min(300, Math.max(0, Math.ceil(durationMs / 1_000)));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
