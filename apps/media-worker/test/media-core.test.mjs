import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validateCaptureMetadataV2 } from '../src/media/capture-metadata.mjs';
import { calculateVideoCrop } from '../src/media/geometry.mjs';
import { validateDerivativeProbe, validateRawProbe } from '../src/media/probe.mjs';
import { buildAudioTranscodeArguments, buildVideoTranscodeArguments } from '../src/media/transcode.mjs';
import { runExecutable } from '../src/media/process.mjs';
import { generatedFixtureRoot, loadMetadata } from './helpers/fixtures.mjs';

function errorCode(code) {
  return (error) => error?.code === code;
}

const probeRows = JSON.parse(await readFile(path.join(generatedFixtureRoot, 'probes.json'), 'utf8'));
const probeByName = new Map(probeRows.map((row) => [row.file, row]));

test('capture metadata v1 always requires recapture', async () => {
  const metadata = await loadMetadata('version-1-recapture.json');
  assert.throws(() => validateCaptureMetadataV2(metadata, 'video', 15_000), errorCode('recapture_required'));
  assert.throws(() => validateCaptureMetadataV2(metadata, 'audio', 15_000), errorCode('recapture_required'));
});

test('safe landscape, portrait, and letterboxed geometry produces bounded even crops', async () => {
  const landscape = calculateVideoCrop(await loadMetadata('safe-landscape.json'), 640, 360);
  assert.deepEqual(landscape, { x: 80, y: 44, width: 480, height: 272, scaleX: 0.5, scaleY: 0.5 });

  const portrait = calculateVideoCrop(await loadMetadata('safe-portrait.json'), 360, 640);
  assert.deepEqual(portrait, { x: 0, y: 20, width: 360, height: 600, scaleX: 1, scaleY: 1 });

  const letterboxed = calculateVideoCrop(await loadMetadata('safe-letterboxed.json'), 640, 360);
  assert.deepEqual(letterboxed, landscape);
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

  const wrongContainer = probeByName.get('wrong-container.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: wrongContainer, expectedByteSize: Number(wrongContainer.format.size), requestedDurationMs: 4_000, leadInMs: 0,
  }), errorCode('invalid_container'));

  const missingAudio = probeByName.get('missing-audio.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: missingAudio, expectedByteSize: Number(missingAudio.format.size), requestedDurationMs: 4_000, leadInMs: 0,
  }), errorCode('missing_audio'));
});

test('raw probe enforces the recorder overshoot ceiling', () => {
  const over = probeByName.get('duration-92001.webm').probe;
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: over, expectedByteSize: Number(over.format.size), requestedDurationMs: 90_000, leadInMs: 0,
  }), errorCode('duration_out_of_bounds'));
});

test('derivative validation rejects a probe above 90 seconds', () => {
  const probe = structuredClone(probeByName.get('wrong-container.webm').probe);
  probe.streams = [{ codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2 }];
  probe.format.duration = '90.001000';
  assert.throws(() => validateDerivativeProbe({
    mediaType: 'audio', probe, expectedByteSize: Number(probe.format.size), requestedDurationMs: 90_000,
  }), errorCode('output_invalid'));
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
