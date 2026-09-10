import assert from 'node:assert/strict';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalDerivative } from '../src/media/local-media-core.mjs';
import { validateCaptureMetadataV2 } from '../src/media/capture-metadata.mjs';
import { probeFile, validateRawProbe, DERIVATIVE_DURATION_TOLERANCE_MS } from '../src/media/probe.mjs';
import { runExecutable } from '../src/media/process.mjs';
import { ffmpegExecutables, generatedFixtureRoot, loadMetadata } from './helpers/fixtures.mjs';

const tools = ffmpegExecutables();
const integration = tools ? test : test.skip;

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c2-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function audioMetadataForDuration(durationMs) {
  const metadata = await loadMetadata('safe-audio.json');
  metadata.timing.requested_start_ms = 0;
  metadata.timing.requested_end_ms = durationMs;
  metadata.timing.requested_duration_ms = durationMs;
  metadata.timing.lead_in_ms = 0;
  metadata.timing.recorder_elapsed_ms = durationMs;
  metadata.timing.player_start_ms = 0;
  metadata.timing.player_end_ms = durationMs;
  return metadata;
}

for (const scenario of [
  { name: 'landscape', media: 'landscape-video.webm', metadata: 'safe-landscape.json', type: 'video', extension: 'mp4' },
  { name: 'VP8 landscape', media: 'vp8-landscape-video.webm', metadata: 'safe-landscape-vp8.json', type: 'video', extension: 'mp4' },
  { name: 'portrait', media: 'portrait-video.webm', metadata: 'safe-portrait.json', type: 'video', extension: 'mp4' },
  { name: 'letterboxed', media: 'letterboxed-video.webm', metadata: 'safe-letterboxed.json', type: 'video', extension: 'mp4' },
  { name: 'audio', media: 'audio-only.webm', metadata: 'safe-audio.json', type: 'audio', extension: 'm4a' },
]) {
  integration(`creates a bounded ${scenario.name} derivative`, async () => withTempDirectory(async (directory) => {
    const result = await createLocalDerivative({
      ...tools,
      mediaType: scenario.type,
      inputPath: path.join(generatedFixtureRoot, scenario.media),
      outputPath: path.join(directory, `excerpt.${scenario.extension}`),
      captureMetadata: await loadMetadata(scenario.metadata),
      requestedDurationMs: 4_000,
    });
    assert.match(result.output.checksumSha256, /^[a-f0-9]{64}$/);
    assert.ok(result.output.durationMs >= 3_900 && result.output.durationMs <= 4_000);
    if (scenario.type === 'video') {
      assert.ok(result.output.width <= 426 && result.output.height <= 240);
      assert.equal(result.output.width % 2, 0);
      assert.equal(result.output.height % 2, 0);
    } else {
      assert.equal(result.output.width, null);
      assert.equal(result.output.height, null);
    }
  }));
}

integration('malformed input fails at probe and wrong-container bytes fail validation', async () => {
  await assert.rejects(() => probeFile(tools.ffprobePath, path.join(generatedFixtureRoot, 'malformed.webm')), (error) => error.code === 'probe_failed');
  const wrong = await probeFile(tools.ffprobePath, path.join(generatedFixtureRoot, 'wrong-container.webm'));
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: wrong, expectedByteSize: Number(wrong.format.size), requestedDurationMs: 4_000, leadInMs: 0,
  }), (error) => error.code === 'invalid_container');
});

integration('packet timestamps recover duration for a live MediaRecorder-shaped WebM', async () => withTempDirectory(async (directory) => {
  const inputPath = path.join(directory, 'live.webm');
  await runExecutable(tools.ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=2.1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.1',
    '-t', '2.1', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libvpx-vp9',
    '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-f', 'webm', '-live', '1', inputPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' });
  const probe = await probeFile(tools.ffprobePath, inputPath);
  assert.equal(probe.format.duration_source, 'packet_timestamps');
  const facts = validateRawProbe({
    mediaType: 'video', probe, expectedByteSize: (await stat(inputPath)).size,
    requestedDurationMs: 2_000, leadInMs: 100,
  });
  assert.ok(facts.durationMs >= 2_000 && facts.durationMs <= 2_120);
}));

integration('packet span recovers a Spotify-shaped audio WebM whose container duration is the media-clock end', async () => withTempDirectory(async (directory) => {
  const inputPath = path.join(directory, 'spotify-clock.webm');
  await runExecutable(tools.ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=60.024',
    '-c:a', 'libopus', '-b:a', '128k', '-output_ts_offset', '300', '-f', 'webm', inputPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' });
  const container = JSON.parse((await runExecutable(tools.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', inputPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' })).stdout);
  assert.ok(Number(container.format.duration) > 300);

  const probe = await probeFile(tools.ffprobePath, inputPath);
  assert.equal(probe.format.duration_source, 'packet_timestamps');
  const facts = validateRawProbe({
    mediaType: 'audio', probe, expectedByteSize: (await stat(inputPath)).size,
    requestedDurationMs: 60_000, leadInMs: 5.5,
  });
  assert.ok(facts.durationMs >= 59_985.5 && facts.durationMs <= 62_005.5);

  const captureMetadata = await audioMetadataForDuration(60_000);
  captureMetadata.timing.requested_start_ms = 300_000;
  captureMetadata.timing.requested_end_ms = 360_000;
  captureMetadata.timing.lead_in_ms = 5.5;
  captureMetadata.timing.recorder_elapsed_ms = 60_024;
  captureMetadata.timing.player_start_ms = 300_000;
  captureMetadata.timing.player_end_ms = 360_000;
  const result = await createLocalDerivative({
    ...tools,
    mediaType: 'audio',
    inputPath,
    outputPath: path.join(directory, 'excerpt.m4a'),
    captureMetadata,
    requestedDurationMs: 60_000,
  });
  assert.ok(result.output.durationMs >= 59_900 && result.output.durationMs <= 60_100);
}));

integration('packet span recovers a 28s-offset ~77s Spotify WebM whose container duration is the media-clock end', async () => withTempDirectory(async (directory) => {
  const inputPath = path.join(directory, 'spotify-clock-77s.webm');
  await runExecutable(tools.ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=77.017',
    '-c:a', 'libopus', '-b:a', '128k', '-output_ts_offset', '28', '-f', 'webm', inputPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' });
  const container = JSON.parse((await runExecutable(tools.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration,start_time', '-of', 'json', inputPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' })).stdout);
  assert.ok(Number(container.format.duration) > 90);
  assert.ok(Number(container.format.start_time) >= 27);

  const probe = await probeFile(tools.ffprobePath, inputPath);
  assert.equal(probe.format.duration_source, 'packet_timestamps');
  const facts = validateRawProbe({
    mediaType: 'audio', probe, expectedByteSize: (await stat(inputPath)).size,
    requestedDurationMs: 77_000, leadInMs: 4.9,
  });
  assert.ok(facts.durationMs >= 76_984.9 && facts.durationMs <= 79_004.9);

  const captureMetadata = await audioMetadataForDuration(77_000);
  captureMetadata.timing.requested_start_ms = 28_000;
  captureMetadata.timing.requested_end_ms = 105_000;
  captureMetadata.timing.lead_in_ms = 4.9;
  captureMetadata.timing.recorder_elapsed_ms = 77_017;
  captureMetadata.timing.player_start_ms = 30_000;
  captureMetadata.timing.player_end_ms = 106_000;
  const result = await createLocalDerivative({
    ...tools,
    mediaType: 'audio',
    inputPath,
    outputPath: path.join(directory, 'excerpt.m4a'),
    captureMetadata,
    requestedDurationMs: 77_000,
  });
  assert.ok(result.output.durationMs >= 76_900 && result.output.durationMs <= 77_100);
}));

integration('packet span still rejects an audio WebM that is actually shorter or longer than the selected range', async () => withTempDirectory(async (directory) => {
  const shortPath = path.join(directory, 'short.webm');
  await runExecutable(tools.ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.0',
    '-c:a', 'libopus', '-f', 'webm', shortPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' });
  const shortProbe = await probeFile(tools.ffprobePath, shortPath);
  const shortSize = (await stat(shortPath)).size;
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: shortProbe, expectedByteSize: shortSize,
    requestedDurationMs: 60_000, leadInMs: 5.5,
  }), (error) => error.code === 'duration_out_of_bounds');

  const longPath = path.join(directory, 'long.webm');
  await runExecutable(tools.ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=93',
    '-c:a', 'libopus', '-f', 'webm', longPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' });
  const longProbe = await probeFile(tools.ffprobePath, longPath);
  const longSize = (await stat(longPath)).size;
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: longProbe, expectedByteSize: longSize,
    requestedDurationMs: 90_000, leadInMs: 0,
  }), (error) => error.code === 'duration_out_of_bounds');
}));

integration('real unsupported and missing-stream fixtures fail closed before transcode', async () => {
  const unsupportedAudio = await probeFile(tools.ffprobePath, path.join(generatedFixtureRoot, 'unsupported-vorbis-audio.webm'));
  assert.throws(() => validateRawProbe({
    mediaType: 'audio', probe: unsupportedAudio, expectedByteSize: Number(unsupportedAudio.format.size), requestedDurationMs: 4_000, leadInMs: 35,
  }), (error) => error.code === 'unsupported_codec');

  const missingAudio = await probeFile(tools.ffprobePath, path.join(generatedFixtureRoot, 'missing-audio.webm'));
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: missingAudio, expectedByteSize: Number(missingAudio.format.size), requestedDurationMs: 4_000, leadInMs: 0,
  }), (error) => error.code === 'missing_audio');

  const missingVideo = await probeFile(tools.ffprobePath, path.join(generatedFixtureRoot, 'audio-only.webm'));
  assert.throws(() => validateRawProbe({
    mediaType: 'video', probe: missingVideo, expectedByteSize: Number(missingVideo.format.size), requestedDurationMs: 4_000, leadInMs: 35,
  }), (error) => error.code === 'missing_video');
});

for (const metadata of [
  'unsafe-partial-visibility.json',
  'unsafe-aspect-mismatch.json',
  'unsafe-moved-end.json',
  'unsafe-resized-viewport.json',
  'unsafe-changed-dpr.json',
  'unsafe-missing-end.json',
]) {
  integration(`${metadata} creates no derivative`, async () => withTempDirectory(async (directory) => {
    const outputPath = path.join(directory, 'must-not-exist.mp4');
    const captureMetadata = await loadMetadata(metadata);
    await assert.rejects(() => createLocalDerivative({
      ...tools,
      mediaType: 'video',
      inputPath: path.join(generatedFixtureRoot, 'landscape-video.webm'),
      outputPath,
      captureMetadata,
      requestedDurationMs: 4_000,
    }), (error) => error.code === 'unsafe_geometry');
    await assert.rejects(() => access(outputPath), (error) => error.code === 'ENOENT');
  }));
}

for (const durationMs of [89_999, 90_000]) {
  integration(`creates a bounded derivative at the ${durationMs}ms audio boundary`, async () => withTempDirectory(async (directory) => {
    const result = await createLocalDerivative({
      ...tools,
      mediaType: 'audio',
      inputPath: path.join(generatedFixtureRoot, `duration-${durationMs}.webm`),
      outputPath: path.join(directory, `duration-${durationMs}.m4a`),
      captureMetadata: await audioMetadataForDuration(durationMs),
      requestedDurationMs: durationMs,
    });
    assert.ok(result.output.durationMs <= 90_000);
    assert.ok(result.output.durationMs <= durationMs + 20);
  }));
}

integration('rejects a 90001ms authoritative range before transcode', async () => {
  const metadata = await audioMetadataForDuration(90_001);
  assert.throws(() => validateCaptureMetadataV2(metadata, 'audio', 90_001), (error) => error.code === 'invalid_capture_metadata');
});

integration('transcodes a ~9.3s VP9/Opus excerpt whose AAC/video rounding exceeds the selected range by less than one frame', async () => withTempDirectory(async (directory) => {
  const requestedDurationMs = 9_295;
  const inputPath = path.join(directory, 'raw.webm');
  const captureMetadata = await loadMetadata('safe-landscape.json');
  captureMetadata.timing.requested_end_ms = captureMetadata.timing.requested_start_ms + requestedDurationMs;
  captureMetadata.timing.requested_duration_ms = requestedDurationMs;
  captureMetadata.timing.player_end_ms = captureMetadata.timing.requested_end_ms;
  captureMetadata.timing.recorder_elapsed_ms = requestedDurationMs + captureMetadata.timing.lead_in_ms + 8;
  const rawSeconds = ((requestedDurationMs + captureMetadata.timing.lead_in_ms + 8) / 1_000).toFixed(3);
  await runExecutable(tools.ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=blue:s=640x360:r=30:d=${rawSeconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${rawSeconds}`,
    '-t', rawSeconds, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', '-f', 'webm', inputPath,
  ], { stage: 'probing', failureCode: 'fixture_failed' });

  const result = await createLocalDerivative({
    ...tools,
    mediaType: 'video',
    inputPath,
    outputPath: path.join(directory, 'excerpt.mp4'),
    captureMetadata,
    requestedDurationMs,
  });
  assert.ok(result.output.durationMs >= requestedDurationMs - DERIVATIVE_DURATION_TOLERANCE_MS);
  assert.ok(result.output.durationMs <= requestedDurationMs + DERIVATIVE_DURATION_TOLERANCE_MS);
  assert.ok(result.output.durationMs <= 90_000);
  assert.equal(Number.isSafeInteger(result.output.durationMs), true);
  assert.ok(result.output.width <= 426 && result.output.height <= 240);
  assert.equal(result.output.width % 2, 0);
  assert.equal(result.output.height % 2, 0);
}));
