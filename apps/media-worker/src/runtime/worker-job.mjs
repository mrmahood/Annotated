import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaCoreError } from '../domain/media-core-error.mjs';
import { createLocalDerivative, inspectLocalDerivative, inspectLocalRaw } from '../media/local-media-core.mjs';
import { createDerivativeAudioInput } from '../transcription/derivative-audio.mjs';
import { transcribeAndValidate } from '../transcription/transcript.mjs';
import { requireBoundedInteger, requireMediaId } from './validation.mjs';

const RESUME_STAGES = new Set(['probing', 'transcribing', 'raw_cleanup', 'finalizing']);
const GEOMETRY_FAILURE_REASONS = new Set(['capture_changed', 'player_not_visible']);

export function persistedFailureCode(failure) {
  if (failure?.code === 'unsafe_geometry' && GEOMETRY_FAILURE_REASONS.has(failure.reason)) {
    return failure.reason;
  }
  return failure.code;
}

function validateClaim(claim, expectedMediaId) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new TypeError('Worker claim is invalid.');
  if (requireMediaId(claim.media_id) !== expectedMediaId || !['video', 'audio'].includes(claim.media_type)) {
    throw new TypeError('Worker claim identity is invalid.');
  }
  if (!RESUME_STAGES.has(claim.resume_stage)) throw new TypeError('Worker resume stage is invalid.');
  requireMediaId(claim.annotation_id);
  requireMediaId(claim.lease_token);
  requireBoundedInteger(claim.target_start_ms, 'Target start', 0, Number.MAX_SAFE_INTEGER);
  requireBoundedInteger(claim.target_end_ms, 'Target end', 1_000, Number.MAX_SAFE_INTEGER);
  const requestedDurationMs = claim.target_end_ms - claim.target_start_ms;
  requireBoundedInteger(requestedDurationMs, 'Target duration', 1_000, 90_000);
  if (typeof claim.expected_processed_storage_path !== 'string' || !claim.expected_processed_storage_path) {
    throw new TypeError('Expected processed path is invalid.');
  }
  return { ...claim, requestedDurationMs };
}

function derivativeFileExtension(mediaType) {
  return mediaType === 'video' ? '.mp4' : '.m4a';
}

function failureFacts(error, stage) {
  if (error instanceof MediaCoreError && /^[a-z0-9_]{1,50}$/u.test(error.stage) && /^[a-z0-9_]{1,100}$/u.test(error.code)) {
    const facts = { stage: error.stage, code: error.code };
    if (typeof error.reason === 'string' && /^[a-z0-9_]{1,100}$/u.test(error.reason)) facts.reason = error.reason;
    return facts;
  }
  const boundedStage = /^[a-z0-9_]{1,50}$/u.test(stage) ? stage : 'worker';
  if (error?.boundedReason === 'duration_overshoot') {
    return { stage: boundedStage, code: 'output_invalid', reason: 'duration_overshoot' };
  }
  return { stage: boundedStage, code: 'unexpected_failure' };
}

async function ensureDerivative({ claim, storage, ffmpegPath, ffprobePath, inputPath, outputPath }) {
  const rawBytes = await storage.download('annotation-media-raw', claim.raw_storage_path);
  if (rawBytes.length !== Number(claim.raw_byte_size)) throw new MediaCoreError('probing', 'raw_size_mismatch', 'Raw size changed.');
  await writeFile(inputPath, rawBytes, { flag: 'wx' });
  const raw = await inspectLocalRaw({
    ffprobePath,
    mediaType: claim.media_type,
    inputPath,
    captureMetadata: claim.capture_metadata,
    requestedDurationMs: claim.requestedDurationMs,
  });

  let output;
  let reused = false;
  if (await storage.exists('annotation-media', claim.expected_processed_storage_path)) {
    const derivativeBytes = await storage.download('annotation-media', claim.expected_processed_storage_path);
    await writeFile(outputPath, derivativeBytes, { flag: 'wx' });
    output = await inspectLocalDerivative({
      ffprobePath,
      mediaType: claim.media_type,
      outputPath,
      requestedDurationMs: claim.requestedDurationMs,
      crop: raw.crop,
    });
    reused = true;
  } else {
    const created = await createLocalDerivative({
      ffmpegPath,
      ffprobePath,
      mediaType: claim.media_type,
      inputPath,
      outputPath,
      captureMetadata: claim.capture_metadata,
      requestedDurationMs: claim.requestedDurationMs,
    });
    if (created.input.checksumSha256 !== raw.input.checksumSha256) {
      throw new MediaCoreError('probing', 'raw_checksum_mismatch', 'Raw checksum changed during processing.');
    }
    output = created.output;
    await storage.uploadNoUpsert(
      'annotation-media',
      claim.expected_processed_storage_path,
      await readFile(outputPath),
      output.mimeType,
    );
  }
  return { rawChecksumSha256: raw.input.checksumSha256, output, reused };
}

async function obtainStagedDerivative({ claim, storage, outputPath, ffprobePath }) {
  if (claim.processed_storage_path !== claim.expected_processed_storage_path) {
    throw new MediaCoreError('transcribing', 'processed_path_mismatch', 'Processed path is not authoritative.');
  }
  const bytes = await storage.download('annotation-media', claim.processed_storage_path);
  await writeFile(outputPath, bytes, { flag: 'wx' });
  const output = await inspectLocalDerivative({
    ffprobePath,
    mediaType: claim.media_type,
    outputPath,
    requestedDurationMs: claim.requestedDurationMs,
  });
  if (
    output.checksumSha256 !== claim.checksum_sha256 || output.byteSize !== Number(claim.byte_size) ||
    output.durationMs !== Number(claim.duration_ms) || output.width !== claim.width || output.height !== claim.height ||
    output.mimeType !== claim.processed_mime_type
  ) {
    throw new MediaCoreError('transcribing', 'processed_object_mismatch', 'Processed object does not match staged facts.');
  }
  return output;
}

export async function runOneMediaJob({
  mediaId,
  store,
  storage,
  ffmpegPath,
  ffprobePath,
  transcriber,
  logger,
  leaseSeconds = 900,
  temporaryRoot = os.tmpdir(),
  loadStagedDerivative = obtainStagedDerivative,
  createDerivativeAudio = createDerivativeAudioInput,
  transcribeExcerpt = transcribeAndValidate,
}) {
  const normalizedMediaId = requireMediaId(mediaId);
  if (!store || typeof store.claim !== 'function' || !storage || typeof storage.download !== 'function') {
    throw new TypeError('Worker infrastructure is unavailable.');
  }
  requireBoundedInteger(leaseSeconds, 'Lease seconds', 60, 3_600);
  const startedAt = Date.now();
  logger?.emit('worker_started', { media_id: normalizedMediaId });
  const rawClaim = await store.claim(normalizedMediaId, leaseSeconds);
  if (!rawClaim) {
    logger?.emit('worker_skipped', { media_id: normalizedMediaId, outcome: 'not_claimed' });
    return Object.freeze({ outcome: 'not_claimed' });
  }
  const claim = validateClaim(rawClaim, normalizedMediaId);
  let stage = claim.resume_stage;
  logger?.emit('worker_claimed', {
    media_id: normalizedMediaId,
    resume_stage: stage,
    attempt_count: Number(claim.attempt_count),
  });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, 'annotated-worker-'));
  const inputPath = path.join(temporaryDirectory, 'raw.webm');
  const outputPath = path.join(temporaryDirectory, `excerpt${derivativeFileExtension(claim.media_type)}`);
  const transcriptionAudioPath = path.join(temporaryDirectory, 'transcription.flac');

  try {
    let output = null;
    if (stage === 'probing') {
      if (!claim.raw_storage_path || !claim.raw_byte_size) throw new MediaCoreError('probing', 'raw_missing', 'Raw object facts are missing.');
      const derivative = await ensureDerivative({ claim, storage, ffmpegPath, ffprobePath, inputPath, outputPath });
      output = derivative.output;
      await store.stageDerivative(normalizedMediaId, claim.lease_token, {
        rawChecksumSha256: derivative.rawChecksumSha256,
        processedStoragePath: claim.expected_processed_storage_path,
        ...output,
      });
      logger?.emit('derivative_staged', {
        media_id: normalizedMediaId,
        outcome: derivative.reused ? 'reused' : 'created',
        duration_ms: output.durationMs,
        byte_size: output.byteSize,
      });
      stage = 'raw_cleanup';
    }

    if (stage === 'raw_cleanup') {
      if (claim.raw_storage_path && await storage.exists('annotation-media-raw', claim.raw_storage_path)) {
        await storage.remove('annotation-media-raw', [claim.raw_storage_path]);
      }
      if (claim.raw_storage_path && await storage.exists('annotation-media-raw', claim.raw_storage_path)) {
        throw new MediaCoreError('raw_cleanup', 'raw_delete_unconfirmed', 'Raw object deletion was not confirmed.');
      }
      await store.confirmRawDeleted(normalizedMediaId, claim.lease_token);
      logger?.emit('raw_cleanup_confirmed', { media_id: normalizedMediaId });
      stage = 'transcribing';
    }

    if (stage === 'transcribing') {
      if (typeof store.publishPlayable !== 'function') throw new TypeError('Playable publication is unavailable.');
      await store.publishPlayable(normalizedMediaId, claim.lease_token);
      logger?.emit('playable_published', { media_id: normalizedMediaId });
      if (!claim.transcript_present) {
        output ??= await loadStagedDerivative({ claim, storage, outputPath, ffprobePath });
        const capability = await createDerivativeAudio({
          ffmpegPath,
          ffprobePath,
          mediaType: claim.media_type,
          derivativePath: outputPath,
          derivativeChecksumSha256: output.checksumSha256,
          derivativeDurationMs: output.durationMs,
          transcriptionAudioPath,
        });
        const transcript = await transcribeExcerpt(transcriber, capability);
        await store.stageTranscript(normalizedMediaId, claim.lease_token, transcript);
        logger?.emit('transcript_staged', { media_id: normalizedMediaId, duration_ms: output.durationMs });
      }
      stage = 'finalizing';
    }

    if (stage === 'finalizing') await store.finalize(normalizedMediaId, claim.lease_token);
    const durationMs = Math.max(0, Date.now() - startedAt);
    logger?.emit('worker_completed', { media_id: normalizedMediaId, outcome: 'ready', duration_ms: durationMs });
    return Object.freeze({ outcome: 'ready' });
  } catch (error) {
    const failure = failureFacts(error, stage);
    const code = persistedFailureCode(failure);
    try {
      const released = await store.releaseAttempt(normalizedMediaId, claim.lease_token, failure.stage, code);
      const outcome = released?.result_status === 'processing' ? 'retry_scheduled' : 'failed';
      logger?.emit('worker_failed', {
        media_id: normalizedMediaId,
        stage: failure.stage,
        code,
        outcome,
        attempt_count: Number(claim.attempt_count),
        reason: failure.reason,
      });
      return Object.freeze({ outcome, stage: failure.stage, code });
    } catch {
      logger?.emit('worker_failed', { media_id: normalizedMediaId, stage: 'finalizing', code: 'lease_lost', outcome: 'failed' });
      return Object.freeze({ outcome: 'failed', stage: 'finalizing', code: 'lease_lost' });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
