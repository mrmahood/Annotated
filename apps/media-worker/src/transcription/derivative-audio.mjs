import { createReadStream } from 'node:fs';
import path from 'node:path';
import { mediaCoreFailure } from '../domain/media-core-error.mjs';
import { fileByteSize, hashFileSha256 } from '../media/checksum.mjs';
import { probeFile, validateDerivativeProbe } from '../media/probe.mjs';
import { runExecutable } from '../media/process.mjs';

const MAX_TRANSCRIPTION_AUDIO_BYTES = 32 * 1024 * 1024;
const privateFacts = new WeakMap();

export function buildTranscriptionAudioArguments(derivativePath, outputPath) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', derivativePath,
    '-map', '0:a:0', '-vn',
    '-c:a', 'flac', '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
    '-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact',
    '-f', 'flac',
    outputPath,
  ];
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', `${label} is invalid.`);
  }
}

export async function createDerivativeAudioInput({
  ffmpegPath,
  ffprobePath,
  mediaType,
  derivativePath,
  derivativeChecksumSha256,
  derivativeDurationMs,
  transcriptionAudioPath,
}) {
  if (path.resolve(derivativePath) === path.resolve(transcriptionAudioPath)) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Transcription audio must be a separate ephemeral file.');
  }
  assertSha256(derivativeChecksumSha256, 'Derivative checksum');
  let actualDerivativeChecksum;
  try {
    actualDerivativeChecksum = await hashFileSha256(derivativePath);
  } catch {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Final derivative is unavailable.');
  }
  if (actualDerivativeChecksum !== derivativeChecksumSha256) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Derivative checksum does not match the staged fact.');
  }
  let derivative;
  try {
    const derivativeByteSize = await fileByteSize(derivativePath);
    const derivativeProbe = await probeFile(ffprobePath, derivativePath);
    derivative = validateDerivativeProbe({
      mediaType,
      probe: derivativeProbe,
      expectedByteSize: derivativeByteSize,
      requestedDurationMs: derivativeDurationMs,
    });
  } catch {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Transcription source is not a valid final derivative.');
  }

  await runExecutable(ffmpegPath, buildTranscriptionAudioArguments(derivativePath, transcriptionAudioPath), {
    timeoutMs: 60_000,
    stage: 'transcribing',
    failureCode: 'transcription_audio_failed',
  });
  let audioByteSize;
  try {
    audioByteSize = await fileByteSize(transcriptionAudioPath);
  } catch {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Transcription audio was not created.');
  }
  if (audioByteSize < 1 || audioByteSize > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Transcription audio exceeds its byte bound.');
  }
  let audioProbe;
  try {
    audioProbe = await probeFile(ffprobePath, transcriptionAudioPath);
  } catch {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Transcription audio could not be probed.');
  }
  const audioStreams = audioProbe.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];
  const otherStreams = audioProbe.streams?.filter((stream) => stream.codec_type !== 'audio') ?? [];
  const audioDurationMs = Number(audioProbe.format?.duration) * 1000;
  if (
    !audioProbe.format?.format_name?.split(',').includes('flac') ||
    audioStreams.length !== 1 || otherStreams.length !== 0 ||
    audioStreams[0].codec_name !== 'flac' || audioStreams[0].sample_rate !== '16000' || audioStreams[0].channels !== 1 ||
    !Number.isFinite(audioDurationMs) || audioDurationMs < 1_000 || audioDurationMs > derivative.durationMs + 20
  ) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Extracted transcription audio is invalid.');
  }

  const audioChecksumSha256 = await hashFileSha256(transcriptionAudioPath);
  const token = Object.freeze({
    kind: 'derivative_audio_v1',
    durationMs: derivative.durationMs,
    byteSize: audioByteSize,
    checksumSha256: audioChecksumSha256,
    sourceDerivativeChecksumSha256: derivativeChecksumSha256,
  });
  privateFacts.set(token, Object.freeze({ filePath: transcriptionAudioPath }));
  return token;
}

export function assertDerivativeAudioInput(value) {
  if (!value || typeof value !== 'object' || !privateFacts.has(value)) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Only extracted final-derivative audio may be transcribed.');
  }
  return value;
}

export async function verifyDerivativeAudioInput(value) {
  assertDerivativeAudioInput(value);
  const facts = privateFacts.get(value);
  let currentByteSize;
  let currentChecksum;
  try {
    currentByteSize = await fileByteSize(facts.filePath);
    currentChecksum = await hashFileSha256(facts.filePath);
  } catch {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Derivative transcription audio is unavailable.');
  }
  if (currentByteSize !== value.byteSize || currentChecksum !== value.checksumSha256) {
    mediaCoreFailure('transcribing', 'transcript_input_invalid', 'Derivative transcription audio integrity changed.');
  }
  return value;
}

export function openDerivativeAudioStream(value) {
  assertDerivativeAudioInput(value);
  return createReadStream(privateFacts.get(value).filePath);
}
