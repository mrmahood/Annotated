import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalDerivative } from '../src/media/local-media-core.mjs';

const REQUESTED_DURATION_MS = 90_000;
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const allowedVariants = [
  'vp9-default', 'loopback-off', 'timeslice-none',
  'vp8-default', 'vp9-explicit', 'vp8-explicit',
];
const variant = process.argv[2];
const allowCalibration = process.argv.includes('--allow-calibration');
if (!allowedVariants.includes(variant)) throw new Error(`Use one variant: ${allowedVariants.join(', ')}.`);
const root = path.join(os.tmpdir(), 'Annotated-c6-browser-audio-matrix');
const analysisRoot = path.join(root, 'analysis');
const manifest = JSON.parse(await readFile(path.join(root, 'captures.json'), 'utf8'));
let captures = manifest.filter((row) => row.variant === variant &&
  row.capture_metadata?.timing?.requested_duration_ms === REQUESTED_DURATION_MS);
if (allowCalibration) {
  captures = manifest.filter((row) => row.variant === variant &&
    row.acceptance_eligible === false &&
    row.exclusion_reason === 'requested_duration_not_exactly_90000_ms' &&
    row.capture_metadata?.timing?.requested_duration_ms >= 89_000 &&
    row.capture_metadata?.timing?.requested_duration_ms < REQUESTED_DURATION_MS).slice(-1);
  if (captures.length !== 1) throw new Error(`The ${variant} calibration analysis requires exactly one bounded near-limit capture.`);
} else if (captures.length !== 3) {
  throw new Error(`The ${variant} analysis requires exactly three qualified captures.`);
}
const bin = process.env.ANNOTATED_FFMPEG_BIN;
if (!bin) throw new Error('ANNOTATED_FFMPEG_BIN must point to the checksum-verified FFmpeg bin directory.');
const ffmpegPath = path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobePath = path.join(bin, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
if (!existsSync(ffmpegPath) || !existsSync(ffprobePath)) throw new Error('Pinned FFmpeg or FFprobe is unavailable.');
await mkdir(analysisRoot, { recursive: true });

function run(args, label, encoding = 'utf8') {
  const result = spawnSync(ffmpegPath, args, { encoding, maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    const detail = encoding === null ? String(result.stderr ?? '') : (result.stderr || result.stdout || '').trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : '.'}`);
  }
  return result.stdout;
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function decodePcm(inputPath, leadInMs, durationMs) {
  return run([
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
    ...(leadInMs > 0 ? ['-ss', (leadInMs / 1_000).toFixed(3)] : []),
    '-t', (durationMs / 1_000).toFixed(3), '-map', '0:a:0', '-vn', '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS), '-f', 's16le', 'pipe:1',
  ], `Decode ${path.basename(inputPath)}`, null);
}
function writeWav(inputPath, outputPath, leadInMs, durationMs) {
  run([
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    ...(leadInMs > 0 ? ['-ss', (leadInMs / 1_000).toFixed(3)] : []),
    '-t', (durationMs / 1_000).toFixed(3), '-map', '0:a:0', '-vn', '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS), '-c:a', 'pcm_s16le', outputPath,
  ], `Write ${path.basename(outputPath)}`);
}
function percentile(values, quantile) {
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}
function analyze(buffer) {
  if (buffer.length % 4 !== 0) throw new Error('Decoded audio is not complete stereo s16le.');
  const frames = buffer.length / 4;
  const sums = [0, 0];
  const steps = [];
  let maximumStep = 0;
  let nearZeroRun = 0;
  let maximumNearZeroRun = 0;
  const windowFrames = 960;
  const windows = [];
  let windowEnergy = 0;
  let windowCount = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const offset = (frame * CHANNELS + channel) * 2;
      const sample = buffer.readInt16LE(offset);
      const prior = buffer.readInt16LE(offset - 4);
      const step = Math.abs(sample - prior);
      sums[channel] += sample * sample;
      maximumStep = Math.max(maximumStep, step);
      if (frame % 48 === 0) steps.push(step);
      if (Math.abs(sample) <= 2) {
        nearZeroRun += 1;
        maximumNearZeroRun = Math.max(maximumNearZeroRun, nearZeroRun);
      } else nearZeroRun = 0;
      windowEnergy += sample * sample;
      windowCount += 1;
    }
    if (frame % windowFrames === 0) {
      windows.push(Math.sqrt(windowEnergy / windowCount));
      windowEnergy = 0;
      windowCount = 0;
    }
  }
  const medianWindow = percentile([...windows], 0.5);
  const dropoutWindows = windows.filter((value) => value < medianWindow * 0.02).length;
  const rms = sums.map((sum) => Math.sqrt(sum / Math.max(1, frames - 1)));
  return {
    frames,
    duration_ms: Math.round(frames / SAMPLE_RATE * 1_000),
    channel_rms_ratio: Number((Math.max(...rms) / Math.max(1, Math.min(...rms))).toFixed(6)),
    maximum_step: maximumStep,
    sampled_p9999_step: percentile(steps, 0.9999),
    maximum_near_zero_run_samples: maximumNearZeroRun,
    dropout_window_count: dropoutWindows,
  };
}
function passes(raw, derivative, durationMs, requestedDurationMs) {
  const expectedFrames = requestedDurationMs / 1_000 * SAMPLE_RATE;
  const minimumFrames = expectedFrames - Math.ceil(SAMPLE_RATE * 0.025);
  const maximumFrames = expectedFrames + Math.ceil(SAMPLE_RATE * 0.025);
  return raw.frames >= minimumFrames && raw.frames <= maximumFrames &&
    derivative.frames >= minimumFrames && derivative.frames <= maximumFrames &&
    raw.duration_ms >= requestedDurationMs - 25 && raw.duration_ms <= requestedDurationMs + 25 &&
    derivative.duration_ms >= requestedDurationMs - 25 && derivative.duration_ms <= requestedDurationMs + 25 &&
    durationMs >= requestedDurationMs - 25 && durationMs <= requestedDurationMs && derivative.channel_rms_ratio <= 1.5 &&
    derivative.sampled_p9999_step <= Math.max(4_096, raw.sampled_p9999_step * 2.5) &&
    derivative.dropout_window_count <= raw.dropout_window_count + 2 &&
    derivative.maximum_near_zero_run_samples <= Math.max(raw.maximum_near_zero_run_samples + 2_400, 4_800);
}

const results = [];
for (const capture of captures) {
  const ordinal = capture.capture_ordinal ?? capture.sample;
  const requestedDurationMs = capture.capture_metadata.timing.requested_duration_ms;
  const diagnosticLoopbackOverride = allowCalibration &&
    variant === 'loopback-off' && capture.capture_metadata.capture_track.loopback_enabled === false;
  const workerCaptureMetadata = diagnosticLoopbackOverride
    ? structuredClone(capture.capture_metadata)
    : capture.capture_metadata;
  if (diagnosticLoopbackOverride) workerCaptureMetadata.capture_track.loopback_enabled = true;
  const derivativePath = path.join(analysisRoot, `${variant}-capture-${ordinal}-derivative.mp4`);
  const derivative = await createLocalDerivative({
    ffmpegPath, ffprobePath, mediaType: 'video', inputPath: capture.artifact_path,
    outputPath: derivativePath, captureMetadata: workerCaptureMetadata,
    requestedDurationMs,
  });
  const rawPcm = decodePcm(capture.artifact_path, capture.capture_metadata.timing.lead_in_ms, requestedDurationMs);
  const derivativePcm = decodePcm(derivativePath, 0, requestedDurationMs);
  const rawSignal = analyze(rawPcm);
  const derivativeSignal = analyze(derivativePcm);
  results.push({
    sample: capture.sample, capture_ordinal: ordinal,
    raw_checksum_sha256: capture.checksum_sha256,
    derivative_checksum_sha256: sha256(await readFile(derivativePath)),
    derivative_path: derivativePath, derivative_facts: derivative,
    requested_duration_ms: requestedDurationMs,
    captured_loopback_enabled: capture.capture_metadata.capture_track.loopback_enabled,
    diagnostic_loopback_validation_override: diagnosticLoopbackOverride,
    raw_signal: rawSignal, derivative_signal: derivativeSignal,
    passed: passes(rawSignal, derivativeSignal, derivative.output.durationMs, requestedDurationMs),
  });
}

const representativeIndex = Math.floor(captures.length / 2);
const representative = captures[representativeIndex];
const representativeResult = results[representativeIndex];
const representativeDurationMs = representative.capture_metadata.timing.requested_duration_ms;
const variantIndex = allowedVariants.indexOf(variant);
const rawIsA = variantIndex % 2 === 0;
const pairA = path.join(analysisRoot, `${variant}-blind-a.wav`);
const pairB = path.join(analysisRoot, `${variant}-blind-b.wav`);
writeWav(rawIsA ? representative.artifact_path : representativeResult.derivative_path, pairA,
  rawIsA ? representative.capture_metadata.timing.lead_in_ms : 0, representativeDurationMs);
writeWav(rawIsA ? representativeResult.derivative_path : representative.artifact_path, pairB,
  rawIsA ? 0 : representative.capture_metadata.timing.lead_in_ms, representativeDurationMs);
const mapPath = path.join(analysisRoot, 'browser-blind-map.json');
let blindMap = [];
if (existsSync(mapPath)) blindMap = JSON.parse(await readFile(mapPath, 'utf8')).listening;
blindMap = blindMap.filter((row) => row.variant !== variant);
blindMap.push({ variant, a: rawIsA ? 'raw' : 'derivative', b: rawIsA ? 'derivative' : 'raw' });
await writeFile(mapPath, `${JSON.stringify({ keep_blind_until_owner_results: true, listening: blindMap }, null, 2)}\n`, 'utf8');
const passed = results.every((row) => row.passed);
await writeFile(path.join(analysisRoot, `${variant}-results.json`),
  `${JSON.stringify({ gate: 'c6_browser_audio_variant_analysis', variant, passed, results }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  gate: 'c6_browser_audio_variant_analysis', variant, sample_count: results.length,
  calibration_mode: allowCalibration,
  bounded_duration_count: results.filter((row) =>
    row.derivative_facts.output.durationMs >= row.requested_duration_ms - 25 &&
    row.derivative_facts.output.durationMs <= row.requested_duration_ms).length,
  blind_pair_ready: true, output_root: analysisRoot, passed,
}));
if (!passed) process.exitCode = 1;
