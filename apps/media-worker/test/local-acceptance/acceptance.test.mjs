import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  countDisposableSessions,
  deleteDisposableRows,
  isRecoverableDisposableLogoutStatus,
  validateEvidence,
} from './acceptance.mjs';

function videoRow(leadInMs) {
  return {
    media_type: 'video',
    annotation_status: 'draft',
    processing_status: 'processing',
    processing_stage: 'queued',
    raw_reference_present: true,
    capture_metadata: {
      version: 2,
      timing: {
        requested_start_ms: 164403,
        requested_end_ms: 170002,
        lead_in_clock: 'offscreen_monotonic',
        lead_in_ms: leadInMs,
        recorder_elapsed_ms: 5672,
      },
      capture_track: {
        tracks: [{ kind: 'audio' }, { kind: 'video' }],
        audio_track_count: 1,
        video_track_count: 1,
        loopback_enabled: true,
      },
      viewport: { start: {}, end: {} },
      video_element: {
        start: { x: 0, y: 60, width: 637, height: 358 },
        end: { x: 0, y: 60, width: 637, height: 358 },
      },
      intrinsic_video: { width: 854, height: 480 },
      computed_style: { object_fit: 'cover', object_position: '50% 50%' },
      fullscreen: { start: false, end: false },
    },
  };
}

test('accepts fractional monotonic lead-in evidence emitted by Chrome', () => {
  const result = validateEvidence([videoRow(71.5)]);
  assert.deepEqual(result.checks, [{ media_type: 'video', accepted: true }]);
});

test('rejects non-finite monotonic lead-in evidence', () => {
  const result = validateEvidence([videoRow(Number.NaN)]);
  assert.deepEqual(result.checks, [{ media_type: 'video', accepted: false }]);
});

test('deletes only the disposable owner annotations before deleting Local Auth', () => {
  let statement = '';
  deleteDisposableRows({ execute: (sql) => { statement = sql; } }, '11111111-1111-4111-8111-111111111111');
  assert.match(statement, /delete from public\.annotations/u);
  assert.match(statement, /where user_id = '11111111-1111-4111-8111-111111111111'::uuid/u);
  assert.doesNotMatch(statement, /delete from auth\.users/u);
});

test('checks the exact disposable owner before accepting an already-revoked session', () => {
  let statement = '';
  const count = countDisposableSessions({ json: (sql) => { statement = sql; return 0; } }, '11111111-1111-4111-8111-111111111111');
  assert.equal(count, 0);
  assert.match(statement, /from auth\.sessions/u);
  assert.match(statement, /where user_id = '11111111-1111-4111-8111-111111111111'::uuid/u);
});

test('allows expired Local logout responses only before verified user deletion', () => {
  for (const status of [200, 204, 401, 403, 404]) {
    assert.equal(isRecoverableDisposableLogoutStatus(status), true);
  }
  for (const status of [0, 400, 500]) {
    assert.equal(isRecoverableDisposableLogoutStatus(status), false);
  }
});

test('the standalone audio fixture reports its ready URL to the owner', async () => {
  const source = await readFile(new URL('./fixture-server.mjs', import.meta.url), 'utf8');
  assert.match(source, /server\.listen\(port, '127\.0\.0\.1', \(\) => \{/u);
  assert.match(source, /Annotated Local audio fixture ready: http:\/\/localhost:\$\{port\}\/audio/u);
});
