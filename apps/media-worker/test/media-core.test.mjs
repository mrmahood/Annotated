import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validateCaptureMetadataV2 } from '../src/media/capture-metadata.mjs';
import { calculateVideoCrop } from '../src/media/geometry.mjs';
import {
  DERIVATIVE_DURATION_TOLERANCE_MS,
  RAW_ABSOLUTE_MAX_DURATION_MS,
  WEBM_DURATION_DISAGREEMENT_MS,
  inferNaOpusContentMs,
  inferPacketTimelineEndSeconds,
  inferPacketTimelineOriginSeconds,
  packetDurationMs,
  selectWebmDurationMs,
  validateDerivativeProbe,
  validateRawProbe,
} from '../src/media/probe.mjs';
import { persistDerivativeDurationMs, requireBoundedInteger } from '../src/runtime/validation.mjs';
import { buildAudioTranscodeArguments, buildVideoTranscodeArguments } from '../src/media/transcode.mjs';
import { runExecutable } from '../src/media/process.mjs';
import { generatedFixtureRoot, loadMetadata } from './helpers/fixtures.mjs';

function errorCode(code, reason) {
  return (error) => error?.code === code && (reason === undefined || error?.reason === reason);
}

function derivativeAudioProbe(durationSeconds) {
  const probe = structuredClone(probeByName.get('wrong-container.webm').probe);
  probe.streams = [{ codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2 }];
  probe.format.duration = durationSeconds;
  return probe;
}

function derivativeVideoProbe(durationSeconds, overrides = {}) {
  const probe = structuredClone(probeByName.get('wrong-container.webm').probe);
  probe.streams = [
    {
      codec_type: 'video', codec_name: 'h264', profile: 'Main', pix_fmt: 'yuv420p',
      width: 426, height: 240, ...overrides.video,
    },
    { codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2, ...overrides.audio },
  ];
  probe.format.duration = durationSeconds;
  return probe;
}

const probesContent = await readFile(path.join(generatedFixtureRoot, 'probes.json'));
const probeRows = JSON.parse(probesContent.toString('utf8'));
const probeByName = new Map(probeRows.map((row) => [row.file, row]));
const fixtureChecksums = await readFile(path.join(generatedFixtureRoot, 'checksums.sha256'), 'ascii');
const c2ResultsContent = await readFile(path.join(generatedFixtureRoot, 'c2', 'results.json'));
const c2Results = JSON.parse(c2ResultsContent.toString('utf8'));
const c2Checksums = await readFile(path.join(generatedFixtureRoot, 'c2', 'checksums.sha256'), 'ascii');

test('capture metadata v1 always requires recapture', async () => {
  const metadata = await loadMetadata('version-1-recapture.json');
  assert.throws(() => validateCaptureMetadataV2(metadata, 'video', 15_000), errorCode('recapture_required'));
  assert.throws(() => validateCaptureMetadataV2(metadata, 'audio', 15_000), errorCode('recapture_required'));
});

test('safe landscape, portrait, and letterboxed geometry produces bounded even crops', async () => {
  const landscape = calculateVideoCrop(await loadMetadata('safe-landscape.json'), 640, 360);
  assert.deepEqual(landscape, { x: 80, y: 44, width: 480, height: 272, scaleX: 0.5, scaleY: 0.5, offsetX: 0, offsetY: 0 });

  const portrait = calculateVideoCrop(await loadMetadata('safe-portrait.json'), 360, 640);
  assert.deepEqual(portrait, { x: 0, y: 20, width: 360, height: 600, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });

  const letterboxed = calculateVideoCrop(await loadMetadata('safe-letterboxed.json'), 640, 360);
  assert.deepEqual(letterboxed, landscape);
});

test('committed fixture evidence retains complete crop mapping and matching checksums', () => {
  const expectedVideoScenarios = new Set([
    'landscape-video',
    'vp8-landscape-video',
    'portrait-video',
    'letterboxed-video',
  ]);
  for (const result of c2Results) {
    if (!expectedVideoScenarios.delete(result.scenario)) continue;
    assert.deepEqual(Object.keys(result.crop).sort(), [
      'height', 'offsetX', 'offsetY', 'scaleX', 'scaleY', 'width', 'x', 'y',
    ]);
    assert.equal(Number.isFinite(result.crop.offsetX), true);
    assert.equal(Number.isFinite(result.crop.offsetY), true);
  }
  assert.equal(expectedVideoScenarios.size, 0);

  const resultsHash = createHash('sha256').update(c2ResultsContent).digest('hex');
  assert.match(c2Checksums, new RegExp(`^${resultsHash}  results[.]json$`, 'mu'));
  const probesHash = createHash('sha256').update(probesContent).digest('hex');
  assert.match(fixtureChecksums, new RegExp(`^${probesHash}  probes[.]json$`, 'mu'));
});

test('geometry accepts only the documented one-CSS-pixel edge and movement tolerance', async () => {
  const edge = await loadMetadata('safe-landscape.json');
  edge.video_element.start.x = -1;
  edge.video_element.start.left = -1;
  edge.video_element.start.right = 959;
  edge.video_element.end = structuredClone(edge.video_element.start);
  assert.deepEqual(calculateVideoCrop(edge, 640, 360), {
    x: 0, y: 44, width: 480, height: 272, scaleX: 0.5, scaleY: 0.5, offsetX: 0, offsetY: 0,
  });

  const moved = await loadMetadata('safe-landscape.json');
  for (const key of ['x', 'left', 'right']) moved.video_element.end[key] += 1;
  assert.deepEqual(calculateVideoCrop(moved, 640, 360), {
    x: 80, y: 44, width: 480, height: 272, scaleX: 0.5, scaleY: 0.5, offsetX: 0, offsetY: 0,
  });

  const movedTooFar = await loadMetadata('safe-landscape.json');
  for (const key of ['x', 'left', 'right']) movedTooFar.video_element.end[key] += 1.01;
  assert.throws(() => calculateVideoCrop(movedTooFar, 640, 360), errorCode('unsafe_geometry'));
});

test('Chrome crop-and-scale letterboxing maps a narrow viewport into the encoded track surface', async () => {
  const metadata = await loadMetadata('safe-landscape.json');
  metadata.viewport.start = { width: 543, height: 909, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 };
  metadata.viewport.end = structuredClone(metadata.viewport.start);
  metadata.video_element.start = {
    x: 0, y: 60, width: 528, height: 297,
    top: 60, right: 528, bottom: 357, left: 0,
  };
  metadata.video_element.end = structuredClone(metadata.video_element.start);
  const track = metadata.capture_track.tracks.find((item) => item.kind === 'video');
  track.settings = { width: 1922, height: 1200, frameRate: 30, resizeMode: 'crop-and-scale' };
  const crop = calculateVideoCrop(metadata, 1922, 1200);
  assert.deepEqual({ x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    { x: 602, y: 78, width: 698, height: 394 });
  assert.equal(crop.scaleX, crop.scaleY);
  assert.ok(crop.offsetX > 600 && crop.offsetX < 603);
  assert.equal(crop.offsetY, 0);

  track.settings.resizeMode = 'none';
  assert.throws(() => calculateVideoCrop(metadata, 1922, 1200), errorCode('unsafe_geometry'));
});

test('geometry requires stable fullscreen state and capture-track aspect', async () => {
  const stableFullscreen = await loadMetadata('safe-landscape.json');
  stableFullscreen.fullscreen = { start: true, end: true };
  assert.equal(calculateVideoCrop(stableFullscreen, 640, 360).width, 480);

  const changedFullscreen = await loadMetadata('safe-landscape.json');
  changedFullscreen.fullscreen.end = true;
  assert.throws(() => calculateVideoCrop(changedFullscreen, 640, 360), errorCode('unsafe_geometry'));

  const mismatchedTrack = await loadMetadata('safe-landscape.json');
  const videoTrack = mismatchedTrack.capture_track.tracks.find((track) => track.kind === 'video');
  videoTrack.settings.height = 800;
  assert.throws(() => calculateVideoCrop(mismatchedTrack, 640, 360), errorCode('unsafe_geometry'));
});

test('geometry rejects inconsistent rectangle edges and nonfinite values', async () => {
  const inconsistent = await loadMetadata('safe-landscape.json');
  inconsistent.video_element.start.right += 2;
  inconsistent.video_element.end.right += 2;
  assert.throws(() => calculateVideoCrop(inconsistent, 640, 360), errorCode('unsafe_geometry'));

  const nonfinite = await loadMetadata('safe-landscape.json');
  nonfinite.video_element.start.x = Number.NaN;
  nonfinite.video_element.end.x = Number.NaN;
  assert.throws(() => calculateVideoCrop(nonfinite, 640, 360), errorCode('unsafe_geometry'));
});

for (const fixture of [
  'unsafe-partial-visibility.json',
  'unsafe-aspect-mismatch.json',
  'unsafe-moved-end.json',
  'unsafe-resized-viewport.json',
  'unsafe-changed-dpr.json',
  'unsafe-missing-end.json',
]) {
  test(`${fixture} fails closed`, async () => {
    const metadata = await loadMetadata(fixture);
    assert.throws(() => calculateVideoCrop(metadata, 640, 360), errorCode('unsafe_geometry'));
  });
}

test('raw probe validation trusts container and streams rather than filename', () => {
  const landscape = probeByName.get('landscape-video.webm').probe;
  const facts = validateRawProbe({
    mediaType: 'video', probe: landscape, expectedByteSize: Number(landscape.format.size), requestedDurationMs: 4_000, leadInMs: 40,
  });
  assert.equal(facts.video.codec_name, 'vp9');
  assert.equal(facts.audio.codec_name, 'opus');

  const vp8 = probeByName.get('vp8-landscape-video.webm').probe;
  const vp8Facts = validateRawProbe({
    mediaType: 'video', probe: vp8, expectedByteSize: Number(vp8.format.size), requestedDurationMs: 4_000, leadInMs: 40,
  });
  assert.equal(vp8Facts.video.codec_name, 'vp8');
  assert.equal(vp8Facts.audio.codec_name, 'opus');

  const wrongContainer = probeByName.get('wrong-container.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: wrongContainer, expectedByteSize: Number(wrongContainer.format.size), requestedDurationMs: 4_000, leadInMs: 0,
  }), errorCode('invalid_container'));

  const missingAudio = probeByName.get('missing-audio.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: missingAudio, expectedByteSize: Number(missingAudio.format.size), requestedDurationMs: 4_000, leadInMs: 0,
  }), errorCode('missing_audio'));

  const unsupportedAudio = probeByName.get('unsupported-vorbis-audio.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: unsupportedAudio, expectedByteSize: Number(unsupportedAudio.format.size), requestedDurationMs: 4_000, leadInMs: 35,
  }), errorCode('unsupported_codec'));
});

test('raw probe enforces the recorder overshoot ceiling', () => {
  const over = probeByName.get('duration-92001.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: over, expectedByteSize: Number(over.format.size), requestedDurationMs: 90_000, leadInMs: 0,
  }), errorCode('duration_out_of_bounds'));
});

test('raw probe rejects input truncated before the selected range ends', () => {
  const truncated = structuredClone(probeByName.get('landscape-video.webm').probe);
  truncated.format.duration = '1.000000';
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: truncated, expectedByteSize: Number(truncated.format.size), requestedDurationMs: 4_000, leadInMs: 40,
  }), errorCode('duration_out_of_bounds'));
});

test('packet timestamps provide a bounded MediaRecorder WebM duration fallback', () => {
  assert.equal(packetDurationMs('0.000000,N/A\n89.976000,0.016000\n'), 89_992);
  assert.equal(packetDurationMs('-0.007000,0.020000,\n2.000000,0.020000\n'), 2_020);
  assert.equal(packetDurationMs('299.993000,0.020000\n360.014000,0.020000\n'), 60_041);
  assert.equal(packetDurationMs('27.993000,0.020000\n105.014000,0.020000\n'), 77_041);
  assert.throws(() => packetDurationMs('0.000000,N/A'), errorCode('probe_failed'));
  assert.throws(() => packetDurationMs('0.000000,3.000000\n'), errorCode('probe_failed'));
  assert.throws(() => packetDurationMs('not-a-time,N/A\n'), errorCode('probe_failed'));
});

test('packet origin skips a near-zero priming packet before a media-clock cluster', () => {
  assert.equal(inferPacketTimelineOriginSeconds([0, 28, 28.02, 105]), 28);
  assert.equal(inferPacketTimelineOriginSeconds([27.993, 28.014, 105.014]), 27.993);
  assert.equal(inferPacketTimelineOriginSeconds([0, 0.02, 0.04, 77.017]), 0);
  assert.equal(inferPacketTimelineOriginSeconds([299.993, 360.014]), 299.993);
  assert.equal(
    packetDurationMs('0.000000,0.020000\n28.000000,0.020000\n105.000000,0.020000\n'),
    77_020,
  );
});

test('N/A recorder-clock packets without a media-clock tail already recover 77s on main', () => {
  const lines = [];
  for (let index = 0; index <= 3_850; index += 1) lines.push(`${(index * 0.02).toFixed(6)},N/A`);
  const durationMs = packetDurationMs(`${lines.join('\n')}\n`);
  assert.ok(durationMs >= 76_984.9 && durationMs <= 79_004.9);
  assert.deepEqual(selectWebmDurationMs(105_025, durationMs), {
    durationMs, source: 'packet_timestamps',
  });
});

test('Chrome MediaRecorder N/A packets on the recorder clock drop a 105s media-clock tail', () => {
  const lines = [];
  for (let index = 0; index <= 3_850; index += 1) lines.push(`${(index * 0.02).toFixed(6)},N/A`);
  lines.push('105.000000,N/A');
  const durationMs = packetDurationMs(`${lines.join('\n')}\n`);
  assert.ok(durationMs >= 76_984.9 && durationMs <= 79_004.9);
  assert.deepEqual(selectWebmDurationMs(105_025, durationMs), {
    durationMs, source: 'packet_timestamps',
  });

  const audio = structuredClone(probeByName.get('audio-only.webm').probe);
  audio.format.duration = (durationMs / 1_000).toFixed(6);
  const facts = validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 77_000, leadInMs: 4.9,
  });
  assert.ok(facts.durationMs >= 76_984.9 && facts.durationMs <= 79_004.9);

  assert.equal(inferPacketTimelineEndSeconds([
    { pts: 0, duration: 0 },
    { pts: 0.02, duration: 0 },
    { pts: 77, duration: 0 },
    { pts: 105, duration: 0 },
  ], 0), 77);
});

test('encoded packet content wins when media-clock span is a second short of the recorder run', () => {
  const packetCount = 3_850;
  const lines = [];
  for (let index = 0; index < packetCount; index += 1) {
    const pts = 30 + (index / (packetCount - 1)) * 76;
    lines.push(`${pts.toFixed(6)},0.020000`);
  }
  const durationMs = packetDurationMs(`${lines.join('\n')}\n`);
  assert.ok(Math.abs(durationMs - packetCount * 20) < 0.01);
  assert.ok(durationMs >= 76_900 && durationMs <= 77_100);
});

test('Chrome N/A priming packet plus 1s-quantized playhead recovers 77s encoded content', () => {
  const packetCount = 3_850;
  const lines = ['0.000000,N/A', '0.020000,N/A', '0.040000,N/A'];
  for (let index = 0; index < packetCount; index += 1) {
    const pts = 30 + (index / (packetCount - 1)) * 76;
    lines.push(`${pts.toFixed(6)},N/A`);
  }
  assert.equal(inferPacketTimelineOriginSeconds(lines.map((line) => Number(line.split(',')[0]))), 30);
  const durationMs = packetDurationMs(`${lines.join('\n')}\n`);
  assert.ok(durationMs >= 76_984.9 && durationMs <= 79_004.9);
  assert.deepEqual(selectWebmDurationMs(106_000, durationMs), {
    durationMs, source: 'packet_timestamps',
  });

  const audio = structuredClone(probeByName.get('audio-only.webm').probe);
  audio.format.duration = (durationMs / 1_000).toFixed(6);
  const facts = validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 77_000, leadInMs: 4.9,
  });
  assert.ok(facts.durationMs >= 76_984.9 && facts.durationMs <= 79_004.9);
  assert.equal(inferNaOpusContentMs(Array.from({ length: packetCount }, (_, index) => ({
    pts: 30 + (index / (packetCount - 1)) * 76,
    duration: 0,
  }))), packetCount * 20);
});

test('N/A packets that really encode 76s stay a 76s span and still fail the 77s raw gate', () => {
  const packetCount = 3_801;
  const lines = [];
  for (let index = 0; index < packetCount; index += 1) {
    lines.push(`${(30 + index * 0.02).toFixed(6)},N/A`);
  }
  const durationMs = packetDurationMs(`${lines.join('\n')}\n`);
  assert.ok(durationMs >= 75_900 && durationMs <= 76_100);
  const audio = structuredClone(probeByName.get('audio-only.webm').probe);
  audio.format.duration = (durationMs / 1_000).toFixed(6);
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 77_000, leadInMs: 4.9,
  }), errorCode('duration_out_of_bounds'));
});

test('WebM container duration yields to packet span when they disagree by more than two seconds', () => {
  assert.equal(WEBM_DURATION_DISAGREEMENT_MS, 2_000);
  assert.equal(RAW_ABSOLUTE_MAX_DURATION_MS, 92_000);
  assert.deepEqual(selectWebmDurationMs(360_032, 60_041), {
    durationMs: 60_041, source: 'packet_timestamps',
  });
  assert.deepEqual(selectWebmDurationMs(105_025, 77_041), {
    durationMs: 77_041, source: 'packet_timestamps',
  });
  assert.deepEqual(selectWebmDurationMs(1_008, 60_041), {
    durationMs: 60_041, source: 'packet_timestamps',
  });
  assert.deepEqual(selectWebmDurationMs(Number.NaN, 60_041), {
    durationMs: 60_041, source: 'packet_timestamps',
  });
  assert.deepEqual(selectWebmDurationMs(60_032, 60_041), {
    durationMs: 60_032, source: 'container',
  });
  assert.deepEqual(selectWebmDurationMs(105_025, 105_000), {
    durationMs: 105_025, source: 'container',
  });
  assert.deepEqual(selectWebmDurationMs(93_500, 91_800), {
    durationMs: 91_800, source: 'packet_timestamps',
  });
  assert.throws(() => selectWebmDurationMs(60_032, 0), errorCode('probe_failed'));
});

test('raw probe still rejects a real undershoot and a last-timestamp overshoot', () => {
  const audio = structuredClone(probeByName.get('audio-only.webm').probe);
  audio.format.duration = '1.000000';
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 60_000, leadInMs: 5.5,
  }), errorCode('duration_out_of_bounds'));

  audio.format.duration = '360.032000';
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 60_000, leadInMs: 5.5,
  }), errorCode('duration_out_of_bounds'));

  audio.format.duration = '60.024000';
  const facts = validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 60_000, leadInMs: 5.5,
  });
  assert.equal(facts.durationMs, 60_024);

  audio.format.duration = '77.041000';
  const nearCeiling = validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 77_000, leadInMs: 4.9,
  });
  assert.equal(nearCeiling.durationMs, 77_041);

  audio.format.duration = '105.025000';
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: audio, expectedByteSize: Number(audio.format.size),
    requestedDurationMs: 77_000, leadInMs: 4.9,
  }), errorCode('duration_out_of_bounds'));
});

test('derivative validation rejects a probe above 90 seconds', () => {
  const probe = derivativeAudioProbe('90.001000');
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 90_000,
  }), errorCode('output_invalid', 'duration_exceeds_max'));
});

test('inspect-stage boundary persists a precise probe duration as a whole millisecond', () => {
  const probe = derivativeAudioProbe('9.299675');
  const facts = validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 9_295,
  });
  assert.equal(facts.durationMs, Number('9.299675') * 1_000);
  assert.equal(Number.isSafeInteger(facts.durationMs), false);
  assert.throws(
    () => requireBoundedInteger(facts.durationMs, 'Derivative duration', 1_000, 90_000),
    (error) => error instanceof TypeError && /integer between 1000 and 90000/u.test(error.message),
  );
  assert.equal(persistDerivativeDurationMs(facts.durationMs), 9_300);
  assert.equal(Number.isSafeInteger(persistDerivativeDurationMs(facts.durationMs)), true);
  assert.throws(
    () => requireBoundedInteger(9_300.7, 'Derivative duration', 1_000, 90_000),
    (error) => error instanceof TypeError && /integer between 1000 and 90000/u.test(error.message),
  );
  assert.throws(
    () => persistDerivativeDurationMs(90_001),
    (error) => error instanceof TypeError && /integer between 1000 and 90000/u.test(error.message),
  );
});

test('derivative validation admits 100 ms of tab-capture duration slack past the selected range', () => {
  assert.equal(DERIVATIVE_DURATION_TOLERANCE_MS, 100);
  const probe = derivativeAudioProbe('4.000000');
  for (const duration of ['4.001000', '4.022000', '4.050000', '4.100000']) {
    probe.format.duration = duration;
    const facts = validateDerivativeProbe({
      mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 4_000,
    });
    assert.ok(facts.durationMs > 4_000);
    assert.ok(facts.durationMs - 4_000 <= DERIVATIVE_DURATION_TOLERANCE_MS + 0.001);
  }

  probe.format.duration = '4.000000';
  assert.equal(validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 4_000,
  }).durationMs, 4_000);
});

test('derivative validation rejects duration clearly beyond 100 ms of slack', () => {
  const probe = derivativeAudioProbe('4.101000');
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 4_000,
  }), errorCode('output_invalid', 'duration_overshoot'));
});

test('derivative validation admits 100 ms slack on ~18s and near-90s selections', () => {
  const probe = derivativeAudioProbe('17.856000');
  assert.equal(validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 17_806,
  }).durationMs, 17_856);
  probe.format.duration = '17.906000';
  assert.equal(validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 17_806,
  }).durationMs, 17_906);
  probe.format.duration = '17.907000';
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 17_806,
  }), errorCode('output_invalid', 'duration_overshoot'));
  probe.format.duration = '19.806000';
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 17_806,
  }), errorCode('output_invalid', 'duration_overshoot'));

  probe.format.duration = '89.970000';
  assert.equal(validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 89_920,
  }).durationMs, 89_970);
  probe.format.duration = '90.000000';
  assert.equal(validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 89_920,
  }).durationMs, 90_000);
  probe.format.duration = '90.001000';
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 89_920,
  }), errorCode('output_invalid', 'duration_exceeds_max'));
});

test('derivative validation rejects a one-second result for a 90-second selection', () => {
  const probe = derivativeAudioProbe('1.000000');
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 90_000,
  }), errorCode('output_invalid', 'duration_undershoot'));

  probe.format.duration = '89.980000';
  assert.equal(validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 90_000,
  }).durationMs, 89_980);
});

test('derivative validation keeps codec and geometry fail-closed', () => {
  const baseline = derivativeVideoProbe('4.000000', { video: { profile: 'Constrained Baseline' } });
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'video', probe: baseline, expectedByteSize: Number(baseline.format.size), requestedDurationMs: 4_000,
  }), errorCode('output_invalid', 'invalid_video_codec'));

  const oddWidth = derivativeVideoProbe('4.000000', { video: { width: 425 } });
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'video', probe: oddWidth, expectedByteSize: Number(oddWidth.format.size), requestedDurationMs: 4_000,
  }), errorCode('output_invalid', 'invalid_dimensions'));

  const tooTall = derivativeVideoProbe('4.000000', { video: { height: 242 } });
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'video', probe: tooTall, expectedByteSize: Number(tooTall.format.size), requestedDurationMs: 4_000,
  }), errorCode('output_invalid', 'invalid_dimensions'));

  const upscaled = derivativeVideoProbe('4.000000', { video: { width: 426, height: 240 } });
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'video',
    probe: upscaled,
    expectedByteSize: Number(upscaled.format.size),
    requestedDurationMs: 4_000,
    crop: { width: 400, height: 240 },
  }), errorCode('output_invalid', 'upscaled'));

  const vorbis = derivativeAudioProbe('4.000000');
  vorbis.streams[0].codec_name = 'vorbis';
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe: vorbis, expectedByteSize: Number(vorbis.format.size), requestedDurationMs: 4_000,
  }), errorCode('output_invalid', 'invalid_audio_codec'));
});

test('transcode argument builders fix codecs, maps, bounds, and output paths', () => {
  const video = buildVideoTranscodeArguments({
    inputPath: 'raw.webm', outputPath: 'excerpt.mp4', leadInMs: 40, requestedDurationMs: 4_000,
    crop: { x: 80, y: 44, width: 480, height: 272 },
  });
  assert.deepEqual(video.slice(-2), ['mp4', 'excerpt.mp4']);
  assert.ok(video.includes('libopenh264'));
  assert.ok(video.includes('aac'));
  assert.ok(video.includes('crop=480:272:80:44,scale=w=\'min(426,iw)\':h=\'min(240,ih)\':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p'));
  assert.equal(video[video.indexOf('-ss') + 1], '0.040');
  assert.equal(video[video.indexOf('-t') + 1], '4.000');

  const audio = buildAudioTranscodeArguments({
    inputPath: 'raw.webm', outputPath: 'excerpt.m4a', leadInMs: 35, requestedDurationMs: 4_000,
  });
  assert.ok(audio.includes('-vn'));
  assert.ok(audio.includes('96k'));
  assert.deepEqual(audio.slice(-2), ['mp4', 'excerpt.m4a']);
});

test('media executable timeout returns a stable bounded failure', async () => {
  await assert.rejects(
    () => runExecutable(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 25, failureCode: 'transcode_failed' }),
    errorCode('transcode_timeout'),
  );
});

test('unsupported computed style fails geometry closed', async () => {
  const metadata = await loadMetadata('safe-landscape.json');
  metadata.computed_style.object_fit = 'mystery-fit';
  assert.throws(() => calculateVideoCrop(metadata, 640, 360), errorCode('unsafe_geometry'));
});
