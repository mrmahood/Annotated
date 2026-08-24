import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDerivativeAudioInput } from '../src/transcription/derivative-audio.mjs';
import { DeterministicFakeTranscriber } from '../src/transcription/fake-transcriber.mjs';
import { transcribeAndValidate } from '../src/transcription/transcript.mjs';
import { hashFileSha256 } from '../src/media/checksum.mjs';
import { ffmpegExecutables, generatedFixtureRoot } from './helpers/fixtures.mjs';

const tools = ffmpegExecutables();
if (!tools) throw new Error('ANNOTATED_FFMPEG_BIN must point to the verified FFmpeg bin directory.');

const c2Results = JSON.parse(await readFile(path.join(generatedFixtureRoot, 'c2', 'results.json'), 'utf8'));
const source = c2Results.find((result) => result.scenario === 'landscape-video');
if (!source) throw new Error('The C2 landscape derivative evidence is missing.');

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c3-evidence-'));
const transcriptionAudioPath = path.join(temporaryDirectory, 'transcription.flac');
let evidence;
try {
  const derivativeAudio = await createDerivativeAudioInput({
    ...tools,
    mediaType: 'video',
    derivativePath: path.join(generatedFixtureRoot, 'c2', source.output_file),
    derivativeChecksumSha256: source.output.checksumSha256,
    derivativeDurationMs: source.output.durationMs,
    transcriptionAudioPath,
  });
  const transcript = await transcribeAndValidate(new DeterministicFakeTranscriber(), derivativeAudio);
  const normalizedTranscriptJson = JSON.stringify(transcript);
  evidence = {
    schema_version: 1,
    adapter: { provider: transcript.provider, model: transcript.model, deterministic_fake: true, network_required: false },
    source_derivative: {
      file: source.output_file,
      checksum_sha256: derivativeAudio.sourceDerivativeChecksumSha256,
      duration_ms: derivativeAudio.durationMs,
    },
    ephemeral_transcription_audio: {
      codec: 'flac',
      sample_rate_hz: 16000,
      channels: 1,
      byte_size: derivativeAudio.byteSize,
      checksum_sha256: derivativeAudio.checksumSha256,
      deleted_after_run: true,
    },
    normalized_transcript: {
      checksum_sha256: createHash('sha256').update(normalizedTranscriptJson).digest('hex'),
      character_count: [...transcript.transcriptText].length,
      language: transcript.language,
      segment_count: transcript.segments?.length ?? 0,
      first_segment_start_ms: transcript.segments?.[0]?.start_ms ?? null,
      last_segment_end_ms: transcript.segments?.at(-1)?.end_ms ?? null,
      text_recorded_in_evidence: false,
    },
  };
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

try {
  await access(transcriptionAudioPath);
  throw new Error('Ephemeral transcription audio still exists after cleanup.');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const outputRoot = path.join(generatedFixtureRoot, 'c3');
await mkdir(outputRoot, { recursive: true });
const resultsPath = path.join(outputRoot, 'results.json');
await writeFile(resultsPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
const resultsChecksum = await hashFileSha256(resultsPath);
await writeFile(path.join(outputRoot, 'checksums.sha256'), `${resultsChecksum}  results.json\n`, 'ascii');
console.log(`Recorded network-free C3 evidence in ${outputRoot}`);
