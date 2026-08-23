import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalDerivative } from '../src/media/local-media-core.mjs';

const REQUESTED_DURATION_MS = 90_000;
const LEAD_IN_MS = 500;
const RAW_DURATION_SECONDS = '90.958';
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const EXPECTED_FRAMES = REQUESTED_DURATION_MS / 1_000 * SAMPLE_RATE;
const root = path.resolve(process.env.ANNOTATED_C6_AUDIO_QUALITY_ROOT ?? path.join(os.tmpdir(), 'Annotated-c6-audio-quality-local'));
const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
if (!root.startsWith(temporaryRoot) || !path.basename(root).startsWith('Annotated-c6-audio-quality-local')) {
  throw new Error('Audio-quality evidence root must be an Annotated C6 directory inside the temporary directory.');
}
const bin = process.env.ANNOTATED_FFMPEG_BIN;
if (!bin) throw new Error('ANNOTATED_FFMPEG_BIN must point to the checksum-verified FFmpeg bin directory.');
const ffmpegPath = path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobePath = path.join(bin, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
if (!existsSync(ffmpegPath) || !existsSync(ffprobePath)) throw new Error('Pinned FFmpeg or ffprobe is missing.');
if (existsSync(root)) throw new Error(`Audio-quality evidence already exists: ${root}`);

const variants = Object.freeze([
  { name: 'audio-opus64', mediaType: 'audio', videoCodec: null, audioBitrate: '64k' },
  { name: 'vp9-opus64', mediaType: 'video', videoCodec: 'libvpx-vp9', audioBitrate: '64k' },
  { name: 'vp8-opus96', mediaType: 'video', videoCodec: 'libvpx', audioBitrate: '96k' },
]);
const frequencies = Object.freeze([
  [523, 659],
  [733, 887],
  [977, 1_129],
]);

function run(args, label, { encoding = 'utf8', maxBuffer = 64 * 1024 * 1024 } = {}) {
  const result = spawnSync(ffmpegPath, args, { encoding, maxBuffer, windowsHide: true });
  if (result.error || result.status !== 0) {
    const detail = encoding === null ? String(result.stderr ?? '') : (result.stderr || result.stdout || '').trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : '.'}`);
  }
  return result.stdout;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function captureMetadata(mediaType) {
  const timing = {
    requested_start_ms: 0,
    requested_end_ms: REQUESTED_DURATION_MS,
    requested_duration_ms: REQUESTED_DURATION_MS,
    lead_in_ms: LEAD_IN_MS,
    recorder_elapsed_ms: 90_958,
    player_start_ms: 0,
    player_end_ms: REQUESTED_DURATION_MS,
    lead_in_clock: 'offscreen_monotonic',
  };
  const captureTrack = {
    mime_type: mediaType === 'video' ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus',
    audio_track_count: 1,
    video_track_count: mediaType === 'video' ? 1 : 0,
    tracks: [
      { kind: 'audio', settings: { sampleRate: SAMPLE_RATE, channelCount: CHANNELS } },
      ...(mediaType === 'video' ? [{ kind: 'video', settings: { width: 160, height: 90, frameRate: 5 } }] : []),
    ],
    loopback_enabled: true,
  };
  if (mediaType === 'audio') return { version: 2, capture_track: captureTrack, timing };
  const viewport = { width: 160, height: 90, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 };
  const rect = { x: 0, y: 0, width: 160, height: 90, top: 0, right: 160, bottom: 90, left: 0 };
  return {
    version: 2,
    viewport: { start: viewport, end: structuredClone(viewport) },
    video_element: { start: rect, end: structuredClone(rect) },
    intrinsic_video: { width: 160, height: 90 },
    computed_style: { object_fit: 'contain', object_position: '50% 50%' },
    fullscreen: { start: false, end: false },
    capture_track: captureTrack,
    timing,
  };
}

function generateRaw(outputPath, variant, [leftHz, rightHz]) {
  const audioSource = `0.08*sin(2*PI*${leftHz}*t)|0.08*sin(2*PI*${rightHz}*t)`;
  const inputs = variant.mediaType === 'video'
    ? ['-f', 'lavfi', '-i', `color=c=0x24445c:s=160x90:r=5:d=${RAW_DURATION_SECONDS}`, '-f', 'lavfi', '-i', `aevalsrc=${audioSource}:s=${SAMPLE_RATE}:d=${RAW_DURATION_SECONDS}`]
    : ['-f', 'lavfi', '-i', `aevalsrc=${audioSource}:s=${SAMPLE_RATE}:d=${RAW_DURATION_SECONDS}`];
  const codec = variant.mediaType === 'video'
    ? ['-map', '0:v:0', '-map', '1:a:0', '-c:v', variant.videoCodec, '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '80k', '-c:a', 'libopus', '-b:a', variant.audioBitrate]
    : ['-map', '0:a:0', '-c:a', 'libopus', '-b:a', variant.audioBitrate];
  run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-t', RAW_DURATION_SECONDS, ...codec, '-f', 'webm', outputPath], `Generate ${variant.name}`);
}

function decodePcm(inputPath, trimLeadIn) {
  const trim = trimLeadIn
    ? ['-ss', (LEAD_IN_MS / 1_000).toFixed(3), '-t', (REQUESTED_DURATION_MS / 1_000).toFixed(3)]
    : ['-t', (REQUESTED_DURATION_MS / 1_000).toFixed(3)];
  return run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', inputPath, ...trim, '-map', '0:a:0', '-vn', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-f', 's16le', 'pipe:1'], `Decode ${path.basename(inputPath)}`, { encoding: null });
}

function writeListeningWav(inputPath, outputPath, trimLeadIn) {
  const trim = trimLeadIn
    ? ['-ss', (LEAD_IN_MS / 1_000).toFixed(3), '-t', (REQUESTED_DURATION_MS / 1_000).toFixed(3)]
    : ['-t', (REQUESTED_DURATION_MS / 1_000).toFixed(3)];
  run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, ...trim, '-map', '0:a:0', '-vn', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-c:a', 'pcm_s16le', outputPath], `Write ${path.basename(outputPath)}`);
}

function percentile(histogram, count, quantile) {
  const target = Math.ceil(count * quantile);
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return histogram.length - 1;
}

function analyzePcm(buffer) {
  if (buffer.length % (CHANNELS * 2) !== 0) throw new Error('Decoded PCM is not complete stereo s16le.');
  const frames = buffer.length / (CHANNELS * 2);
  const edgeFrames = Math.floor(SAMPLE_RATE * 0.1);
  const histogram = new Uint32Array(65_536);
  const sums = [0, 0];
  const peaks = [0, 0];
  let maxStep = 0;
  let stepCount = 0;
  let zeroRun = 0;
  let maximumZeroRun = 0;
  const windowFrames = 960;
  const windows = [];
  let windowSum = 0;
  let windowSamples = 0;
  for (let frame = edgeFrames; frame < frames - edgeFrames; frame += 1) {
    let frameEnergy = 0;
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const offset = (frame * CHANNELS + channel) * 2;
      const sample = buffer.readInt16LE(offset);
      const prior = buffer.readInt16LE(offset - CHANNELS * 2);
      const absolute = Math.abs(sample);
      const step = Math.abs(sample - prior);
      sums[channel] += sample * sample;
      peaks[channel] = Math.max(peaks[channel], absolute);
      histogram[Math.min(65_535, step)] += 1;
      maxStep = Math.max(maxStep, step);
      stepCount += 1;
      frameEnergy += sample * sample;
      if (absolute <= 2) {
        zeroRun += 1;
        maximumZeroRun = Math.max(maximumZeroRun, zeroRun);
      } else {
        zeroRun = 0;
      }
    }
    windowSum += frameEnergy / CHANNELS;
    windowSamples += 1;
    if (windowSamples === windowFrames) {
      windows.push(Math.sqrt(windowSum / windowSamples));
      windowSum = 0;
      windowSamples = 0;
    }
  }
  const analyzedFrames = frames - edgeFrames * 2;
  const rms = sums.map((sum) => Math.sqrt(sum / analyzedFrames));
  const sortedWindows = [...windows].sort((a, b) => a - b);
  const medianWindowRms = sortedWindows[Math.floor(sortedWindows.length / 2)];
  const minimumWindowRms = sortedWindows[0];
  const p9999Step = percentile(histogram, stepCount, 0.9999);
  let largeStepCount = 0;
  for (let value = 4_097; value < histogram.length; value += 1) largeStepCount += histogram[value];
  return {
    frames,
    duration_ms: Math.round(frames / SAMPLE_RATE * 1_000),
    rms: rms.map((value) => Number((value / 32_768).toFixed(6))),
    peaks: peaks.map((value) => Number((value / 32_768).toFixed(6))),
    channel_rms_ratio: Number((Math.max(...rms) / Math.min(...rms)).toFixed(6)),
    maximum_step: maxStep,
    p9999_step: p9999Step,
    large_step_count: largeStepCount,
    maximum_near_zero_run_samples: maximumZeroRun,
    minimum_to_median_window_rms_ratio: Number((minimumWindowRms / medianWindowRms).toFixed(6)),
  };
}

function passesSignalGate(stats) {
  return stats.frames === EXPECTED_FRAMES && stats.duration_ms === REQUESTED_DURATION_MS &&
    stats.channel_rms_ratio <= 1.25 && stats.maximum_step <= 4_096 && stats.large_step_count === 0 &&
    stats.maximum_near_zero_run_samples <= 12 && stats.minimum_to_median_window_rms_ratio >= 0.65;
}

await mkdir(root, { recursive: false });
const results = [];
const listening = [];
for (const [variantIndex, variant] of variants.entries()) {
  for (let sampleIndex = 0; sampleIndex < frequencies.length; sampleIndex += 1) {
    const name = `${variant.name}-sample-${sampleIndex + 1}`;
    const rawPath = path.join(root, `${name}-raw.webm`);
    const derivativePath = path.join(root, `${name}-derivative.${variant.mediaType === 'video' ? 'mp4' : 'm4a'}`);
    generateRaw(rawPath, variant, frequencies[sampleIndex]);
    const derivative = await createLocalDerivative({
      ffmpegPath,
      ffprobePath,
      mediaType: variant.mediaType,
      inputPath: rawPath,
      outputPath: derivativePath,
      captureMetadata: captureMetadata(variant.mediaType),
      requestedDurationMs: REQUESTED_DURATION_MS,
    });
    const rawPcm = decodePcm(rawPath, true);
    const derivativePcm = decodePcm(derivativePath, false);
    const rawStats = analyzePcm(rawPcm);
    const derivativeStats = analyzePcm(derivativePcm);
    const passed = passesSignalGate(rawStats) && passesSignalGate(derivativeStats) && derivative.output.durationMs === REQUESTED_DURATION_MS;
    results.push({
      name,
      media_type: variant.mediaType,
      input_audio_bitrate: variant.audioBitrate,
      raw_sha256: sha256(await readFile(rawPath)),
      derivative_sha256: sha256(await readFile(derivativePath)),
      derivative_facts: derivative,
      raw_signal: rawStats,
      derivative_signal: derivativeStats,
      passed,
    });
    if (sampleIndex === variantIndex) {
      const pair = listening.length + 1;
      const rawIsA = pair % 2 === 1;
      const aPath = path.join(root, `listen-${pair}-a.wav`);
      const bPath = path.join(root, `listen-${pair}-b.wav`);
      writeListeningWav(rawIsA ? rawPath : derivativePath, aPath, rawIsA);
      writeListeningWav(rawIsA ? derivativePath : rawPath, bPath, !rawIsA);
      listening.push({ pair, variant: variant.name, a: rawIsA ? 'raw' : 'derivative', b: rawIsA ? 'derivative' : 'raw' });
    }
  }
}
const passed = results.every((result) => result.passed);
await writeFile(path.join(root, 'results.json'), `${JSON.stringify({ gate: 'c6_audio_quality_local', passed, results }, null, 2)}\n`, 'utf8');
await writeFile(path.join(root, 'blind-map.json'), `${JSON.stringify({ keep_blind_until_owner_results: true, listening }, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ gate: 'c6_audio_quality_local', variant_count: variants.length,
  samples_per_variant: frequencies.length, analyzed_pair_count: results.length, blind_listening_pair_count: listening.length,
  duration_ms_each: REQUESTED_DURATION_MS, output_root: root, passed })}\n`);
if (!passed) process.exitCode = 1;
