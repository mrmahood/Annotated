import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDerivativeAudioInput } from '../src/transcription/derivative-audio.mjs';
import { OpenAIWhisperTranscriber } from '../src/transcription/openai-whisper-transcriber.mjs';
import { transcribeAndValidate } from '../src/transcription/transcript.mjs';
import { ffmpegExecutables } from './helpers/fixtures.mjs';

function required(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} is unavailable.`);
  return value;
}

function responseStructure(value) {
  const segments = Array.isArray(value?.segments) ? value.segments : [];
  let previousEnd = 0;
  let maximumOverlapMs = 0;
  for (const segment of segments) {
    const startMs = Number(segment?.start) * 1_000;
    const endMs = Number(segment?.end) * 1_000;
    if (Number.isFinite(startMs)) maximumOverlapMs = Math.max(maximumOverlapMs, previousEnd - startMs);
    if (Number.isFinite(endMs)) previousEnd = endMs;
  }
  return {
    response_text_nonblank: typeof value?.text === 'string' && value.text.trim().length > 0,
    language_type: typeof value?.language,
    segment_count: segments.length,
    segment_keys_valid: segments.every((segment) => {
      const keys = Object.keys(segment ?? {});
      return keys.includes('start') && keys.includes('end') && keys.includes('text');
    }),
    blank_segment_count: segments.filter((segment) => typeof segment?.text !== 'string' || !segment.text.trim()).length,
    first_start_ms: segments.length ? Math.round(Number(segments[0]?.start) * 1_000) : null,
    last_end_ms: segments.length ? Math.round(Number(segments.at(-1)?.end) * 1_000) : null,
    maximum_overlap_ms: Math.max(0, Math.round(maximumOverlapMs)),
  };
}

async function main() {
  if (process.env.ANNOTATED_C6_STAGING_DIAGNOSTIC !== '1') throw new Error('Diagnostic is not enabled.');
  const apiKey = required(process.env.OPENAI_API_KEY, 'OpenAI key');
  const derivativePath = path.resolve(required(process.env.ANNOTATED_C6_DERIVATIVE_PATH, 'Derivative path'));
  const checksum = required(process.env.ANNOTATED_C6_DERIVATIVE_SHA256, 'Derivative checksum');
  const durationMs = Number(process.env.ANNOTATED_C6_DERIVATIVE_DURATION_MS);
  const mediaType = process.env.ANNOTATED_C6_DERIVATIVE_MEDIA_TYPE ?? 'audio';
  if (!['video', 'audio'].includes(mediaType)) throw new TypeError('Derivative media type is invalid.');
  const tools = ffmpegExecutables();
  if (!tools) throw new Error('Verified FFmpeg is unavailable.');
  await Promise.all([access(derivativePath), access(tools.ffmpegPath), access(tools.ffprobePath)]);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c6-structure-'));
  let diagnostic = {};
  let httpStatus = null;
  try {
    const input = await createDerivativeAudioInput({
      ...tools,
      mediaType,
      derivativePath,
      derivativeChecksumSha256: checksum,
      derivativeDurationMs: durationMs,
      transcriptionAudioPath: path.join(directory, 'transcription.flac'),
    });
    const fetchImpl = async (...args) => {
      const response = await fetch(...args);
      httpStatus = response.status;
      if (response.ok) diagnostic = responseStructure(JSON.parse(await response.clone().text()));
      return response;
    };
    let validation = 'passed';
    let code = null;
    try {
      await transcribeAndValidate(new OpenAIWhisperTranscriber({ apiKey, fetchImpl }), input);
    } catch (error) {
      validation = 'failed';
      code = /^[a-z0-9_]{1,100}$/u.test(error?.code) ? error.code : 'diagnostic_failed';
    }
    console.log(JSON.stringify({
      gate: 'openai_whisper_structure_diagnostic',
      http_status: httpStatus,
      validation,
      code,
      derivative_duration_ms: durationMs,
      ...diagnostic,
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main().catch(() => {
  console.log(JSON.stringify({ gate: 'openai_whisper_structure_diagnostic', validation: 'failed', code: 'diagnostic_failed' }));
  process.exitCode = 1;
});
