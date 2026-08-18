import { mediaCoreFailure } from '../domain/media-core-error.mjs';

function finiteNumber(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    mediaCoreFailure('probing', 'invalid_capture_metadata', `${label} is invalid.`);
  }
  return value;
}

function boundedInteger(value, label, maximum) {
  const number = finiteNumber(value, label, { maximum });
  if (!Number.isInteger(number)) mediaCoreFailure('probing', 'invalid_capture_metadata', `${label} must be an integer.`);
  return number;
}

export function validateCaptureMetadataV2(metadata, mediaType, expectedDurationMs) {
  if (!metadata || typeof metadata !== 'object' || metadata.version !== 2) {
    mediaCoreFailure('probing', 'recapture_required', 'Capture metadata version 2 is required.');
  }
  if (!['video', 'audio'].includes(mediaType)) {
    mediaCoreFailure('probing', 'invalid_capture_metadata', 'Media type is invalid.');
  }

  const timing = metadata.timing;
  const captureTrack = metadata.capture_track;
  if (!timing || typeof timing !== 'object' || !captureTrack || typeof captureTrack !== 'object') {
    mediaCoreFailure('probing', 'invalid_capture_metadata', 'Capture timing or track facts are missing.');
  }

  const requestedStartMs = finiteNumber(timing.requested_start_ms, 'requested_start_ms');
  const requestedEndMs = finiteNumber(timing.requested_end_ms, 'requested_end_ms');
  const requestedDurationMs = finiteNumber(timing.requested_duration_ms, 'requested_duration_ms', {
    minimum: 1_000,
    maximum: 90_000,
  });
  const leadInMs = finiteNumber(timing.lead_in_ms, 'lead_in_ms', { maximum: 91_000 });
  const recorderElapsedMs = finiteNumber(timing.recorder_elapsed_ms, 'recorder_elapsed_ms', {
    minimum: 1_000,
    maximum: 92_000,
  });
  if (requestedEndMs - requestedStartMs !== requestedDurationMs || requestedDurationMs !== expectedDurationMs) {
    mediaCoreFailure('probing', 'invalid_capture_metadata', 'Capture timing does not match the authoritative range.');
  }
  if (timing.lead_in_clock !== 'offscreen_monotonic') {
    mediaCoreFailure('probing', 'recapture_required', 'Capture lead-in is not measured on the offscreen monotonic clock.');
  }
  if (recorderElapsedMs + 20 < requestedDurationMs + leadInMs) {
    mediaCoreFailure('probing', 'duration_out_of_bounds', 'Recorder duration is too short for the selected range.');
  }
  if (recorderElapsedMs > requestedDurationMs + leadInMs + 2_000) {
    mediaCoreFailure('probing', 'duration_out_of_bounds', 'Recorder overshoot exceeds two seconds.');
  }

  const audioTrackCount = boundedInteger(captureTrack.audio_track_count, 'audio_track_count', 8);
  const videoTrackCount = boundedInteger(captureTrack.video_track_count, 'video_track_count', 8);
  if (audioTrackCount < 1 || (mediaType === 'video' && videoTrackCount < 1) || (mediaType === 'audio' && videoTrackCount !== 0)) {
    mediaCoreFailure('probing', mediaType === 'video' && videoTrackCount < 1 ? 'missing_video' : 'missing_audio', 'Capture track counts are invalid.');
  }
  const mimeType = captureTrack.mime_type;
  if (typeof mimeType !== 'string' || !mimeType.toLowerCase().startsWith(mediaType === 'video' ? 'video/webm' : 'audio/webm')) {
    mediaCoreFailure('probing', 'invalid_capture_metadata', 'Capture MIME type is invalid.');
  }
  if (!Array.isArray(captureTrack.tracks) || captureTrack.loopback_enabled !== true) {
    mediaCoreFailure('probing', 'invalid_capture_metadata', 'Capture track details are invalid.');
  }

  return { requestedStartMs, requestedEndMs, requestedDurationMs, leadInMs, recorderElapsedMs };
}
