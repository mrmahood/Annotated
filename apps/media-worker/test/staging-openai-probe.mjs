import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDerivativeAudioInput } from '../src/transcription/derivative-audio.mjs';
import {
  OPENAI_WHISPER_MODEL,
  OpenAIWhisperTranscriber,
} from '../src/transcription/openai-whisper-transcriber.mjs';
import { transcribeAndValidate } from '../src/transcription/transcript.mjs';
import { ffmpegExecutables, generatedFixtureRoot } from './helpers/fixtures.mjs';

const GATE_NAME = 'openai_whisper_staging_probe';
const REQUIRED_SCOPE = 'api.model.audio.request';

function safeToken(value) {
  return typeof value === 'string' && /^[a-z0-9._-]{1,100}$/u.test(value) ? value : null;
}

function probeFailure(code) {
  const error = new Error('The bounded Staging probe failed.');
  error.code = code;
  return error;
}

async function providerDiagnostic(response) {
  if (response.ok) return {};
  try {
    const text = await response.clone().text();
    if (Buffer.byteLength(text, 'utf8') > 8_192) return {};
    const error = JSON.parse(text)?.error;
    const message = typeof error?.message === 'string' ? error.message : '';
    return {
      error_type: safeToken(error?.type),
      error_code: safeToken(error?.code),
      required_scope: message.includes(REQUIRED_SCOPE) ? REQUIRED_SCOPE : null,
    };
  } catch {
    return {};
  }
}

async function main() {
  let directory = null;
  let httpStatus = null;
  let diagnostic = {};
  try {
    if (process.env.ANNOTATED_C6_STAGING_PROBE !== '1') throw probeFailure('probe_not_enabled');
    const apiKey = process.env.OPENAI_API_KEY;
    if (typeof apiKey !== 'string' || Buffer.byteLength(apiKey, 'utf8') < 32 || Buffer.byteLength(apiKey, 'utf8') > 512) {
      throw probeFailure('openai_key_unavailable');
    }
    const tools = ffmpegExecutables();
    if (!tools) throw probeFailure('ffmpeg_unavailable');
    try {
      await Promise.all([access(tools.ffmpegPath), access(tools.ffprobePath)]);
    } catch {
      throw probeFailure('ffmpeg_unavailable');
    }
    let scenarios;
    try {
      scenarios = JSON.parse(await readFile(path.join(generatedFixtureRoot, 'c2', 'results.json'), 'utf8'));
    } catch {
      throw probeFailure('fixture_unavailable');
    }
    const landscape = scenarios.find((scenario) => scenario.scenario === 'landscape-video');
    if (!landscape) throw probeFailure('fixture_unavailable');

    directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c6-openai-probe-'));
    const derivativeAudio = await createDerivativeAudioInput({
      ...tools,
      mediaType: 'video',
      derivativePath: path.join(generatedFixtureRoot, 'c2', landscape.output_file),
      derivativeChecksumSha256: landscape.output.checksumSha256,
      derivativeDurationMs: landscape.output.durationMs,
      transcriptionAudioPath: path.join(directory, 'transcription.flac'),
    });
    const fetchImpl = async (...args) => {
      const response = await fetch(...args);
      httpStatus = response.status;
      diagnostic = await providerDiagnostic(response);
      return response;
    };

    let adapterOutcome = 'accepted';
    let adapterCode = null;
    let segmentCount = null;
    try {
      const transcript = await transcribeAndValidate(
        new OpenAIWhisperTranscriber({ apiKey, fetchImpl }),
        derivativeAudio,
      );
      segmentCount = transcript.segments?.length ?? null;
    } catch (error) {
      if (httpStatus === 200 && ['transcription_failed', 'transcript_invalid'].includes(error?.code)) {
        adapterOutcome = 'provider_accepted_synthetic_tone_without_valid_transcript';
        adapterCode = error.code;
      } else {
        throw error;
      }
    }

    if (httpStatus !== 200) throw new Error('The provider did not accept the bounded probe.');
    console.log(JSON.stringify({
      gate: GATE_NAME,
      outcome: 'passed',
      http_status: httpStatus,
      model: OPENAI_WHISPER_MODEL,
      adapter_outcome: adapterOutcome,
      adapter_code: adapterCode,
      segment_count: segmentCount,
      derivative_duration_ms: Math.floor(landscape.output.durationMs),
      derivative_checksum_sha256: landscape.output.checksumSha256,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      gate: GATE_NAME,
      outcome: 'failed',
      http_status: httpStatus,
      code: safeToken(error?.code) ?? 'probe_failed',
      ...diagnostic,
    }));
    process.exitCode = 1;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

await main();
