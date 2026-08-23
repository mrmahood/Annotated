import { normalizeTranscriptSegments } from '/opt/annotated/src/transcription/transcript.mjs';

const result = normalizeTranscriptSegments([
  { start_ms: 0, end_ms: 90_400, text: 'observed tail' },
], 90_000);

if (result.length !== 1 || result[0].end_ms !== 90_000) {
  throw new Error('The exact observed provider tail was not clamped to the derivative duration.');
}

const portraitResult = normalizeTranscriptSegments([
  { start_ms: 0, end_ms: 8_000, text: 'portrait opening' },
  { start_ms: 8_000, end_ms: 10_160, text: 'observed portrait tail' },
], 9_000);

if (portraitResult.length !== 2 || portraitResult[1].end_ms !== 9_000) {
  throw new Error('The exact observed portrait provider tail was not clamped to the derivative duration.');
}

for (const segments of [
  [{ start_ms: 0, end_ms: 11_001, text: 'tail exceeds two seconds' }],
  [{ start_ms: 9_000, end_ms: 9_500, text: 'starts outside the excerpt' }],
]) {
  let rejected = false;
  try {
    normalizeTranscriptSegments(segments, 9_000);
  } catch (error) {
    rejected = error?.stage === 'transcribing' && error?.code === 'transcript_invalid';
  }
  if (!rejected) throw new Error('An out-of-bounds provider segment was accepted.');
}
