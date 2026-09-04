import { mediaCoreFailure } from '../domain/media-core-error.mjs';
import { runExecutable } from './process.mjs';

export const VIDEO_RAW_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_RAW_MAX_BYTES = 16 * 1024 * 1024;
export const VIDEO_FINAL_MAX_BYTES = 16 * 1024 * 1024;
export const AUDIO_FINAL_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_FINAL_DURATION_MS = 90_000;
const PROBE_DURATION_TOLERANCE_MS = 20;
// AAC-LC at 48 kHz uses 1024 samples per frame ≈ 21.333 ms. Chrome MV3 tabCapture
// + MediaRecorder + ffmpeg `-ss` after `-i` plus `-t` can emit a few extra frames
// and container-duration rounding on real ≤90 s clips. PRs #46–#48 admitted one
// frame (22 ms); Staging still rejected an ~18 s tab-capture derivative as
// duration_overshoot. 100 ms is ~4.7 AAC frames: enough for that production
// jitter, not a multi-second overshoot allowance. Absolute product max remains
// MAX_FINAL_DURATION_MS (90_000).
export const DERIVATIVE_DURATION_TOLERANCE_MS = 100;
// Seconds-to-milliseconds conversion can leave IEEE-754 dust far below 1 µs.
const DURATION_COMPARE_EPSILON_MS = 0.001;

export function ffprobeArguments(inputPath) {
  return [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration,size',
    '-show_entries', 'stream=index,codec_name,codec_type,profile,pix_fmt,width,height,sample_rate,channels',
    '-of', 'json',
    inputPath,
  ];
}

export function ffprobePacketDurationArguments(inputPath) {
  return [
    '-v', 'error',
    '-show_entries', 'packet=pts_time,duration_time',
    '-of', 'csv=p=0',
    inputPath,
  ];
}

export function packetDurationMs(output) {
  if (typeof output !== 'string' || !output.endsWith('\n')) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet timing output is incomplete.');
  }
  const lines = output.trim().split(/\r?\n/u);
  if (lines.length < 1 || lines.length > 25_000) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet timing count is invalid.');
  }
  let maximumSeconds = 0;
  for (const line of lines) {
    const [ptsText, durationText, ...extra] = line.split(',');
    const pts = Number(ptsText);
    const duration = durationText === 'N/A' ? 0 : Number(durationText);
    if (extra.some((value) => value !== '') || !Number.isFinite(pts) || pts < -2 ||
        !Number.isFinite(duration) || duration < 0 || duration > 2) {
      mediaCoreFailure('probing', 'probe_failed', 'Packet timing value is invalid.');
    }
    maximumSeconds = Math.max(maximumSeconds, pts + duration);
  }
  const value = maximumSeconds * 1_000;
  if (!Number.isFinite(value) || value <= 0) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet-derived media duration is invalid.');
  }
  return value;
}

export async function probeFile(ffprobePath, inputPath, timeoutMs = 30_000) {
  const result = await runExecutable(ffprobePath, ffprobeArguments(inputPath), {
    timeoutMs,
    stage: 'probing',
    failureCode: 'probe_failed',
  });
  let probe;
  try { probe = JSON.parse(result.stdout); }
  catch {
    mediaCoreFailure('probing', 'probe_failed', 'ffprobe returned invalid JSON.');
  }
  const formatDuration = Number(probe?.format?.duration) * 1_000;
  const webm = typeof probe?.format?.format_name === 'string' &&
    probe.format.format_name.split(',').includes('webm');
  if ((!Number.isFinite(formatDuration) || formatDuration <= 0) && webm) {
    const packets = await runExecutable(ffprobePath, ffprobePacketDurationArguments(inputPath), {
      timeoutMs,
      stage: 'probing',
      failureCode: 'probe_failed',
    });
    if (packets.stdoutTruncated) {
      mediaCoreFailure('probing', 'probe_failed', 'Packet timing output exceeded its bound.');
    }
    probe.format.duration = (packetDurationMs(packets.stdout) / 1_000).toFixed(6);
    probe.format.duration_source = 'packet_timestamps';
  }
  return probe;
}

function durationMs(probe) {
  const value = Number(probe?.format?.duration) * 1000;
  if (!Number.isFinite(value) || value <= 0) mediaCoreFailure('probing', 'probe_failed', 'Media duration is invalid.');
  return value;
}

function fileSize(probe) {
  const value = Number(probe?.format?.size);
  if (!Number.isSafeInteger(value) || value <= 0) mediaCoreFailure('probing', 'probe_failed', 'Media size is invalid.');
  return value;
}

function streams(probe) {
  if (!Array.isArray(probe?.streams)) mediaCoreFailure('probing', 'probe_failed', 'Media streams are missing.');
  const videos = probe.streams.filter((stream) => stream.codec_type === 'video');
  const audios = probe.streams.filter((stream) => stream.codec_type === 'audio');
  const others = probe.streams.filter((stream) => !['video', 'audio'].includes(stream.codec_type));
  return {
    video: videos[0],
    audio: audios[0],
    videoCount: videos.length,
    audioCount: audios.length,
    otherCount: others.length,
  };
}

function formatNames(probe) {
  const value = probe?.format?.format_name;
  if (typeof value !== 'string') mediaCoreFailure('probing', 'probe_failed', 'Media container is missing.');
  return value.split(',');
}

export function validateRawProbe({ mediaType, probe, expectedByteSize, requestedDurationMs, leadInMs }) {
  if (!formatNames(probe).includes('webm')) mediaCoreFailure('probing', 'invalid_container', 'Raw media must probe as WebM.');
  const size = fileSize(probe);
  if (size !== expectedByteSize) mediaCoreFailure('probing', 'raw_size_mismatch', 'Raw media size does not match the authoritative object size.');
  const maxBytes = mediaType === 'video' ? VIDEO_RAW_MAX_BYTES : AUDIO_RAW_MAX_BYTES;
  if (size > maxBytes) mediaCoreFailure('probing', 'raw_too_large', 'Raw media exceeds the byte limit.');

  const found = streams(probe);
  if (!found.audio) mediaCoreFailure('probing', 'missing_audio', 'Raw media has no audio stream.');
  if (found.audio.codec_name !== 'opus') mediaCoreFailure('probing', 'unsupported_codec', 'Raw audio codec is unsupported.');
  if (mediaType === 'video') {
    if (!found.video) mediaCoreFailure('probing', 'missing_video', 'Raw video has no video stream.');
    if (!['vp8', 'vp9'].includes(found.video.codec_name)) mediaCoreFailure('probing', 'unsupported_codec', 'Raw video codec is unsupported.');
    if (!Number.isInteger(found.video.width) || !Number.isInteger(found.video.height) || found.video.width < 2 || found.video.height < 2) {
      mediaCoreFailure('probing', 'probe_failed', 'Raw video dimensions are invalid.');
    }
  } else if (found.video) {
    mediaCoreFailure('probing', 'unsupported_codec', 'Audio raw input unexpectedly contains video.');
  }
  if (found.audioCount !== 1 || found.videoCount > 1 || found.otherCount !== 0) {
    mediaCoreFailure('probing', 'unsupported_codec', 'Raw media has an unsupported stream layout.');
  }

  const probedDurationMs = durationMs(probe);
  const minRawDurationMs = Math.max(1_000, requestedDurationMs + leadInMs - PROBE_DURATION_TOLERANCE_MS);
  const maxRawDurationMs = Math.min(92_000, requestedDurationMs + leadInMs + 2_000);
  if (probedDurationMs < minRawDurationMs || probedDurationMs > maxRawDurationMs) {
    mediaCoreFailure('probing', 'duration_out_of_bounds', 'Raw media duration is outside the allowed recorder bound.');
  }
  return { ...found, durationMs: probedDurationMs, byteSize: size, formatNames: formatNames(probe) };
}

function outputInvalid(reason, message) {
  mediaCoreFailure('transcoding', 'output_invalid', message, reason);
}

export function validateDerivativeProbe({ mediaType, probe, expectedByteSize, requestedDurationMs, crop }) {
  const names = formatNames(probe);
  if (!names.includes('mp4') && !names.includes('mov')) outputInvalid('invalid_container', 'Derivative container is not MP4/M4A.');
  const size = fileSize(probe);
  if (size !== expectedByteSize) outputInvalid('size_mismatch', 'Derivative size and probe facts differ.');
  const maxBytes = mediaType === 'video' ? VIDEO_FINAL_MAX_BYTES : AUDIO_FINAL_MAX_BYTES;
  if (size > maxBytes) mediaCoreFailure('transcoding', 'output_too_large', 'Derivative exceeds the byte limit.');
  const found = streams(probe);
  if (found.audioCount !== 1 || found.videoCount > 1 || found.otherCount !== 0) {
    outputInvalid('unsupported_stream_layout', 'Derivative has an unsupported stream layout.');
  }
  if (!found.audio || found.audio.codec_name !== 'aac') outputInvalid('invalid_audio_codec', 'Derivative must contain AAC audio.');
  if (found.audio.profile !== 'LC' || found.audio.sample_rate !== '48000' || !Number.isInteger(found.audio.channels) || found.audio.channels < 1 || found.audio.channels > 2) {
    outputInvalid('invalid_aac_format', 'Derivative AAC profile or channel format is invalid.');
  }
  if (mediaType === 'video') {
    if (!found.video || found.video.codec_name !== 'h264' || found.video.profile !== 'Main' || found.video.pix_fmt !== 'yuv420p') {
      outputInvalid('invalid_video_codec', 'Video derivative must contain H.264 yuv420p video.');
    }
    if (found.video.width % 2 || found.video.height % 2 || found.video.width > 426 || found.video.height > 240) {
      outputInvalid('invalid_dimensions', 'Video derivative dimensions are invalid.');
    }
    if (crop && (found.video.width > crop.width || found.video.height > crop.height)) {
      outputInvalid('upscaled', 'Video derivative was upscaled.');
    }
  } else if (found.video) {
    outputInvalid('unexpected_video', 'Audio derivative unexpectedly contains video.');
  }

  const probedDurationMs = durationMs(probe);
  const minDerivativeDurationMs = Math.max(1_000, requestedDurationMs - DERIVATIVE_DURATION_TOLERANCE_MS);
  const maxDerivativeDurationMs = Math.min(MAX_FINAL_DURATION_MS, requestedDurationMs + DERIVATIVE_DURATION_TOLERANCE_MS);
  if (probedDurationMs > MAX_FINAL_DURATION_MS + DURATION_COMPARE_EPSILON_MS) {
    outputInvalid('duration_exceeds_max', 'Derivative duration is outside the selected range.');
  }
  if (probedDurationMs > maxDerivativeDurationMs + DURATION_COMPARE_EPSILON_MS) {
    outputInvalid('duration_overshoot', 'Derivative duration is outside the selected range.');
  }
  if (probedDurationMs < minDerivativeDurationMs - DURATION_COMPARE_EPSILON_MS) {
    outputInvalid('duration_undershoot', 'Derivative duration is outside the selected range.');
  }
  return { ...found, durationMs: probedDurationMs, byteSize: size, formatNames: names };
}
