import { persistDerivativeDurationMs } from '../runtime/validation.mjs';
import { validateCaptureMetadataV2 } from './capture-metadata.mjs';
import { fileByteSize, hashFileSha256 } from './checksum.mjs';
import { calculateVideoCrop } from './geometry.mjs';
import { probeFile, validateDerivativeProbe, validateRawProbe } from './probe.mjs';
import { runExecutable } from './process.mjs';
import { buildAudioTranscodeArguments, buildVideoTranscodeArguments } from './transcode.mjs';

export async function inspectLocalRaw({
  ffprobePath,
  mediaType,
  inputPath,
  captureMetadata,
  requestedDurationMs,
}) {
  const timing = validateCaptureMetadataV2(captureMetadata, mediaType, requestedDurationMs);
  const inputByteSize = await fileByteSize(inputPath);
  const inputProbe = await probeFile(ffprobePath, inputPath);
  const raw = validateRawProbe({
    mediaType,
    probe: inputProbe,
    expectedByteSize: inputByteSize,
    requestedDurationMs,
    leadInMs: timing.leadInMs,
  });
  const crop = mediaType === 'video'
    ? calculateVideoCrop(captureMetadata, raw.video.width, raw.video.height)
    : null;
  return {
    timing,
    crop,
    input: { probe: inputProbe, byteSize: inputByteSize, checksumSha256: await hashFileSha256(inputPath) },
  };
}

export async function inspectLocalDerivative({
  ffprobePath,
  mediaType,
  outputPath,
  requestedDurationMs,
  crop = null,
}) {
  const outputByteSize = await fileByteSize(outputPath);
  const outputProbe = await probeFile(ffprobePath, outputPath);
  const derivative = validateDerivativeProbe({
    mediaType,
    probe: outputProbe,
    expectedByteSize: outputByteSize,
    requestedDurationMs,
    crop,
  });
  return {
    probe: outputProbe,
    byteSize: outputByteSize,
    checksumSha256: await hashFileSha256(outputPath),
    durationMs: persistDerivativeDurationMs(derivative.durationMs),
    width: derivative.video?.width ?? null,
    height: derivative.video?.height ?? null,
    mimeType: mediaType === 'video' ? 'video/mp4' : 'audio/mp4',
  };
}

export async function createLocalDerivative({
  ffmpegPath,
  ffprobePath,
  mediaType,
  inputPath,
  outputPath,
  captureMetadata,
  requestedDurationMs,
}) {
  const inspected = await inspectLocalRaw({
    ffprobePath,
    mediaType,
    inputPath,
    captureMetadata,
    requestedDurationMs,
  });
  const args = mediaType === 'video'
    ? buildVideoTranscodeArguments({ inputPath, outputPath, leadInMs: inspected.timing.leadInMs, requestedDurationMs, crop: inspected.crop })
    : buildAudioTranscodeArguments({ inputPath, outputPath, leadInMs: inspected.timing.leadInMs, requestedDurationMs });

  await runExecutable(ffmpegPath, args, { timeoutMs: 120_000, stage: 'transcoding', failureCode: 'transcode_failed' });
  const output = await inspectLocalDerivative({
    ffprobePath,
    mediaType,
    outputPath,
    requestedDurationMs,
    crop: inspected.crop,
  });
  return {
    input: inspected.input,
    crop: inspected.crop,
    output,
  };
}
