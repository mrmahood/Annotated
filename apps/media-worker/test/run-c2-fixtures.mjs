import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLocalDerivative } from '../src/media/local-media-core.mjs';
import { hashFileSha256 } from '../src/media/checksum.mjs';
import { ffmpegExecutables, generatedFixtureRoot, loadMetadata } from './helpers/fixtures.mjs';

const tools = ffmpegExecutables();
if (!tools) throw new Error('ANNOTATED_FFMPEG_BIN must point to the verified FFmpeg bin directory.');

const outputRoot = path.join(generatedFixtureRoot, 'c2');
await mkdir(outputRoot, { recursive: true });
const scenarios = [
  { name: 'landscape-video', media: 'landscape-video.webm', metadata: 'safe-landscape.json', type: 'video', extension: 'mp4' },
  { name: 'portrait-video', media: 'portrait-video.webm', metadata: 'safe-portrait.json', type: 'video', extension: 'mp4' },
  { name: 'letterboxed-video', media: 'letterboxed-video.webm', metadata: 'safe-letterboxed.json', type: 'video', extension: 'mp4' },
  { name: 'audio-only', media: 'audio-only.webm', metadata: 'safe-audio.json', type: 'audio', extension: 'm4a' },
  { name: 'audio-90000', media: 'duration-90000.webm', metadata: 'safe-audio.json', type: 'audio', extension: 'm4a', durationMs: 90_000 },
];

const results = [];
for (const scenario of scenarios) {
  const outputName = `${scenario.name}.${scenario.extension}`;
  const captureMetadata = await loadMetadata(scenario.metadata);
  const requestedDurationMs = scenario.durationMs ?? 4_000;
  if (scenario.durationMs) {
    captureMetadata.timing.requested_start_ms = 0;
    captureMetadata.timing.requested_end_ms = requestedDurationMs;
    captureMetadata.timing.requested_duration_ms = requestedDurationMs;
    captureMetadata.timing.lead_in_ms = 0;
    captureMetadata.timing.recorder_elapsed_ms = requestedDurationMs;
    captureMetadata.timing.player_start_ms = 0;
    captureMetadata.timing.player_end_ms = requestedDurationMs;
  }
  const result = await createLocalDerivative({
    ...tools,
    mediaType: scenario.type,
    inputPath: path.join(generatedFixtureRoot, scenario.media),
    outputPath: path.join(outputRoot, outputName),
    captureMetadata,
    requestedDurationMs,
  });
  results.push({ scenario: scenario.name, output_file: outputName, ...result });
}

const resultsPath = path.join(outputRoot, 'results.json');
await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
const checksumNames = [...results.map((result) => result.output_file), 'results.json'].sort();
const checksumLines = [];
for (const name of checksumNames) checksumLines.push(`${await hashFileSha256(path.join(outputRoot, name))}  ${name}`);
await writeFile(path.join(outputRoot, 'checksums.sha256'), `${checksumLines.join('\n')}\n`, 'ascii');
console.log(`Generated ${results.length} C2 derivatives in ${outputRoot}`);
