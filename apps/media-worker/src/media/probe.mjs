import { mediaCoreFailure } from '../domain/media-core-error.mjs';
import { runExecutable } from './process.mjs';

export const VIDEO_RAW_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_RAW_MAX_BYTES = 16 * 1024 * 1024;
export const VIDEO_FINAL_MAX_BYTES = 16 * 1024 * 1024;
export const AUDIO_FINAL_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_FINAL_DURATION_MS = 90_000;
export const RAW_ABSOLUTE_MAX_DURATION_MS = 92_000;
const PROBE_DURATION_TOLERANCE_MS = 20;
// Chrome tabCapture + MediaRecorder audio WebM may stamp packets on the source
// media clock (Spotify currentTime ≈ 300 s) and write format.duration as the last
// timestamp (~360 s) instead of the ~60 s span. Treat disagreements larger than
// the existing raw overshoot ceiling as a wrong duration quantity, not jitter.
export const WEBM_DURATION_DISAGREEMENT_MS = 2_000;
// Packet timelines that start at least 1 s after 0 are media-clock offsets, not
// ordinary MediaRecorder priming (a few milliseconds around the origin).
const PACKET_TIMELINE_OFFSET_MS = 1_000;
// Chrome MediaRecorder.start(1000) writes a ~1 s Cluster-0 timeslice before
// media-clock Blocks (28 s–105 s). #96 only skipped a 0.5 s / <1 s prefix, so
// a full first timeslice pinned origin at 0 and recovered ~105 s. Allow one
// timeslice plus encoder jitter; stop scanning once the prefix is past that.
const PACKET_ORIGIN_PREFIX_MAX_RATIO = 0.05;
export const PACKET_ORIGIN_PREFIX_MAX_SECONDS = 1.25;
const OPUS_FRAME_SECONDS = Object.freeze([0.0025, 0.005, 0.01, 0.02, 0.04, 0.06]);
const OPUS_FRAME_SNAP_SECONDS = 0.003;
const MIN_INTRA_CLUSTER_DELTAS = 10;
// Prefer summed packet duration_time when most packets report it. That is the
// encoded content length, unlike container last-timestamp or a quantized
// playhead span (player 30 s–106 s = 76 s for a 77 s recorder run).
const PACKET_CONTENT_COVERAGE = 0.9;
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
    '-select_streams', 'a',
    '-show_entries', 'packet=pts_time,duration_time',
    '-of', 'csv=p=0',
    inputPath,
  ];
}

export function inferPacketTimelineOriginSeconds(sortedStartSeconds) {
  if (!Array.isArray(sortedStartSeconds) || sortedStartSeconds.length < 1) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet-derived media duration is invalid.');
  }
  const minStart = sortedStartSeconds[0];
  const defaultOrigin = minStart * 1_000 >= PACKET_TIMELINE_OFFSET_MS ? minStart : 0;
  const total = sortedStartSeconds.length;
  for (let index = 1; index < total; index += 1) {
    const previous = sortedStartSeconds[index - 1];
    const next = sortedStartSeconds[index];
    if (previous > PACKET_ORIGIN_PREFIX_MAX_SECONDS) break;
    if (next - previous < PACKET_TIMELINE_OFFSET_MS / 1_000) continue;
    const prefixRatio = index / total;
    const prefixDuration = previous - minStart;
    const suffixCount = total - index;
    if ((prefixRatio <= PACKET_ORIGIN_PREFIX_MAX_RATIO || suffixCount > index) &&
        prefixDuration <= PACKET_ORIGIN_PREFIX_MAX_SECONDS &&
        next * 1_000 >= PACKET_TIMELINE_OFFSET_MS) {
      return next;
    }
  }
  return defaultOrigin;
}

function medianNumber(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function snapOpusFrameSeconds(deltaSeconds) {
  let best = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const frame of OPUS_FRAME_SECONDS) {
    const error = Math.abs(deltaSeconds - frame);
    if (error < bestError) {
      best = frame;
      bestError = error;
    }
  }
  if (best === null || bestError > Math.max(OPUS_FRAME_SNAP_SECONDS, best * 0.25)) return null;
  return best;
}

function estimatedContentMsFromPacketStarts(starts) {
  const intraDeltas = [];
  for (let index = 1; index < starts.length; index += 1) {
    const delta = starts[index] - starts[index - 1];
    if (delta > 0 && delta < PACKET_TIMELINE_OFFSET_MS / 1_000) intraDeltas.push(delta);
  }
  if (intraDeltas.length < MIN_INTRA_CLUSTER_DELTAS) return null;
  const frame = snapOpusFrameSeconds(medianNumber(intraDeltas));
  if (frame === null) return null;
  const estimateMs = starts.length * frame * 1_000;
  if (!Number.isFinite(estimateMs) || estimateMs < 1_000 || estimateMs > RAW_ABSOLUTE_MAX_DURATION_MS) {
    return null;
  }
  return estimateMs;
}

export function packetDurationMs(output) {
  if (typeof output !== 'string' || !output.endsWith('\n')) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet timing output is incomplete.');
  }
  const lines = output.trim().split(/\r?\n/u);
  if (lines.length < 1 || lines.length > 25_000) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet timing count is invalid.');
  }
  const starts = [];
  let maximumEndSeconds = Number.NEGATIVE_INFINITY;
  let contentSeconds = 0;
  let packetsWithDuration = 0;
  for (const line of lines) {
    const [ptsText, durationText, ...extra] = line.split(',');
    const pts = Number(ptsText);
    const duration = durationText === 'N/A' ? 0 : Number(durationText);
    if (extra.some((value) => value !== '') || !Number.isFinite(pts) || pts < -2 ||
        !Number.isFinite(duration) || duration < 0 || duration > 2) {
      mediaCoreFailure('probing', 'probe_failed', 'Packet timing value is invalid.');
    }
    starts.push(pts);
    maximumEndSeconds = Math.max(maximumEndSeconds, pts + duration);
    if (durationText !== 'N/A' && duration > 0) {
      contentSeconds += duration;
      packetsWithDuration += 1;
    }
  }
  starts.sort((left, right) => left - right);
  const originSeconds = inferPacketTimelineOriginSeconds(starts);
  if (!Number.isFinite(originSeconds) || !Number.isFinite(maximumEndSeconds)) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet-derived media duration is invalid.');
  }
  const spanMs = (maximumEndSeconds - originSeconds) * 1_000;
  const contentMs = contentSeconds * 1_000;
  const contentCoverage = packetsWithDuration / starts.length;
  let value = spanMs;
  if (contentCoverage >= PACKET_CONTENT_COVERAGE &&
      contentMs >= 1_000 &&
      contentMs <= RAW_ABSOLUTE_MAX_DURATION_MS &&
      Math.abs(spanMs - contentMs) > PROBE_DURATION_TOLERANCE_MS) {
    value = contentMs;
  } else if (contentCoverage < PACKET_CONTENT_COVERAGE) {
    const estimatedMs = estimatedContentMsFromPacketStarts(starts);
    if (estimatedMs !== null && Math.abs(spanMs - estimatedMs) > PROBE_DURATION_TOLERANCE_MS) {
      value = estimatedMs;
    }
  }
  if (!Number.isFinite(value) || value <= 0) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet-derived media duration is invalid.');
  }
  return value;
}

export function selectWebmDurationMs(formatDurationMs, packetMs) {
  if (!Number.isFinite(packetMs) || packetMs <= 0) {
    mediaCoreFailure('probing', 'probe_failed', 'Packet-derived media duration is invalid.');
  }
  if (!Number.isFinite(formatDurationMs) || formatDurationMs <= 0) {
    return { durationMs: packetMs, source: 'packet_timestamps' };
  }
  if (Math.abs(formatDurationMs - packetMs) > WEBM_DURATION_DISAGREEMENT_MS) {
    return { durationMs: packetMs, source: 'packet_timestamps' };
  }
  return { durationMs: formatDurationMs, source: 'container' };
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
  if (webm) {
    const packets = await runExecutable(ffprobePath, ffprobePacketDurationArguments(inputPath), {
      timeoutMs,
      stage: 'probing',
      failureCode: 'probe_failed',
    });
    if (packets.stdoutTruncated) {
      mediaCoreFailure('probing', 'probe_failed', 'Packet timing output exceeded its bound.');
    }
    const packetOutput = typeof packets.stdout === 'string' ? packets.stdout : '';
    const normalizedPackets = packetOutput.endsWith('\n')
      ? packetOutput
      : packetOutput.length > 0 ? `${packetOutput}\n` : '';
    if (normalizedPackets) {
      if (!probe.format || typeof probe.format !== 'object') {
        mediaCoreFailure('probing', 'probe_failed', 'Media container is missing.');
      }
      const packetMs = packetDurationMs(normalizedPackets);
      probe.format.packet_duration_ms = packetMs;
      const selected = selectWebmDurationMs(formatDuration, packetMs);
      if (selected.source === 'packet_timestamps') {
        probe.format.duration = (selected.durationMs / 1_000).toFixed(6);
        probe.format.duration_source = selected.source;
      }
    }
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

  let probedDurationMs = durationMs(probe);
  const minRawDurationMs = Math.max(1_000, requestedDurationMs + leadInMs - PROBE_DURATION_TOLERANCE_MS);
  const maxRawDurationMs = Math.min(RAW_ABSOLUTE_MAX_DURATION_MS, requestedDurationMs + leadInMs + 2_000);
  if (probedDurationMs < minRawDurationMs || probedDurationMs > maxRawDurationMs) {
    const packetMs = Number(probe?.format?.packet_duration_ms);
    if (Number.isFinite(packetMs) && packetMs >= minRawDurationMs && packetMs <= maxRawDurationMs) {
      probedDurationMs = packetMs;
    } else {
      mediaCoreFailure('probing', 'duration_out_of_bounds', 'Raw media duration is outside the allowed recorder bound.');
    }
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
