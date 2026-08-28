import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createHostedAttemptToken,
  createModeSwitchIntent,
  createPlayerActionToken,
  deriveOperationGuardState,
  getModeSwitchGuard,
  hostedAttemptTokenIsCurrent,
  modeSwitchIntentIsCurrent,
  operationLocksMediaEditor,
  playerActionTokenIsCurrent,
} from './operation-guards.ts';

const operation = {
  annotationId: '11111111-1111-4111-8111-111111111111',
  mediaId: '22222222-2222-4222-8222-222222222222',
  creatorHandle: 'creator',
  annotationSlug: 'clip-11111111',
  processingStatus: 'capture_pending',
};
const session = {
  operation,
  sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  mediaType: 'video',
  startMs: 5_000,
  endMs: 20_000,
  createdAt: 1,
};
const base = {
  articlePublishing: false,
  hostedBeginMode: null,
  hostedSession: session,
  capture: { status: 'idle' },
  cancelling: false,
};

test('every transition-table phase has a deterministic mode-switch guard', () => {
  const rows = [
    [{ ...base, hostedSession: null }, 'idle', 'allow'],
    [{ ...base, hostedSession: null, articlePublishing: true }, 'article-publishing', 'lock'],
    [{ ...base, hostedSession: null, hostedBeginMode: 'video' }, 'hosted-begin', 'lock'],
    [{ ...base, hostedSession: null, capture: { status: 'capturing', captureId: 'capture-1' } }, 'capturing', 'lock'],
    [{ ...base, capture: { status: 'preparing', captureId: 'capture-1' } }, 'preparing', 'lock'],
    [{ ...base, capture: { status: 'capturing', captureId: 'capture-1' } }, 'capturing', 'confirm-cancel'],
    [{ ...base, capture: { status: 'stopping', captureId: 'capture-1' } }, 'stopping', 'confirm-cancel'],
    [{ ...base, capture: { status: 'uploading', captureId: 'capture-1', progress: 40 } }, 'uploading', 'confirm-cancel'],
    [{ ...base, capture: { status: 'waiting-to-upload', captureId: 'capture-1', message: 'Retry.' } }, 'waiting-to-upload', 'confirm-cancel'],
    [{ ...base, capture: { status: 'verifying-upload', captureId: 'capture-1', annotationId: operation.annotationId, mediaId: operation.mediaId } }, 'verifying-upload', 'confirm-cancel'],
    [{ ...base, capture: { status: 'processing', captureId: 'capture-1', annotationId: operation.annotationId, mediaId: operation.mediaId } }, 'processing', 'allow'],
    [{ ...base, capture: { status: 'error', captureId: null, code: 'recapture-required', message: 'Recapture.' } }, 'restart-recovery', 'allow'],
    [{ ...base, cancelling: true }, 'cancelling', 'lock'],
  ];
  for (const [input, phase, action] of rows) {
    const state = deriveOperationGuardState(input);
    assert.equal(state.phase, phase);
    assert.equal(getModeSwitchGuard(state, 'video', 'text').action, action, phase);
  }
});

test('upload-failed retains the Blob cancellation guard while Processing and restart recovery remain editable', () => {
  const retained = deriveOperationGuardState({
    ...base,
    capture: { status: 'error', captureId: 'capture-1', code: 'upload-failed', message: 'Retry limit.' },
  });
  assert.equal(retained.phase, 'waiting-to-upload');
  assert.equal(operationLocksMediaEditor(retained), true);
  assert.equal(operationLocksMediaEditor(deriveOperationGuardState({
    ...base,
    capture: { status: 'processing', captureId: 'capture-1', annotationId: operation.annotationId, mediaId: operation.mediaId },
  })), false);
  assert.equal(operationLocksMediaEditor(deriveOperationGuardState({
    ...base,
    capture: { status: 'error', captureId: null, code: 'raw-capture-unavailable', message: 'Restarted.' },
  })), false);
});

test('destructive switch intent is range-bound and cannot apply after page or mode changes', () => {
  const state = deriveOperationGuardState({
    ...base,
    capture: { status: 'capturing', captureId: 'capture-1' },
  });
  const guard = getModeSwitchGuard(state, 'video', 'audio');
  assert.equal(guard.action, 'confirm-cancel');
  const intent = createModeSwitchIntent(guard, 'video', 'audio', 7);
  const page = { generation: 7, identity: { tabId: 1, windowId: 2, sourceKey: 'source' } };
  assert.equal(modeSwitchIntentIsCurrent(intent, page, 'video'), true);
  assert.equal(modeSwitchIntentIsCurrent(intent, { ...page, generation: 8 }, 'video'), false);
  assert.equal(modeSwitchIntentIsCurrent(intent, page, 'text'), false);
  assert.deepEqual([intent.hostedMode, intent.startMs, intent.endMs], ['video', 5_000, 20_000]);
});

test('player async tokens reject revision, player, and page-generation races', () => {
  const page = { generation: 3, identity: { tabId: 1, windowId: 2, sourceKey: 'source' } };
  const token = createPlayerActionToken(page, 'video', 4, 'video:1:12345678');
  const draft = { revision: 4, playerIdentity: 'video:1:12345678' };
  assert.equal(playerActionTokenIsCurrent(token, page, draft), true);
  assert.equal(playerActionTokenIsCurrent(token, page, { ...draft, revision: 5 }), false);
  assert.equal(playerActionTokenIsCurrent(token, page, { ...draft, playerIdentity: 'video:2:87654321' }), false);
  assert.equal(playerActionTokenIsCurrent(token, { ...page, generation: 4 }, draft), false);
});

test('hosted attempt tokens isolate retries and cancellation from recapture attempts', () => {
  const token = createHostedAttemptToken(operation, 'capture-old');
  assert.equal(hostedAttemptTokenIsCurrent(token, session, 'capture-old'), true);
  assert.equal(hostedAttemptTokenIsCurrent(token, session, 'capture-new'), false);
  assert.equal(hostedAttemptTokenIsCurrent(token, { ...session, operation: { ...operation, mediaId: '33333333-3333-4333-8333-333333333333' } }, 'capture-old'), false);
  assert.equal(hostedAttemptTokenIsCurrent(token, null, 'capture-old'), false);
});

test('the panel wires a safe-default dialog and authoritative-cancel switch path', async () => {
  const source = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /getModeSwitchGuard\(/);
  assert.match(source, /<dialog[^>]*className="mode-switch-dialog"/);
  assert.match(source, /autoFocus[^>]*>Keep working</);
  assert.match(source, />Cancel capture and switch</);
  assert.match(source, /await cancelHostedMedia\(attempt\)/);
  assert.match(source, /modeSwitchIntentIsCurrent\(/);
  assert.match(source, /await cancelStaleHostedBegin\(/);
  assert.match(source, /await cancelHostedSessionOnServer\(session\)/);
});
