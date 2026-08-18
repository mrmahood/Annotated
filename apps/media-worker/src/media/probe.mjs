import { mediaCoreFailure } from '../domain/media-core-error.mjs';
import { runExecutable } from './process.mjs';

export const VIDEO_RAW_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_RAW_MAX_BYTES = 16 * 1024 * 1024;
export const VIDEO_FINAL_MAX_BYTES = 16 * 1024 * 1024;
export const AUDIO_FINAL_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_FINAL_DURATION_MS = 90_000;
const PROBE_DURATION_TOLERANCE_MS = 20;

export function ffprobeArguments(inputPath) {
  return [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration,size',
    '-show_entries', 'stream=index,codec_name,codec_type,profile,pix_fmt,width,height,sample_rate,channels',
    '-of', 'json',
    inputPath,
  ];
}

export async function probeFile(ffprobePath, inputPath, timeoutMs = 30_000) {
  const result = await runExecutable(ffprobePath, ffprobeArguments(inputPath), {
    timeoutMs,
    stage: 'probing',
    failureCode: 'probe_failed',
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    mediaCoreFailure('probing', 'probe_failed', 'ffprobe returned invalid JSON.');
  }
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
  const maxRawDurationMs = Math.min(92_000, requestedDurationMs + leadInMs + 2_000);
  if (probedDurationMs < 1_000 || probedDurationMs > maxRawDurationMs) {
    mediaCoreFailure('probing', 'duration_out_of_bounds', 'Raw media duration is outside the allowed recorder bound.');
  }
  return { ...found, durationMs: probedDurationMs, byteSize: size, formatNames: formatNames(probe) };
}

export function validateDerivativeProbe({ mediaType, probe, expectedByteSize, requestedDurationMs, crop }) {
  const names = formatNames(probe);
  if (!names.includes('mp4') && !names.includes('mov')) mediaCoreFailure('transcoding', 'output_invalid', 'Derivative container is not MP4/M4A.');
  const size = fileSize(probe);
  if (size !== expectedByteSize) mediaCoreFailure('transcoding', 'output_invalid', 'Derivative size and probe facts differ.');
  const maxBytes = mediaType === 'video' ? VIDEO_FINAL_MAX_BYTES : AUDIO_FINAL_MAX_BYTES;
  if (size > maxBytes) mediaCoreFailure('transcoding', 'output_too_large', 'Derivative exceeds the byte limit.');
  const found = streams(probe);
  if (found.audioCount !== 1 || found.videoCount > 1 || found.otherCount !== 0) {
    mediaCoreFailure('transcoding', 'output_invalid', 'Derivative has an unsupported stream layout.');
  }
  if (!found.audio || found.audio.codec_name !== 'aac') mediaCoreFailure('transcoding', 'output_invalid', 'Derivative must contain AAC audio.');
  if (found.audio.profile !== 'LC' || found.audio.sample_rate !== '48000' || !Number.isInteger(found.audio.channels) || found.audio.channels < 1 || found.audio.channels > 2) {
    mediaCoreFailure('transcoding', 'output_invalid', 'Derivative AAC profile or channel format is invalid.');
  }
  if (mediaType === 'video') {
    if (!found.video || found.video.codec_name !== 'h264' || found.video.profile !== 'Main' || found.video.pix_fmt !== 'yuv420p') {
      mediaCoreFailure('transcoding', 'output_invalid', 'Video derivative must contain H.264 yuv420p video.');
    }
    if (found.video.width % 2 || found.video.height % 2 || found.video.width > 426 || found.video.height > 240) {
      mediaCoreFailure('transcoding', 'output_invalid', 'Video derivative dimensions are invalid.');
    }
    if (crop && (found.video.width > crop.width || found.video.height > crop.height)) {
      mediaCoreFailure('transcoding', 'output_invalid', 'Video derivative was upscaled.');
    }
  } else if (found.video) {
    mediaCoreFailure('transcoding', 'output_invalid', 'Audio derivative unexpectedly contains video.');
  }

  const probedDurationMs = durationMs(probe);
  if (probedDurationMs < 1_000 || probedDurationMs > MAX_FINAL_DURATION_MS || probedDurationMs > requestedDurationMs + PROBE_DURATION_TOLERANCE_MS) {
    mediaCoreFailure('transcoding', 'output_invalid', 'Derivative duration is outside the selected range.');
  }
  return { ...found, durationMs: probedDurationMs, byteSize: size, formatNames: names };
}
