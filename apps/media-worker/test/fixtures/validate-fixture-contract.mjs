import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8'));

assert.equal(manifest.schema_version, 1);
assert.equal(manifest.provenance?.kind, 'synthetic');
assert.equal(manifest.provenance?.network_required, false);
assert.equal(manifest.provenance?.contains_personal_data, false);
assert.equal(manifest.provenance?.generator, 'generate.ps1');
assert.ok(Array.isArray(manifest.media) && manifest.media.length >= 11);
assert.ok(Array.isArray(manifest.metadata) && manifest.metadata.length >= 10);

function assertSafeRelativePath(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0);
  assert.equal(path.isAbsolute(value), false);
  assert.equal(value.split(/[\\/]/).includes('..'), false);
}

const mediaNames = new Set();
for (const fixture of manifest.media) {
  assertSafeRelativePath(fixture.file);
  assert.equal(mediaNames.has(fixture.file), false, `Duplicate media fixture: ${fixture.file}`);
  mediaNames.add(fixture.file);
  assert.equal(typeof fixture.purpose, 'string');
  assert.equal(typeof fixture.expected, 'object');
}

const requiredMedia = [
  'landscape-video.webm',
  'portrait-video.webm',
  'letterboxed-video.webm',
  'audio-only.webm',
  'missing-audio.webm',
  'malformed.webm',
  'wrong-container.webm',
  'duration-89999.webm',
  'duration-90000.webm',
  'duration-90001.webm',
  'duration-92001.webm',
];
assert.deepEqual([...mediaNames].sort(), requiredMedia.sort());

const metadataNames = new Set();
for (const fixture of manifest.metadata) {
  assertSafeRelativePath(fixture.file);
  assert.equal(metadataNames.has(fixture.file), false, `Duplicate metadata fixture: ${fixture.file}`);
  metadataNames.add(fixture.file);
  assert.ok(['accept', 'unsafe_geometry', 'recapture_required'].includes(fixture.expected));
  const document = JSON.parse(await readFile(path.join(fixtureRoot, fixture.file), 'utf8'));
  if (fixture.expected === 'recapture_required') {
    assert.equal(document.version, 1);
    continue;
  }
  if (document.base) {
    assertSafeRelativePath(document.base);
    await access(path.join(fixtureRoot, 'metadata', document.base));
    assert.equal(typeof document.override, 'object');
  } else {
    assert.equal(document.version, 2);
    assert.equal(typeof document.capture_track, 'object');
    assert.equal(typeof document.timing, 'object');
  }
}

const generatedRoot = path.join(fixtureRoot, 'generated');
let generated = true;
try {
  await access(generatedRoot);
} catch {
  generated = false;
}

if (generated) {
  for (const name of mediaNames) await access(path.join(generatedRoot, name));
  const probesPath = path.join(generatedRoot, 'probes.json');
  const checksumsPath = path.join(generatedRoot, 'checksums.sha256');
  const toolchainPath = path.join(generatedRoot, 'toolchain.json');
  await access(probesPath);
  await access(checksumsPath);
  await access(toolchainPath);

  const probes = JSON.parse(await readFile(probesPath, 'utf8'));
  assert.equal(probes.length, manifest.media.length);
  const probesByName = new Map(probes.map((probe) => [probe.file, probe]));
  assert.equal(probesByName.size, probes.length);

  for (const fixture of manifest.media) {
    const row = probesByName.get(fixture.file);
    assert.ok(row, `Missing probe evidence for ${fixture.file}`);
    if (fixture.expected.probe_failure) {
      assert.notEqual(row.probe_exit_code, 0);
      assert.equal(row.probe, null);
      continue;
    }

    assert.equal(row.probe_exit_code, 0, `Probe failed for ${fixture.file}`);
    assert.equal(typeof row.probe, 'object');
    const streams = row.probe.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    if (typeof fixture.expected.video === 'boolean') assert.equal(Boolean(video), fixture.expected.video);
    if (typeof fixture.expected.audio === 'boolean') assert.equal(Boolean(audio), fixture.expected.audio);
    if (fixture.expected.video_codec) assert.equal(video?.codec_name, fixture.expected.video_codec);
    if (fixture.expected.audio_codec) assert.equal(audio?.codec_name, fixture.expected.audio_codec);
    if (fixture.expected.width) assert.equal(video?.width, fixture.expected.width);
    if (fixture.expected.height) assert.equal(video?.height, fixture.expected.height);
    const mediaContent = await readFile(path.join(generatedRoot, fixture.file));
    assert.equal(Number(row.probe.format?.size), mediaContent.byteLength);

    const formatName = row.probe.format?.format_name;
    if (fixture.expected.container === 'webm') {
      assert.ok(formatName.split(',').includes('webm'), `Expected WebM probe for ${fixture.file}`);
    } else if (fixture.expected.container) {
      assert.equal(formatName, fixture.expected.container);
    }

    const requestedDurationMs = fixture.expected.duration_ms ?? fixture.expected.requested_duration_ms;
    if (requestedDurationMs) {
      const actualDurationMs = Number(row.probe.format?.duration) * 1000;
      const toleranceMs = fixture.expected.probe_tolerance_ms ?? 20;
      assert.ok(Number.isFinite(actualDurationMs));
      assert.ok(
        Math.abs(actualDurationMs - requestedDurationMs) <= toleranceMs,
        `${fixture.file} duration ${actualDurationMs}ms exceeded ${toleranceMs}ms tolerance`,
      );
    }
  }

  const checksumLines = (await readFile(checksumsPath, 'ascii')).trim().split(/\r?\n/);
  const expectedChecksumNames = new Set([...mediaNames, 'probes.json']);
  assert.equal(checksumLines.length, expectedChecksumNames.size);
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    assert.ok(match, `Invalid checksum evidence line: ${line}`);
    const [, expectedHash, name] = match;
    assert.ok(expectedChecksumNames.delete(name), `Unexpected or duplicate checksum: ${name}`);
    const content = await readFile(path.join(generatedRoot, name));
    const actualHash = createHash('sha256').update(content).digest('hex');
    assert.equal(actualHash, expectedHash, `Checksum mismatch for ${name}`);
  }
  assert.equal(expectedChecksumNames.size, 0);

  const toolchain = JSON.parse(await readFile(toolchainPath, 'utf8'));
  assert.equal(toolchain.schema_version, 1);
  assert.equal(toolchain.download.release_tag, 'autobuild-2026-08-16-13-00');
  assert.equal(toolchain.download.asset_sha256, '907a6bbc7aa100f5392309c5be4f527d12241121eda1c46db1c62b0054019db1');
  assert.equal(toolchain.scope.system_wide_install, false);
  assert.equal(toolchain.scope.repository_dependency, false);
  assert.equal(toolchain.scope.path_mutation, 'generator-process-only');

  const c2Root = path.join(generatedRoot, 'c2');
  let c2Generated = true;
  try {
    await access(c2Root);
  } catch {
    c2Generated = false;
  }
  if (c2Generated) {
    const resultsPath = path.join(c2Root, 'results.json');
    const c2Results = JSON.parse(await readFile(resultsPath, 'utf8'));
    const expectedOutputs = new Set([
      'landscape-video.mp4',
      'portrait-video.mp4',
      'letterboxed-video.mp4',
      'audio-only.m4a',
      'audio-90000.m4a',
    ]);
    assert.equal(c2Results.length, expectedOutputs.size);
    for (const result of c2Results) {
      assert.ok(expectedOutputs.delete(result.output_file), `Unexpected or duplicate C2 output: ${result.output_file}`);
      const outputContent = await readFile(path.join(c2Root, result.output_file));
      assert.equal(result.output.byteSize, outputContent.byteLength);
      assert.equal(createHash('sha256').update(outputContent).digest('hex'), result.output.checksumSha256);
      assert.ok(result.output.durationMs >= 1_000 && result.output.durationMs <= 90_000);
      const outputStreams = result.output.probe.streams;
      const outputVideo = outputStreams.find((stream) => stream.codec_type === 'video');
      const outputAudio = outputStreams.find((stream) => stream.codec_type === 'audio');
      assert.equal(outputAudio?.codec_name, 'aac');
      assert.equal(outputAudio?.profile, 'LC');
      assert.equal(outputAudio?.sample_rate, '48000');
      assert.ok(outputAudio?.channels >= 1 && outputAudio?.channels <= 2);
      if (result.output_file.endsWith('.mp4')) {
        assert.equal(outputVideo?.codec_name, 'h264');
        assert.equal(outputVideo?.profile, 'Main');
        assert.equal(outputVideo?.pix_fmt, 'yuv420p');
        assert.ok(outputVideo.width <= 426 && outputVideo.height <= 240);
        assert.equal(outputVideo.width % 2, 0);
        assert.equal(outputVideo.height % 2, 0);
      } else {
        assert.equal(outputVideo, undefined);
      }
    }
    assert.equal(expectedOutputs.size, 0);

    const c2ChecksumLines = (await readFile(path.join(c2Root, 'checksums.sha256'), 'ascii')).trim().split(/\r?\n/);
    const expectedC2ChecksumNames = new Set([...c2Results.map((result) => result.output_file), 'results.json']);
    assert.equal(c2ChecksumLines.length, expectedC2ChecksumNames.size);
    for (const line of c2ChecksumLines) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
      assert.ok(match, `Invalid C2 checksum evidence line: ${line}`);
      const [, expectedHash, name] = match;
      assert.ok(expectedC2ChecksumNames.delete(name), `Unexpected or duplicate C2 checksum: ${name}`);
      const content = await readFile(path.join(c2Root, name));
      assert.equal(createHash('sha256').update(content).digest('hex'), expectedHash, `C2 checksum mismatch for ${name}`);
    }
    assert.equal(expectedC2ChecksumNames.size, 0);
  }

  const c3Root = path.join(generatedRoot, 'c3');
  let c3Generated = true;
  try {
    await access(c3Root);
  } catch {
    c3Generated = false;
  }
  if (c3Generated) {
    const c3ResultsPath = path.join(c3Root, 'results.json');
    const c3Results = JSON.parse(await readFile(c3ResultsPath, 'utf8'));
    assert.equal(c3Results.schema_version, 1);
    assert.equal(c3Results.adapter.provider, 'deterministic-fake');
    assert.equal(c3Results.adapter.model, 'fixture-v1');
    assert.equal(c3Results.adapter.deterministic_fake, true);
    assert.equal(c3Results.adapter.network_required, false);
    assert.equal(c3Results.source_derivative.file, 'landscape-video.mp4');
    const c2Landscape = JSON.parse(await readFile(path.join(generatedRoot, 'c2', 'results.json'), 'utf8'))
      .find((result) => result.scenario === 'landscape-video');
    assert.equal(c3Results.source_derivative.checksum_sha256, c2Landscape.output.checksumSha256);
    assert.equal(c3Results.source_derivative.duration_ms, c2Landscape.output.durationMs);
    assert.equal(c3Results.ephemeral_transcription_audio.codec, 'flac');
    assert.equal(c3Results.ephemeral_transcription_audio.sample_rate_hz, 16000);
    assert.equal(c3Results.ephemeral_transcription_audio.channels, 1);
    assert.ok(c3Results.ephemeral_transcription_audio.byte_size > 0);
    assert.match(c3Results.ephemeral_transcription_audio.checksum_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(c3Results.ephemeral_transcription_audio.deleted_after_run, true);
    assert.match(c3Results.normalized_transcript.checksum_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(c3Results.normalized_transcript.segment_count, 2);
    assert.equal(c3Results.normalized_transcript.first_segment_start_ms, 0);
    assert.ok(c3Results.normalized_transcript.last_segment_end_ms <= c3Results.source_derivative.duration_ms);
    assert.equal(c3Results.normalized_transcript.text_recorded_in_evidence, false);
    assert.equal(Object.hasOwn(c3Results.normalized_transcript, 'text'), false);
    const c3Files = new Set(['results.json', 'checksums.sha256']);
    for (const name of c3Files) await access(path.join(c3Root, name));
    const c3ChecksumLine = (await readFile(path.join(c3Root, 'checksums.sha256'), 'ascii')).trim();
    const c3ChecksumMatch = /^([a-f0-9]{64})  results[.]json$/u.exec(c3ChecksumLine);
    assert.ok(c3ChecksumMatch, 'Invalid C3 checksum evidence line.');
    const c3ResultsContent = await readFile(c3ResultsPath);
    assert.equal(createHash('sha256').update(c3ResultsContent).digest('hex'), c3ChecksumMatch[1]);
  }
}

console.log(`Fixture contract valid; generated binaries ${generated ? 'present' : 'pending approved FFmpeg setup'}.`);
