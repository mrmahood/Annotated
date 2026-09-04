import { getAudioSourceIdentity } from "@annotated/shared/audio-source";
import { getHistoricalStoredTargetRangeError } from "@annotated/shared/media-time";
import { getYouTubeVideoIdentity } from "@annotated/shared/youtube";
import { parsePublicAnnotationAudio } from "../audio-commentary";
import { formatHostname, getHttpUrl, getOptionalText, isUuid } from "../public-content";
import {
  isPublicAnnotationSlug,
  isPublicCreatorHandle,
  type PublicAnnotationRoute,
} from "../public-routes";

const VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const AUDIO_MAX_BYTES = 8 * 1024 * 1024;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 90_000;
// Matches worker/SQL DERIVATIVE_DURATION_TOLERANCE_MS (100 ms).
const DURATION_SLACK_MS = 100;
const TRANSCRIPT_MAX_LENGTH = 20_000;
const TRANSCRIPT_SEGMENT_MAX_LENGTH = 2_000;
const TRANSCRIPT_SEGMENT_LIMIT = 500;

type UnknownRecord = Record<string, unknown>;

export type PublicTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type PublicTranscript = {
  text: string;
  language: string | null;
  segments: PublicTranscriptSegment[] | null;
};

type PublicAnnotationBase = {
  id: string;
  commentaryText: string;
  publishedAt: string;
  route: PublicAnnotationRoute | null;
  source: {
    canonicalUrl: string;
    title: string | null;
    author: string | null;
    publisher: string | null;
    showName: string | null;
    hostname: string;
  };
  annotator: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  audio: { publicUrl: string; durationMs: number } | null;
};

type VideoSource = PublicAnnotationBase["source"] & { type: "youtube"; videoId: string };
type AudioSource = PublicAnnotationBase["source"] & { type: "podcast"; videoId: null };

export type PublicAnnotation = PublicAnnotationBase & (
  | {
      kind: "article";
      selectedText: string;
      startMs: null;
      endMs: null;
      source: PublicAnnotationBase["source"] & { type: "article"; videoId: null };
    }
  | {
      kind: "video_legacy";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: VideoSource;
    }
  | {
      kind: "audio_legacy";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: AudioSource;
    }
  | {
      kind: "video_hosted";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: VideoSource;
      media: {
        id: string;
        mimeType: "video/mp4";
        durationMs: number;
        width: number;
        height: number;
        byteSize: number;
      };
      transcript: PublicTranscript;
    }
  | {
      kind: "audio_hosted";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: AudioSource;
      media: {
        id: string;
        mimeType: "audio/mp4";
        durationMs: number;
        width: null;
        height: null;
        byteSize: number;
      };
      transcript: PublicTranscript;
    }
  | {
      kind: "media_removed";
      mediaType: "video";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: VideoSource;
    }
  | {
      kind: "media_removed";
      mediaType: "audio";
      selectedText: null;
      startMs: number;
      endMs: number;
      source: AudioSource;
    }
);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRoute(annotation: UnknownRecord, profile: UnknownRecord): PublicAnnotationRoute | null {
  return isPublicCreatorHandle(profile.username) && isPublicAnnotationSlug(annotation.slug)
    ? { creatorHandle: profile.username, annotationSlug: annotation.slug }
    : null;
}

function safeIntegerIn(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function parseTranscript(
  value: unknown,
  annotationId: string,
  durationMs: number,
): PublicTranscript | null {
  if (!isRecord(value) || value.annotation_id !== annotationId) return null;
  const text = getOptionalText(value.transcript_text);
  const language = value.language === null ? null : getOptionalText(value.language);
  if (
    !text ||
    text.length > TRANSCRIPT_MAX_LENGTH ||
    (language !== null && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
  ) return null;

  if (value.segments === null) return { text, language, segments: null };
  if (!Array.isArray(value.segments) || value.segments.length > TRANSCRIPT_SEGMENT_LIMIT) return null;

  const segments: PublicTranscriptSegment[] = [];
  let previousEnd = 0;
  for (const candidate of value.segments) {
    if (!isRecord(candidate) || Object.keys(candidate).sort().join(",") !== "end_ms,start_ms,text") return null;
    const segmentText = getOptionalText(candidate.text);
    if (
      !segmentText ||
      segmentText.length > TRANSCRIPT_SEGMENT_MAX_LENGTH ||
      !safeIntegerIn(candidate.start_ms, previousEnd, durationMs) ||
      !safeIntegerIn(candidate.end_ms, (candidate.start_ms as number) + 1, durationMs)
    ) return null;
    segments.push({
      startMs: candidate.start_ms as number,
      endMs: candidate.end_ms as number,
      text: segmentText,
    });
    previousEnd = candidate.end_ms as number;
  }
  return { text, language, segments };
}

function parseReadyMedia(
  value: UnknownRecord,
  annotationId: string,
  expectedType: "video" | "audio",
  targetDurationMs: number,
) {
  if (
    value.annotation_id !== annotationId ||
    !isUuid(String(value.media_id ?? "")) ||
    value.media_type !== expectedType ||
    value.availability !== "ready" ||
    !safeIntegerIn(
      value.duration_ms,
      Math.max(MIN_DURATION_MS, targetDurationMs - DURATION_SLACK_MS),
      Math.min(MAX_DURATION_MS, targetDurationMs + DURATION_SLACK_MS),
    )
  ) return null;

  if (expectedType === "video") {
    if (
      value.mime_type !== "video/mp4" ||
      !safeIntegerIn(value.width, 2, 8192) ||
      !safeIntegerIn(value.height, 2, 8192) ||
      !safeIntegerIn(value.byte_size, 1, VIDEO_MAX_BYTES)
    ) return null;
    return {
      id: value.media_id as string,
      mimeType: "video/mp4" as const,
      durationMs: value.duration_ms as number,
      width: value.width as number,
      height: value.height as number,
      byteSize: value.byte_size as number,
    };
  }

  if (
    value.mime_type !== "audio/mp4" ||
    value.width !== null ||
    value.height !== null ||
    !safeIntegerIn(value.byte_size, 1, AUDIO_MAX_BYTES)
  ) return null;
  return {
    id: value.media_id as string,
    mimeType: "audio/mp4" as const,
    durationMs: value.duration_ms as number,
    width: null,
    height: null,
    byteSize: value.byte_size as number,
  };
}

function isRemovedMedia(
  value: UnknownRecord,
  annotationId: string,
  expectedType: "video" | "audio",
) {
  return value.annotation_id === annotationId &&
    isUuid(String(value.media_id ?? "")) &&
    value.media_type === expectedType &&
    value.availability === "removed" &&
    value.mime_type === null && value.duration_ms === null &&
    value.width === null && value.height === null && value.byte_size === null;
}

export function mapPublicAnnotationDetail(
  annotationValue: unknown,
  targetValue: unknown,
  sourceValue: unknown,
  profileValue: unknown,
  annotationAudioPublicUrl: string | null,
  mediaStateValue: unknown,
  transcriptValue: unknown,
): PublicAnnotation | null {
  if (!isRecord(annotationValue) || !isRecord(targetValue) || !isRecord(sourceValue) || !isRecord(profileValue)) return null;

  const annotationId = getOptionalText(annotationValue.id);
  const commentaryText = getOptionalText(annotationValue.commentary_text);
  const profileId = getOptionalText(profileValue.id);
  const canonicalUrl = getHttpUrl(sourceValue.canonical_url);
  const hostname = formatHostname(sourceValue.canonical_url);
  const publishedAt = getOptionalText(annotationValue.published_at);
  const publishedDate = publishedAt ? new Date(publishedAt) : null;
  const sourceMetadata = isRecord(sourceValue.metadata) ? sourceValue.metadata : {};
  const selectedText = getOptionalText(targetValue.selected_text);
  if (!annotationId || !isUuid(annotationId) || !commentaryText || !profileId || !isUuid(profileId) ||
      !canonicalUrl || !hostname || !publishedDate || Number.isNaN(publishedDate.getTime())) return null;

  const audioMetadata = parsePublicAnnotationAudio(annotationValue.audio);
  const publicAudioUrl = getHttpUrl(annotationAudioPublicUrl);
  const audio = audioMetadata && publicAudioUrl
    ? { publicUrl: publicAudioUrl.href, durationMs: audioMetadata.durationMs }
    : null;
  const common = {
    id: annotationId,
    commentaryText,
    publishedAt: publishedDate.toISOString(),
    route: getRoute(annotationValue, profileValue),
    source: {
      canonicalUrl: canonicalUrl.href,
      title: getOptionalText(sourceValue.title),
      author: getOptionalText(sourceValue.author),
      publisher: getOptionalText(sourceValue.publisher),
      showName: getOptionalText(sourceMetadata.show_name),
      hostname,
    },
    annotator: {
      id: profileId,
      name: getOptionalText(profileValue.display_name) ?? "Annotated reader",
      avatarUrl: getHttpUrl(profileValue.avatar_url)?.href ?? null,
    },
    audio,
  };

  if (annotationValue.annotation_type === "article_text" && sourceValue.source_type === "article" &&
      targetValue.target_type === "text" && selectedText && mediaStateValue === null && transcriptValue === null) {
    return { ...common, kind: "article", selectedText, startMs: null, endMs: null,
      source: { ...common.source, type: "article", videoId: null } };
  }

  const startMs = targetValue.start_ms;
  const endMs = targetValue.end_ms;
  if (!safeIntegerIn(startMs, 0, Number.MAX_SAFE_INTEGER) || !safeIntegerIn(endMs, 1, Number.MAX_SAFE_INTEGER) ||
      getHistoricalStoredTargetRangeError(startMs, endMs) !== null) return null;
  const targetDurationMs = endMs - startMs;
  const mediaState = mediaStateValue === null ? null : isRecord(mediaStateValue) ? mediaStateValue : undefined;
  if (mediaState === undefined) return null;

  if (annotationValue.annotation_type === "video_clip" && sourceValue.source_type === "youtube" && targetValue.target_type === "time_range") {
    try {
      const identity = getYouTubeVideoIdentity(canonicalUrl.href);
      if (identity.normalizedUrl !== getOptionalText(sourceValue.normalized_url)) return null;
      const source: VideoSource = { ...common.source, type: "youtube", videoId: identity.videoId };
      if (mediaState === null) return transcriptValue === null
        ? { ...common, kind: "video_legacy", selectedText: null, startMs, endMs, source }
        : null;
      if (isRemovedMedia(mediaState, annotationId, "video")) return transcriptValue === null
        ? { ...common, kind: "media_removed", mediaType: "video", selectedText: null, startMs, endMs, source }
        : null;
      const media = parseReadyMedia(mediaState, annotationId, "video", targetDurationMs);
      if (!media || media.mimeType !== "video/mp4") return null;
      const transcript = media ? parseTranscript(transcriptValue, annotationId, media.durationMs) : null;
      return media && transcript
        ? { ...common, kind: "video_hosted", selectedText: null, startMs, endMs, source, media, transcript }
        : null;
    } catch { return null; }
  }

  if (annotationValue.annotation_type === "audio_clip" && sourceValue.source_type === "podcast" && targetValue.target_type === "time_range") {
    try {
      const identity = getAudioSourceIdentity(canonicalUrl.href);
      if (identity.normalizedUrl !== getOptionalText(sourceValue.normalized_url)) return null;
      const source: AudioSource = { ...common.source, type: "podcast", videoId: null };
      if (mediaState === null) return transcriptValue === null
        ? { ...common, kind: "audio_legacy", selectedText: null, startMs, endMs, source }
        : null;
      if (isRemovedMedia(mediaState, annotationId, "audio")) return transcriptValue === null
        ? { ...common, kind: "media_removed", mediaType: "audio", selectedText: null, startMs, endMs, source }
        : null;
      const media = parseReadyMedia(mediaState, annotationId, "audio", targetDurationMs);
      if (!media || media.mimeType !== "audio/mp4") return null;
      const transcript = media ? parseTranscript(transcriptValue, annotationId, media.durationMs) : null;
      return media && transcript
        ? { ...common, kind: "audio_hosted", selectedText: null, startMs, endMs, source, media, transcript }
        : null;
    } catch { return null; }
  }

  return null;
}
