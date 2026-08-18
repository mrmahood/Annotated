import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalDerivative } from '../src/media/local-media-core.mjs';
import { validateCaptureMetadataV2 } from '../src/media/capture-metadata.mjs';
import { probeFile, validateRawProbe } from '../src/media/probe.mjs';
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
