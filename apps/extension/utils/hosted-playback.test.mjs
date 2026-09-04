import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DURATION_SLACK_MS,
  getMediaPlaybackPath,
  isHostedExcerptReady,
  parsePublicHostedExcerpt,
  parsePublicTranscript,
} from './hosted-playback.ts';

const ANNOTATION = '41000000-0000-4000-8000-000000000001';
const MEDIA = '42000000-0000-4000-8000-000000000001';
const TARGET_MS = 9_000;

const READY_VIDEO = {
  annotation_id: ANNOTATION,
  media_id: MEDIA,
  media_type: 'video',
  availability: 'ready',
  mime_type: 'video/mp4',
  duration_ms: TARGET_MS,
  width: 426,
  height: 240,
  byte_size: 400_000,
};

const READY_AUDIO = {
  ...READY_VIDEO,
  media_type: 'audio',
  mime_type: 'audio/mp4',
  width: null,
  height: null,
  byte_size: 200_000,
};

const TRANSCRIPT = {
  annotation_id: ANNOTATION,
  transcript_text: 'Hello from the excerpt.',
  language: 'en',
  segments: [
    { start_ms: 0, end_ms: 4_000, text: 'Hello from' },
    { start_ms: 4_000, end_ms: 9_000, text: 'the excerpt.' },
  ],
};

const REMOVED_VIDEO = {
  annotation_id: ANNOTATION,
  media_id: MEDIA,
  media_type: 'video',
  availability: 'removed',
  mime_type: null,
  duration_ms: null,
  width: null,
  height: null,
  byte_size: null,
};

test('constructs a web-app playback path from annotation UUID and one retry only', () => {
  assert.equal(getMediaPlaybackPath(ANNOTATION), `/api/media/playback/${ANNOTATION}?attempt=0`);
  assert.equal(getMediaPlaybackPath(ANNOTATION, 1), `/api/media/playback/${ANNOTATION}?attempt=1`);
  assert.throws(() => getMediaPlaybackPath('../private', 0), /Invalid media playback identity/);
  assert.throws(() => getMediaPlaybackPath(ANNOTATION, 2), /Invalid media playback identity/);
});

test('accepts ready video and audio public media with a matching excerpt transcript', () => {
  const video = parsePublicHostedExcerpt(READY_VIDEO, TRANSCRIPT, ANNOTATION, 'video', TARGET_MS);
  assert.deepEqual(video, {
    status: 'ready',
    media: {
      id: MEDIA,
      mimeType: 'video/mp4',
      durationMs: TARGET_MS,
      width: 426,
      height: 240,
    },
    transcript: {
      text: 'Hello from the excerpt.',
      language: 'en',
      segments: [
        { startMs: 0, endMs: 4_000, text: 'Hello from' },
        { startMs: 4_000, endMs: 9_000, text: 'the excerpt.' },
      ],
    },
  });
  assert.equal(isHostedExcerptReady(video), true);

  const audio = parsePublicHostedExcerpt(
    READY_AUDIO,
    { ...TRANSCRIPT, segments: null },
    ANNOTATION,
    'audio',
    TARGET_MS,
  );
  assert.equal(audio?.status, 'ready');
  assert.equal(audio && audio.status === 'ready' ? audio.media.mimeType : null, 'audio/mp4');
  assert.equal(audio && audio.status === 'ready' ? audio.transcript.segments : undefined, null);
});

test('maps removed public media without a player payload', () => {
  const removed = parsePublicHostedExcerpt(REMOVED_VIDEO, null, ANNOTATION, 'video', TARGET_MS);
  assert.deepEqual(removed, { status: 'removed' });
  assert.equal(isHostedExcerptReady(removed), false);
});

test('fails closed for legacy, processing, mismatched, and transcript-less ready rows', () => {
  const closed = [
    parsePublicHostedExcerpt(null, null, ANNOTATION, 'video', TARGET_MS),
    parsePublicHostedExcerpt(
      { ...READY_VIDEO, availability: 'unavailable', mime_type: null, duration_ms: null, width: null, height: null, byte_size: null },
      null,
      ANNOTATION,
      'video',
      TARGET_MS,
    ),
    parsePublicHostedExcerpt(READY_VIDEO, null, ANNOTATION, 'video', TARGET_MS),
    parsePublicHostedExcerpt(READY_VIDEO, TRANSCRIPT, ANNOTATION, 'audio', TARGET_MS),
    parsePublicHostedExcerpt({ ...READY_VIDEO, mime_type: 'text/html' }, TRANSCRIPT, ANNOTATION, 'video', TARGET_MS),
    parsePublicHostedExcerpt(REMOVED_VIDEO, TRANSCRIPT, ANNOTATION, 'video', TARGET_MS),
    parsePublicHostedExcerpt(READY_VIDEO, { ...TRANSCRIPT, annotation_id: MEDIA }, ANNOTATION, 'video', TARGET_MS),
  ];
  for (const value of closed) assert.equal(value, null);
});

test('admits 100 ms of symmetric tab-capture slack around the selected range', () => {
  assert.equal(DURATION_SLACK_MS, 100);
  const target = 9_295;
  const transcript = {
    annotation_id: ANNOTATION,
    transcript_text: 'Hello from the excerpt.',
    language: 'en',
    segments: null,
  };

  for (const durationMs of [9_195, 9_273, 9_295, 9_317, 9_395]) {
    const hosted = parsePublicHostedExcerpt(
      { ...READY_VIDEO, duration_ms: durationMs },
      transcript,
      ANNOTATION,
      'video',
      target,
    );
    assert.equal(hosted?.status, 'ready', `${durationMs} must be accepted for a ${target} ms range`);
    assert.equal(hosted && hosted.status === 'ready' ? hosted.media.durationMs : null, durationMs);
  }

  for (const durationMs of [9_194, 9_396, 9_295.5, 90_001]) {
    assert.equal(
      parsePublicHostedExcerpt(
        { ...READY_VIDEO, duration_ms: durationMs },
        transcript,
        ANNOTATION,
        'video',
        target,
      ),
      null,
      `${durationMs} must fail closed for a ${target} ms range`,
    );
  }

  assert.equal(
    parsePublicHostedExcerpt(
      { ...READY_VIDEO, duration_ms: 90_000 },
      transcript,
      ANNOTATION,
      'video',
      90_000,
    )?.status,
    'ready',
  );
  assert.equal(
    parsePublicHostedExcerpt(
      { ...READY_VIDEO, duration_ms: 90_100 },
      transcript,
      ANNOTATION,
      'video',
      90_000,
    ),
    null,
    '90s plus 100 ms must stay clamped to 90000',
  );
});

test('rejects transcript segments that leave the excerpt or overlap backward', () => {
  assert.equal(
    parsePublicTranscript(
      { ...TRANSCRIPT, segments: [{ start_ms: 0, end_ms: 9_001, text: 'too long' }] },
      ANNOTATION,
      TARGET_MS,
    ),
    null,
  );
  assert.equal(
    parsePublicTranscript(
      {
        ...TRANSCRIPT,
        segments: [
          { start_ms: 0, end_ms: 4_000, text: 'first' },
          { start_ms: 3_000, end_ms: 6_000, text: 'overlap' },
        ],
      },
      ANNOTATION,
      TARGET_MS,
    ),
    null,
  );
});
