import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDerivativeAudioInput, openDerivativeAudioStream } from '../src/transcription/derivative-audio.mjs';
import { DeterministicFakeTranscriber } from '../src/transcription/fake-transcriber.mjs';
import { OpenAIWhisperTranscriber, OPENAI_TRANSCRIPTIONS_URL } from '../src/transcription/openai-whisper-transcriber.mjs';
import { transcribeAndValidate } from '../src/transcription/transcript.mjs';
import { ffmpegExecutables, generatedFixtureRoot } from './helpers/fixtures.mjs';

const tools = ffmpegExecutables();
const integration = tools ? test : test.skip;
const c2Results = JSON.parse(await readFile(path.join(generatedFixtureRoot, 'c2', 'results.json'), 'utf8'));
const landscape = c2Results.find((result) => result.scenario === 'landscape-video');

async function hashStream(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

integration('only exact final-derivative audio reaches the deterministic network-free adapter', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c3-test-'));
  const audioPath = path.join(directory, 'transcription.flac');
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  let networkAttempts = 0;
  const denyNetwork = () => {
    networkAttempts += 1;
    throw new Error('Network access is disabled in C3 tests.');
  };
  globalThis.fetch = denyNetwork;
  http.request = denyNetwork;
  http.get = denyNetwork;
  https.request = denyNetwork;
  https.get = denyNetwork;

  try {
    const derivativeAudio = await createDerivativeAudioInput({
      ...tools,
      mediaType: 'video',
      derivativePath: path.join(generatedFixtureRoot, 'c2', landscape.output_file),
      derivativeChecksumSha256: landscape.output.checksumSha256,
      derivativeDurationMs: landscape.output.durationMs,
      transcriptionAudioPath: audioPath,
    });
    assert.equal(derivativeAudio.sourceDerivativeChecksumSha256, landscape.output.checksumSha256);
    assert.equal(await hashStream(openDerivativeAudioStream(derivativeAudio)), derivativeAudio.checksumSha256);
    assert.equal('filePath' in derivativeAudio, false);

    const transcriber = new DeterministicFakeTranscriber();
    const first = await transcribeAndValidate(transcriber, derivativeAudio);
    const second = await transcribeAndValidate(transcriber, derivativeAudio);
    assert.deepEqual(first, second);
    assert.equal(first.provider, 'deterministic-fake');
    assert.equal(first.model, 'fixture-v1');
    assert.equal(first.providerMetadata.audio_sha256, derivativeAudio.checksumSha256);
    assert.equal(first.segments.at(-1).end_ms, Math.floor(derivativeAudio.durationMs));
    assert.equal(networkAttempts, 0);

    const invalid = new DeterministicFakeTranscriber({ response: {
      text: 'Invalid overlap', language: 'en', provider: 'deterministic-fake', model: 'fixture-v1',
      segments: [
        { start_ms: 0, end_ms: 2_000, text: 'first' },
        { start_ms: 1_000, end_ms: 3_000, text: 'second' },
      ],
    } });
    await assert.rejects(() => transcribeAndValidate(invalid, derivativeAudio), (error) => error.code === 'transcript_invalid');

    const timeout = new DeterministicFakeTranscriber({ failureCode: 'provider_timeout' });
    await assert.rejects(() => transcribeAndValidate(timeout, derivativeAudio), (error) => error.code === 'provider_timeout');

    const originalAudio = await readFile(audioPath);
    await appendFile(audioPath, Buffer.from('tampered'));
    await assert.rejects(() => transcribeAndValidate(transcriber, derivativeAudio), (error) => error.code === 'transcript_input_invalid');
    await writeFile(audioPath, originalAudio);
  } finally {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    await rm(directory, { recursive: true, force: true });
  }
});

integration('a raw WebM cannot mint a derivative-audio capability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c3-raw-test-'));
  try {
    const rawPath = path.join(generatedFixtureRoot, 'landscape-video.webm');
    const rawBytes = await readFile(rawPath);
    const rawChecksum = createHash('sha256').update(rawBytes).digest('hex');
    await assert.rejects(() => createDerivativeAudioInput({
      ...tools,
      mediaType: 'video',
      derivativePath: rawPath,
      derivativeChecksumSha256: rawChecksum,
      derivativeDurationMs: 4_000,
      transcriptionAudioPath: path.join(directory, 'forbidden.flac'),
    }), (error) => error.code === 'transcript_input_invalid');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

integration('the real Whisper adapter sends only exact derivative audio through an injected network boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-c6-whisper-test-'));
  try {
    const derivativeAudio = await createDerivativeAudioInput({
      ...tools,
      mediaType: 'video',
      derivativePath: path.join(generatedFixtureRoot, 'c2', landscape.output_file),
      derivativeChecksumSha256: landscape.output.checksumSha256,
      derivativeDurationMs: landscape.output.durationMs,
      transcriptionAudioPath: path.join(directory, 'transcription.flac'),
    });
    let requestCount = 0;
    const fetchImpl = async (url, options) => {
      requestCount += 1;
      assert.equal(url, OPENAI_TRANSCRIPTIONS_URL);
      assert.equal(options.method, 'POST');
      assert.match(options.headers.authorization, /^Bearer sk-test-/u);
      assert.equal(options.body.get('model'), 'whisper-1');
      assert.equal(options.body.get('response_format'), 'verbose_json');
      assert.equal(options.body.get('timestamp_granularities[]'), 'segment');
      const file = options.body.get('file');
      assert.equal(file.name, 'excerpt.flac');
      assert.equal(file.type, 'audio/flac');
      assert.equal(file.size, derivativeAudio.byteSize);
      return new Response(JSON.stringify({
        task: 'transcribe', language: 'english', duration: derivativeAudio.durationMs / 1000,
        text: 'Synthetic exact excerpt.',
        segments: [{ start: 0, end: derivativeAudio.durationMs / 1000, text: 'Synthetic exact excerpt.' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await transcribeAndValidate(new OpenAIWhisperTranscriber({
      apiKey: `sk-test-${'a'.repeat(40)}`,
      fetchImpl,
    }), derivativeAudio);
    assert.equal(requestCount, 1);
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'whisper-1');
    assert.equal(result.transcriptText, 'Synthetic exact excerpt.');
    assert.equal(result.segments.at(-1).end_ms, Math.floor(derivativeAudio.durationMs));
    assert.deepEqual(result.providerMetadata, { response_format: 'verbose_json', timestamp_granularity: 'segment' });

    const rateLimited = new OpenAIWhisperTranscriber({
      apiKey: `sk-test-${'b'.repeat(40)}`,
      fetchImpl: async () => new Response('{}', { status: 429 }),
    });
    await assert.rejects(() => transcribeAndValidate(rateLimited, derivativeAudio), (error) => error.code === 'provider_rate_limited');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
