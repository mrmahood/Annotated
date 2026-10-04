import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  cancelOwnedHostedMedia,
  createPublishStateAfterHostedFailure,
  getHostedMediaCancelError,
  hostedCancelClearsLocalAttention,
  hostedCancelCreateReset,
  hostedDraftIsForeignLiveWork,
  hostedDraftIsOrphanedAttention,
  hostedForeignOrphanCreateReset,
  hostedMediaFailedStatusDetail,
  hostedMediaProcessingStageDetail,
  hostedMediaProgressCopy,
  hostedPublishAbandonDecision,
  hostedSessionBlocksCreatePublish,
  hostedSessionMatchesConnectedUrl,
  HOSTED_FOREIGN_SOURCE_CANCEL_DETAIL,
  isHostedMediaSession,
  parseOwnedHostedMediaStatus,
  presentHostedMediaSnapshot,
  reconcileHostedMediaState,
  shouldAbandonOrphanedHostedDraftForPublish,
  shouldAutoAbandonForeignHostedDraft,
  shouldOfferHostedRecapture,
  shouldRollbackHostedDraftAfterStartFailure,
  shouldPollHostedOwnerStatus,
  shouldShowCreatePublishError,
} from './hosted-media.ts';

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
function ownedStatus(processingStatus, processingStage = null, failureStage = null, failureCode = null) {
  return {
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
    mediaType: 'video',
    processingStatus,
    processingStage,
    failureStage,
    failureCode,
    creatorHandle: 'creator',
    annotationSlug: 'clip-11111111',
  };
}

test('a hosted session hides the Create publish error so Recapture cannot leave a stale banner', () => {
  assert.equal(shouldShowCreatePublishError('error', null), true);
  assert.equal(shouldShowCreatePublishError('error', session), false);
  assert.equal(shouldShowCreatePublishError('idle', session), false);
  assert.equal(shouldShowCreatePublishError('publishing', null), false);
  assert.deepEqual(
    createPublishStateAfterHostedFailure(session, 'Capture could not start: leftover.'),
    { status: 'idle' },
  );
  assert.deepEqual(
    createPublishStateAfterHostedFailure(null, 'Range is invalid.'),
    { status: 'error', message: 'Range is invalid.' },
  );
  assert.deepEqual(
    createPublishStateAfterHostedFailure(
      null,
      'Click the Annotated toolbar icon on this tab, then Recapture.',
    ),
    { status: 'error', message: 'Capture could not start. Click Publish again.' },
  );
});

test('Recapture and capture start clear Create publish errors before the next attempt', async () => {
  const [app, hosted] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./hosted-media.ts', import.meta.url), 'utf8'),
  ]);
  const recapture = app.slice(app.indexOf('const recaptureHostedMedia'));
  assert.ok(recapture.indexOf("setYoutubePublishState({ status: 'idle' })") < recapture.indexOf('runSelectedPlayerAction'));
  assert.ok(recapture.indexOf("setAudioPublishState({ status: 'idle' })") < recapture.indexOf('runSelectedPlayerAction'));
  assert.ok(recapture.indexOf('beginPublishTabCaptureStreamId') < recapture.indexOf('runSelectedPlayerAction'));
  const publishAudio = app.slice(app.indexOf('const publishAudioClip'));
  assert.ok(publishAudio.indexOf('beginPublishTabCaptureStreamId') < publishAudio.indexOf('runSelectedPlayerAction'));
  const publishYoutube = app.slice(app.indexOf('const publishYoutubeClip'));
  assert.ok(publishYoutube.indexOf('beginPublishTabCaptureStreamId') < publishYoutube.indexOf('runSelectedPlayerAction'));
  const start = app.slice(app.indexOf('const startHostedCapture'));
  assert.ok(start.indexOf("setYoutubePublishState({ status: 'idle' })") < start.indexOf("setMediaCaptureState({ status: 'preparing'"));
  assert.ok(start.indexOf("setAudioPublishState({ status: 'idle' })") < start.indexOf("setMediaCaptureState({ status: 'preparing'"));
  assert.match(start, /raceHostedCaptureStart/);
  assert.match(start, /mapTabCaptureStartFailure/);
  assert.match(app, /shouldShowCreatePublishError\(youtubePublishState\.status, hostedMediaSession\)/);
  assert.match(app, /shouldShowCreatePublishError\(audioPublishState\.status, hostedMediaSession\)/);
  assert.match(hosted, /shouldShowCreatePublishError/);
});

test('Cancel draft can leave Preparing capture without a live background capture', async () => {
  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const cancel = app.slice(app.indexOf('const cancelHostedMedia'));
  assert.match(cancel, /canClearHostedAttentionWithoutLiveCancel/);
  assert.match(cancel, /hostedCancelClearsLocalAttention/);
  assert.match(cancel, /raceHostedCaptureCancel/);
  assert.match(cancel, /setMediaCaptureState\(\{ status: 'idle' \}\)/);
  assert.match(cancel, /setYoutubePublishState\(\{ status: 'idle' \}\)/);
  assert.match(cancel, /setAudioPublishState\(\{ status: 'idle' \}\)/);
  assert.ok(
    cancel.indexOf('canClearHostedAttentionWithoutLiveCancel') <
      cancel.indexOf('cancelHostedSessionOnServer'),
  );
  assert.ok(
    cancel.indexOf('if (!attentionClear) throw error') <
      cancel.indexOf("setMediaCaptureState({ status: 'idle' })"),
  );
  assert.ok(
    cancel.indexOf('if (!attentionClear && !hostedAttemptTokenIsCurrent') <
      cancel.indexOf("chrome.storage.local.remove(HOSTED_MEDIA_SESSION_KEY)"),
  );
  assert.match(cancel, /isCaptureId\(liveCaptureId\) \? liveCaptureId : null/);
});

test('attention and restore-error snapshots clear locally even without a live recorder', () => {
  assert.equal(hostedCancelClearsLocalAttention({
    status: 'error', captureId: null, code: 'recapture-required',
    message: 'The saved draft has no live capture. Reconnect the original source and choose Recapture, or cancel the draft.',
  }), true);
  assert.equal(hostedCancelClearsLocalAttention({
    status: 'error', captureId: null, code: 'tab-capture-denied',
    message: 'Click the Annotated toolbar icon on this tab, then Recapture.',
  }), true);
  assert.equal(hostedCancelClearsLocalAttention({
    status: 'error', captureId: null, code: 'unexpected',
    message: 'The hosted-media status could not be restored. Recapture or cancel this draft.',
  }), true);
  assert.equal(hostedCancelClearsLocalAttention({ status: 'idle' }), true);
  assert.equal(hostedCancelClearsLocalAttention({ status: 'preparing', captureId: operation.annotationId }), true);
  assert.equal(hostedCancelClearsLocalAttention({ status: 'capturing', captureId: operation.annotationId }), false);
  assert.equal(hostedCancelClearsLocalAttention({
    status: 'error', captureId: operation.annotationId, code: 'upload-failed', message: 'Upload failed.',
  }), false);
});

test('Cancel draft clears the prior source Create draft and rebinds the current tab', async () => {
  assert.deepEqual(hostedCancelCreateReset('video'), {
    clearVideoDraft: true,
    clearAudioDraft: false,
    followActiveTab: true,
    ignoreActiveCaptureHold: true,
  });
  assert.deepEqual(hostedCancelCreateReset('audio'), {
    clearVideoDraft: false,
    clearAudioDraft: true,
    followActiveTab: true,
    ignoreActiveCaptureHold: true,
  });
  assert.deepEqual(hostedForeignOrphanCreateReset(), {
    clearVideoDraft: false,
    clearAudioDraft: false,
    followActiveTab: false,
    ignoreActiveCaptureHold: true,
  });

  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const cancel = app.slice(app.indexOf('const cancelHostedMedia'));
  assert.match(app, /hostedSessionMatchesConnectedUrl\(hostedMediaSession, contextUrl\)/);
  assert.match(app, /foreignSource: !hostedSessionMatchesConnectedUrl/);
  assert.match(cancel, /hostedCancelCreateReset\(session\.mediaType\)/);
  assert.match(cancel, /if \(createReset\.clearVideoDraft\) await clearVideoDraft\(\)/);
  assert.match(cancel, /if \(createReset\.clearAudioDraft\) await clearAudioDraft\(\)/);
  assert.match(cancel, /followActiveBrowsingTab\(chrome,/);
  assert.match(cancel, /ignoreActiveCapture: createReset\.ignoreActiveCaptureHold/);
  assert.match(cancel, /MEDIA_CAPTURE_CANCEL/);
  assert.ok(cancel.indexOf("setMediaCaptureState({ status: 'idle' })") < cancel.indexOf('clearVideoDraft'));
  assert.ok(cancel.indexOf('clearVideoDraft') < cancel.indexOf('followActiveBrowsingTab'));
});

test('mode-switch confirm treats a rebound page after successful cancel as done', async () => {
  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const confirm = app.slice(app.indexOf('const confirmModeSwitch'));
  const afterCancel = confirm.slice(confirm.indexOf('const cancelled = await cancelHostedMedia'));
  assert.match(afterCancel, /if \(!cancelled\) \{/);
  assert.match(
    afterCancel,
    /The hosted-media operation was not cancelled, so the mode did not change\./,
  );
  assert.doesNotMatch(
    afterCancel,
    /if \(!cancelled \|\| !current \|\| !modeSwitchIntentIsCurrent/,
  );
  assert.match(
    afterCancel,
    /if \(!current \|\| !modeSwitchIntentIsCurrent\(intent, current\.page, current\.selectedMode\)\) \{\s*return;/,
  );
});

test('persists only safe hosted-media restoration identifiers', () => {
  assert.equal(isHostedMediaSession(session), true);
  assert.equal(JSON.stringify(session).includes('accessToken'), false);
  assert.equal(isHostedMediaSession({ ...session, operation: { ...operation, mediaId: 'bad' } }), false);
  assert.equal(isHostedMediaSession({ ...session, endMs: 95_001 }), false);
});

test('parses sanitized processing/queued owner status', () => {
  assert.deepEqual(parseOwnedHostedMediaStatus([{
    annotation_id: operation.annotationId,
    media_id: operation.mediaId,
    media_type: 'video',
    processing_status: 'processing',
    processing_stage: 'queued',
    failure_stage: null,
    failure_code: null,
    creator_handle: 'creator',
    annotation_slug: 'clip-11111111',
  }]), {
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
    mediaType: 'video',
    processingStatus: 'processing',
    processingStage: 'queued',
    failureStage: null,
    failureCode: null,
    creatorHandle: 'creator',
    annotationSlug: 'clip-11111111',
  });
});

test('parses failed owner status with failure stage and code', () => {
  assert.deepEqual(parseOwnedHostedMediaStatus({
    annotation_id: operation.annotationId,
    media_id: operation.mediaId,
    media_type: 'video',
    processing_status: 'failed',
    processing_stage: 'transcoding',
    failure_stage: 'transcoding',
    failure_code: 'unsafe_geometry',
    creator_handle: 'creator',
    annotation_slug: 'clip-11111111',
  }), {
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
    mediaType: 'video',
    processingStatus: 'failed',
    processingStage: 'transcoding',
    failureStage: 'transcoding',
    failureCode: 'unsafe_geometry',
    creatorHandle: 'creator',
    annotationSlug: 'clip-11111111',
  });
});

test('owner status rejects raw paths and malformed lifecycle rows', () => {
  assert.throws(() => parseOwnedHostedMediaStatus({
    annotation_id: operation.annotationId,
    media_id: operation.mediaId,
    media_type: 'video',
    processing_status: 'uploading',
    creator_handle: null,
    annotation_slug: 'clip',
    raw_storage_path: 'secret',
  }), /unavailable/);
});

test('cancel failures consume bounded JSON and retain a safe fallback for malformed responses', async () => {
  assert.match(await getHostedMediaCancelError(Response.json({ error: 'MEDIA_NOT_CANCELLABLE' }, { status: 409 })), /current state/);
  assert.equal(await getHostedMediaCancelError(new Response(null, { status: 400 })), 'The hosted-media draft could not be cancelled.');
});

test('completion success is not Processing while owner status remains capture_pending', () => {
  const result = reconcileHostedMediaState(session, ownedStatus('capture_pending'), {
    status: 'verifying-upload',
    captureId: 'capture-current',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  }, operation);
  assert.equal(result.action, 'show');
  assert.equal(result.snapshot.status, 'error');
  assert.notEqual(result.snapshot.status, 'processing');
});

test('authoritative processing status keeps Processing UI for any worker stage', () => {
  for (const [status, stage] of [
    ['capture_pending', null], ['uploading', null], ['failed', null],
  ]) {
    const result = reconcileHostedMediaState(session, ownedStatus(status, stage), null, null);
    assert.equal(result.action, 'show');
    assert.notEqual(result.snapshot.status, 'processing', `${status}/${stage} must not show Processing`);
  }
  for (const stage of ['queued', 'probing', null]) {
    const processing = reconcileHostedMediaState(session, ownedStatus('processing', stage), null, null);
    assert.equal(processing.action, 'show');
    assert.deepEqual(processing.snapshot, {
      status: 'processing',
      captureId: 'restored',
      annotationId: operation.annotationId,
      mediaId: operation.mediaId,
      processingStage: stage,
    });
  }
});

test('Create progress copy is stage-aware and keeps Posted for ready only', () => {
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: true,
    snapshot: { status: 'processing', captureId: 'restored', annotationId: operation.annotationId, mediaId: operation.mediaId, processingStage: 'queued' },
  }), { title: 'Cancelling draft…', detail: null, busy: true });
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    snapshot: { status: 'capturing', captureId: 'capture-current' },
  }), { title: 'Capturing clip…', detail: null, busy: true });
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    snapshot: { status: 'uploading', captureId: 'capture-current', progress: 42 },
  }), { title: 'Uploading clip… 42%', detail: null, busy: true });
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    snapshot: {
      status: 'processing',
      captureId: 'restored',
      annotationId: operation.annotationId,
      mediaId: operation.mediaId,
      processingStage: 'queued',
    },
  }), {
    title: 'Uploaded and queued',
    detail: 'Waiting for processing to start.',
    busy: true,
  });
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    snapshot: {
      status: 'processing',
      captureId: 'restored',
      annotationId: operation.annotationId,
      mediaId: operation.mediaId,
    },
  }), {
    title: 'Uploaded and queued',
    detail: 'Waiting for processing to start.',
    busy: true,
  });
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    snapshot: {
      status: 'processing',
      captureId: 'restored',
      annotationId: operation.annotationId,
      mediaId: operation.mediaId,
      processingStage: 'transcoding',
    },
  }), {
    title: 'Processing clip',
    detail: 'Creating the playable clip.',
    busy: true,
  });
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    snapshot: {
      status: 'processing',
      captureId: 'restored',
      annotationId: operation.annotationId,
      mediaId: operation.mediaId,
      processingStage: 'transcribing',
    },
  }), {
    title: 'Processing clip',
    detail: 'Transcribing the excerpt.',
    busy: true,
  });
  assert.equal(hostedMediaProcessingStageDetail('probing'), 'Checking the captured clip.');
  assert.equal(hostedMediaProcessingStageDetail('finalizing'), 'Finishing the clip.');
  const attention = hostedMediaProgressCopy({
    cancelling: false,
    snapshot: {
      status: 'error',
      captureId: null,
      code: 'recapture-required',
      message: 'The saved draft has no live capture. Reconnect the original source and choose Recapture, or cancel the draft.',
    },
  });
  assert.equal(attention.title, 'Capture needs attention');
  assert.equal(attention.busy, false);
  assert.match(attention.detail, /Recapture/);
  assert.equal(hostedSessionMatchesConnectedUrl(session, session.sourceUrl), true);
  assert.equal(hostedSessionMatchesConnectedUrl(
    session,
    'https://podcasts.apple.com/us/podcast/example/id1234567890?i=1000123456789',
  ), false);
  assert.deepEqual(hostedMediaProgressCopy({
    cancelling: false,
    foreignSource: true,
    snapshot: {
      status: 'processing',
      captureId: 'restored',
      annotationId: operation.annotationId,
      mediaId: operation.mediaId,
      processingStage: 'queued',
    },
  }), {
    title: 'Uploaded and queued',
    detail: HOSTED_FOREIGN_SOURCE_CANCEL_DETAIL,
    busy: true,
  });
  const ready = reconcileHostedMediaState(session, ownedStatus('ready', 'published'), null, null);
  assert.equal(ready.action, 'posted');
});

test('failed owner status surfaces failure stage and code in Capture needs attention', () => {
  assert.equal(
    hostedMediaFailedStatusDetail('transcoding', 'unsafe_geometry'),
    'Processing failed during transcoding (unsafe_geometry). The clip could not be framed from this capture. Recapture with the player fully visible, or cancel the draft.',
  );
  assert.equal(
    hostedMediaFailedStatusDetail('transcoding', 'capture_changed'),
    'Processing failed during transcoding (capture_changed). The window or player changed during capture. Do not resize or zoom the window during capture, then Recapture.',
  );
  assert.equal(
    hostedMediaFailedStatusDetail('transcoding', 'player_not_visible'),
    'Processing failed during transcoding (player_not_visible). The player was not fully inside the window. Keep it fully visible, then Recapture.',
  );
  assert.equal(
    hostedMediaFailedStatusDetail('probing', 'mystery_code'),
    'Processing failed during probing (mystery_code). Reconnect the original source and choose Recapture, or cancel the draft.',
  );
  assert.equal(
    hostedMediaFailedStatusDetail(null, null),
    'Capture failed. Reconnect the original source and choose Recapture, or cancel the draft.',
  );

  const failed = reconcileHostedMediaState(
    session,
    ownedStatus('failed', null, 'transcoding', 'unsafe_geometry'),
    { status: 'processing', captureId: 'restored', annotationId: operation.annotationId, mediaId: operation.mediaId, processingStage: 'transcoding' },
    operation,
  );
  assert.equal(failed.action, 'show');
  assert.equal(failed.snapshot.status, 'error');
  assert.equal(failed.snapshot.code, 'recapture-required');
  assert.equal(
    failed.snapshot.message,
    'Processing failed during transcoding (unsafe_geometry). The clip could not be framed from this capture. Recapture with the player fully visible, or cancel the draft.',
  );
  const attention = hostedMediaProgressCopy({ cancelling: false, snapshot: failed.snapshot });
  assert.equal(attention.title, 'Capture needs attention');
  assert.equal(attention.busy, false);
  assert.equal(attention.detail, failed.snapshot.message);
  assert.equal(shouldOfferHostedRecapture(session, session.sourceUrl, failed.snapshot), true);

  const unknown = reconcileHostedMediaState(
    session,
    ownedStatus('failed', null, 'transcribing', 'unexpected_provider_code'),
    null,
    null,
  );
  assert.equal(unknown.action, 'show');
  assert.match(unknown.snapshot.message, /Processing failed during transcribing \(unexpected_provider_code\)\./);
  assert.match(unknown.snapshot.message, /Recapture/);
  assert.doesNotMatch(unknown.snapshot.message, /^Capture failed\. Reconnect/);
});

const applePodcastsUrl =
  'https://podcasts.apple.com/us/podcast/classical-music-is-in-crisis-gustavo-dudamel-is-here/id1200361736?i=1000720000';
const orphanedRecaptureSnapshot = {
  status: 'error',
  captureId: null,
  code: 'recapture-required',
  message: 'The saved draft has no live capture. Reconnect the original source and choose Recapture, or cancel the draft.',
};
const processingSnapshot = {
  status: 'processing',
  captureId: 'restored',
  annotationId: operation.annotationId,
  mediaId: operation.mediaId,
  processingStage: 'queued',
};

test('YouTube→Apple Create auto-abandons an orphaned draft and never offers Recapture', () => {
  assert.equal(hostedDraftIsOrphanedAttention(orphanedRecaptureSnapshot), true);
  assert.equal(hostedDraftIsOrphanedAttention({ status: 'idle' }), true);
  assert.equal(hostedDraftIsOrphanedAttention({
    status: 'cancelled', captureId: 'capture-1', code: 'connected-source-changed',
    message: 'The connected source changed during capture.',
  }), true);
  assert.equal(hostedDraftIsOrphanedAttention(processingSnapshot), false);
  assert.equal(hostedDraftIsOrphanedAttention({
    status: 'verifying-upload',
    captureId: 'capture-1',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  }), false);
  assert.equal(hostedDraftIsOrphanedAttention({
    status: 'capturing', captureId: 'capture-1',
  }), false);
  assert.equal(hostedDraftIsOrphanedAttention({
    status: 'error', captureId: 'capture-1', code: 'upload-failed', message: 'Upload failed.',
  }), false);

  assert.equal(hostedDraftIsForeignLiveWork({ status: 'capturing', captureId: 'capture-1' }), true);
  assert.equal(hostedDraftIsForeignLiveWork({ status: 'preparing', captureId: 'capture-1' }), true);
  assert.equal(hostedDraftIsForeignLiveWork(orphanedRecaptureSnapshot), true);
  assert.equal(hostedDraftIsForeignLiveWork(processingSnapshot), false);
  assert.equal(hostedDraftIsForeignLiveWork({
    status: 'uploading', captureId: 'capture-1', progress: 10,
  }), false);

  assert.equal(shouldAutoAbandonForeignHostedDraft(session, applePodcastsUrl, orphanedRecaptureSnapshot), true);
  assert.equal(shouldAutoAbandonForeignHostedDraft(session, applePodcastsUrl, {
    status: 'capturing', captureId: 'capture-1',
  }), true);
  assert.equal(shouldAutoAbandonForeignHostedDraft(session, applePodcastsUrl, {
    status: 'preparing', captureId: 'capture-1',
  }), true);
  assert.equal(shouldAutoAbandonForeignHostedDraft(session, session.sourceUrl, orphanedRecaptureSnapshot), false);
  assert.equal(shouldAutoAbandonForeignHostedDraft(session, applePodcastsUrl, processingSnapshot), false);
  assert.equal(shouldAutoAbandonForeignHostedDraft(null, applePodcastsUrl, orphanedRecaptureSnapshot), false);
  assert.equal(shouldAutoAbandonForeignHostedDraft(session, null, orphanedRecaptureSnapshot), false);

  assert.equal(hostedSessionBlocksCreatePublish(session, applePodcastsUrl, orphanedRecaptureSnapshot), false);
  assert.equal(hostedSessionBlocksCreatePublish(session, session.sourceUrl, orphanedRecaptureSnapshot), false);
  assert.equal(hostedSessionBlocksCreatePublish(session, applePodcastsUrl, processingSnapshot), true);
  assert.equal(hostedSessionBlocksCreatePublish(null, applePodcastsUrl, orphanedRecaptureSnapshot), false);

  assert.equal(shouldOfferHostedRecapture(session, session.sourceUrl, orphanedRecaptureSnapshot), true);
  assert.equal(shouldOfferHostedRecapture(session, applePodcastsUrl, orphanedRecaptureSnapshot), false);
  assert.equal(shouldOfferHostedRecapture(session, session.sourceUrl, processingSnapshot), false);
  assert.equal(shouldOfferHostedRecapture(session, applePodcastsUrl, processingSnapshot), false);
  assert.equal(shouldOfferHostedRecapture(session, session.sourceUrl, {
    status: 'error', captureId: null, code: 'raw-capture-unavailable', message: 'Gone.',
  }), false);

  const foreignAttention = hostedMediaProgressCopy({
    cancelling: false,
    foreignSource: true,
    snapshot: orphanedRecaptureSnapshot,
  });
  assert.equal(foreignAttention.title, 'Capture needs attention');
  assert.equal(foreignAttention.detail, HOSTED_FOREIGN_SOURCE_CANCEL_DETAIL);
  assert.doesNotMatch(foreignAttention.detail, /Reconnect the original source/);
});

test('Create rebinds YouTube→Apple without Recapture and publishes after auto-abandon', async () => {
  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /shouldAutoAbandonForeignHostedDraft\(/);
  assert.match(app, /shouldOfferHostedRecapture\(hostedMediaSession, contextUrl, mediaCaptureState\)/);
  assert.match(app, /hostedSessionBlocksCreatePublish\(hostedMediaSession, contextUrl, mediaCaptureState\)/);
  assert.match(app, /hostedForeignOrphanCreateReset\(\)/);
  assert.match(app, /abandonOrphanedHostedDraftForPublish\(/);
  assert.match(app, /hostedPublishAbandonDecision\(/);
  assert.match(app, /void cancelHostedMedia\(undefined, hostedForeignOrphanCreateReset\(\)\)/);
  assert.match(app, /foreignAbandonAttemptKeyRef/);
  assert.match(app, /foreignAbandonAttemptKeyRef\.current = null/);
  assert.match(app, /rollbackFailedHostedCaptureStart\(/);
  assert.match(app, /rollbackOnStartFailure: true/);
  assert.match(app, /hostedSessionGenerationRef/);
  assert.match(app, /shouldRollbackHostedDraftAfterStartFailure/);
  assert.doesNotMatch(app, /hostedMediaSession === null &&/);

  const recapture = app.slice(app.indexOf('const recaptureHostedMedia'));
  assert.ok(
    recapture.indexOf('shouldOfferHostedRecapture') <
      recapture.indexOf("setYoutubePublishState({ status: 'idle' })"),
  );
  assert.doesNotMatch(recapture, /rollbackOnStartFailure: true/);

  for (const name of [
    'publishYoutubeClip',
    'publishTikTokClip',
    'publishWebpageVideoClip',
    'publishSpotifyClip',
    'publishAudioClip',
  ]) {
    const publish = app.slice(app.indexOf(`const ${name}`));
    const nextFn = [
      'publishTikTokClip',
      'publishWebpageVideoClip',
      'publishSpotifyClip',
      'publishAudioClip',
      'applyHostedReconciliation',
    ][['publishYoutubeClip', 'publishTikTokClip', 'publishWebpageVideoClip', 'publishSpotifyClip', 'publishAudioClip'].indexOf(name)];
    const body = nextFn ? publish.slice(0, publish.indexOf(`const ${nextFn}`)) : publish;
    const streamId = body.indexOf('beginPublishTabCaptureStreamId');
    const abandon = body.indexOf('abandonOrphanedHostedDraftForPublish');
    const begin = body.search(/beginHosted(?:YouTube|TikTok|WebpageVideo|Spotify|Audio)/);
    const rollback = body.indexOf('rollbackOnStartFailure: true');
    assert.ok(streamId >= 0, `${name} must mint a caller stream ID`);
    assert.ok(abandon >= 0, `${name} must abandon an orphaned draft`);
    assert.ok(streamId < abandon, `${name} must mint the stream ID before abandon`);
    assert.ok(abandon < begin || begin < 0, `${name} must abandon before hosted begin`);
    assert.ok(rollback >= 0, `${name} must roll back a failed begin/start`);
    assert.ok(begin < rollback || begin < 0, `${name} must begin before start rollback option`);
  }
});

test('Publish clip re-arm of playhead/duration does not treat the draft as changed', async () => {
  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const names = [
    ['publishYoutubeClip', 'publishTikTokClip'],
    ['publishTikTokClip', 'publishWebpageVideoClip'],
    ['publishWebpageVideoClip', 'publishSpotifyClip'],
    ['publishSpotifyClip', 'publishAudioClip'],
    ['publishAudioClip', 'applyHostedReconciliation'],
  ];
  for (const [name, nextFn] of names) {
    const body = app.slice(app.indexOf(`const ${name}`), app.indexOf(`const ${nextFn}`));
    const tokenMint = body.indexOf('getPlayerActionToken');
    const staleCopy = body.includes('The Video page, player, or draft changed')
      ? 'The Video page, player, or draft changed'
      : 'The Audio page, player, or draft changed';
    const staleAfterBegin = body.indexOf(staleCopy);
    assert.ok(tokenMint >= 0, `${name} mints a player token`);
    assert.ok(staleAfterBegin >= 0, `${name} still cancels a truly stale hosted begin`);
    const window = body.slice(tokenMint, staleAfterBegin);
    const patches = [...window.matchAll(/type: 'patch-media'[\s\S]*?patch: \{([^}]+)\}/g)];
    for (const match of patches) {
      const keys = [...match[1].matchAll(/(\w+):/g)].map((row) => row[1]).sort();
      assert.deepEqual(
        keys,
        ['durationMs', 'playerTimeMs'],
        `${name} publish-path patch-media must be clock-only so revision does not invalidate the token`,
      );
    }
    if (name === 'publishYoutubeClip') {
      assert.equal(patches.length, 1, 'YouTube publish still re-arms duration/playhead before begin');
      assert.match(body, /if \(player\.adShowing\) throw new Error\(YOUTUBE_AD_BLOCKED_COPY\)/);
      assert.match(body, /youtubeClipRangeAfterAdCleared/);
      assert.match(body, /if \(youtubeAdShowing\) \{/);
      assert.match(body, /await cancelStaleHostedBegin\(/);
    } else {
      assert.equal(
        patches.length,
        0,
        `${name} must not patch-media between token mint and stale begin check`,
      );
      assert.match(body, /await cancelStaleHostedBegin\(/);
    }
  }
});

test('Publish abandons same-host capture_pending orphans and proceeds when nothing is left', () => {
  assert.equal(
    shouldAbandonOrphanedHostedDraftForPublish(session, applePodcastsUrl, orphanedRecaptureSnapshot),
    true,
  );
  assert.equal(
    shouldAbandonOrphanedHostedDraftForPublish(session, session.sourceUrl, orphanedRecaptureSnapshot),
    true,
  );
  assert.equal(
    shouldAbandonOrphanedHostedDraftForPublish(session, applePodcastsUrl, processingSnapshot),
    false,
  );
  assert.equal(
    shouldAbandonOrphanedHostedDraftForPublish(null, applePodcastsUrl, orphanedRecaptureSnapshot),
    false,
  );

  assert.equal(
    hostedPublishAbandonDecision(null, applePodcastsUrl, orphanedRecaptureSnapshot),
    'proceed',
  );
  assert.equal(
    hostedPublishAbandonDecision(session, applePodcastsUrl, orphanedRecaptureSnapshot),
    'abandon',
  );
  assert.equal(
    hostedPublishAbandonDecision(session, session.sourceUrl, orphanedRecaptureSnapshot),
    'abandon',
  );
  assert.equal(
    hostedPublishAbandonDecision(session, applePodcastsUrl, processingSnapshot),
    'block',
  );
  assert.equal(
    hostedPublishAbandonDecision(session, session.sourceUrl, {
      status: 'capturing', captureId: 'capture-1',
    }),
    'block',
  );
  assert.equal(
    hostedPublishAbandonDecision(session, applePodcastsUrl, {
      status: 'capturing', captureId: 'capture-1',
    }),
    'abandon',
  );
  assert.equal(
    hostedPublishAbandonDecision(session, applePodcastsUrl, {
      status: 'uploading', captureId: 'capture-1', progress: 10,
    }),
    'block',
  );
});

test('failed Apple begin/start rolls back capture_pending instead of offering Recapture', () => {
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'error', captureId: 'cap-1', code: 'unexpected',
    message: 'The connected media capture could not start.',
  }), true);
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'error', captureId: 'cap-1', code: 'tab-capture-denied',
    message: 'Click the Annotated toolbar icon on this tab, then Recapture.',
  }), true);
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'error', captureId: null, code: 'recapture-required',
    message: 'The saved draft has no live capture. Reconnect the original source and choose Recapture, or cancel the draft.',
  }), true);
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'cancelled', captureId: 'cap-1', code: 'unexpected',
    message: 'Capture cancelled before start.',
  }), true);
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'error', captureId: 'cap-1', code: 'upload-failed', message: 'Upload failed.',
  }), false);
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'error', captureId: null, code: 'raw-capture-unavailable', message: 'Gone.',
  }), false);
  assert.equal(shouldRollbackHostedDraftAfterStartFailure({
    status: 'capturing', captureId: 'cap-1',
  }), false);

  const appleSession = {
    ...session,
    sourceUrl: applePodcastsUrl,
    mediaType: 'audio',
  };
  assert.equal(shouldOfferHostedRecapture(appleSession, applePodcastsUrl, orphanedRecaptureSnapshot), true);
  assert.equal(shouldOfferHostedRecapture(session, applePodcastsUrl, orphanedRecaptureSnapshot), false);
});

test('YouTube in-flight tab-switch Cancel then Apple Publish stays a clean first capture', async () => {
  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  const cancel = app.slice(app.indexOf('const cancelHostedMedia'));
  assert.match(cancel, /MEDIA_CAPTURE_CANCEL/);
  assert.match(cancel, /hostedSessionGenerationRef\.current \+= 1/);
  assert.match(cancel, /followActiveBrowsingTab\(chrome,/);
  assert.match(cancel, /ignoreActiveCapture: createReset\.ignoreActiveCaptureHold/);
  assert.ok(
    cancel.indexOf('MEDIA_CAPTURE_CANCEL') < cancel.indexOf('cancelHostedSessionOnServer'),
    'Cancel must release tabCapture/offscreen before the server draft',
  );

  const rollback = app.slice(app.indexOf('const rollbackFailedHostedCaptureStart'));
  assert.match(rollback, /MEDIA_CAPTURE_CANCEL/);
  assert.match(rollback, /cancelHostedSessionOnServer\(session\)/);
  assert.match(rollback, /MEDIA_CAPTURE_OFFSCREEN_RELEASE_HOLD/);
  assert.match(rollback, /setMediaCaptureState\(\{ status: 'idle' \}\)/);
  assert.doesNotMatch(rollback.slice(0, rollback.indexOf('const startHostedCapture')), /clearVideoDraft|clearAudioDraft/);

  const start = app.slice(app.indexOf('const startHostedCapture'));
  assert.match(start, /hostedSessionGenerationRef\.current !== sessionGeneration/);
  assert.match(start, /rollbackOnStartFailure/);
  assert.match(start, /rollbackFailedHostedCaptureStart\(session, captureId\)/);
  assert.ok(
    start.indexOf('chrome.storage.local.set') <
      start.indexOf('hostedSessionGenerationRef.current !== sessionGeneration'),
    'A cancelled start must not persist the draft after Cancel',
  );

  const audioPublish = app.slice(app.indexOf('const publishAudioClip'));
  assert.match(audioPublish, /beginPublishTabCaptureStreamId\(false\)/);
  assert.match(audioPublish, /abandonOrphanedHostedDraftForPublish/);
  assert.match(audioPublish, /rollbackOnStartFailure: true/);
  assert.ok(
    audioPublish.indexOf('beginPublishTabCaptureStreamId') <
      audioPublish.indexOf('abandonOrphanedHostedDraftForPublish'),
  );

  const beginStream = app.slice(app.indexOf('const beginPublishTabCaptureStreamId'));
  assert.match(beginStream, /rebindSidePanelToTabFromUserGesture/);
  assert.match(beginStream, /holdPublishTabCaptureStream/);
  assert.ok(
    beginStream.indexOf('beginTabCaptureStreamIdFromUserGesture') <
      beginStream.indexOf('rebindSidePanelToTabFromUserGesture'),
    'Publish must start getMediaStreamId before sidePanel.open can consume the gesture',
  );
  assert.ok(
    beginStream.indexOf('beginTabCaptureStreamIdFromUserGesture') <
      beginStream.indexOf('holdPublishTabCaptureStream'),
  );

  const abandonEffect = app.slice(app.indexOf('if (foreignAbandonAttemptKeyRef.current === attemptKey)'));
  assert.match(
    abandonEffect,
    /foreignAbandonAttemptKeyRef\.current = null/,
  );
});

test('ready owner status becomes Posted with a handle/slug detail path', () => {
  const result = reconcileHostedMediaState(session, ownedStatus('ready', 'published'), null, null);
  assert.equal(result.action, 'posted');
  assert.deepEqual(result.confirmation, {
    annotationId: operation.annotationId,
    kind: 'video',
    publicPath: '/creator/clip-11111111',
  });
  const removed = reconcileHostedMediaState(session, ownedStatus('removed'), null, null);
  assert.equal(removed.action, 'clear');
});

test('live verifying-upload is kept while owner status is still uploading', () => {
  const live = {
    status: 'verifying-upload',
    captureId: 'capture-current',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  };
  const result = reconcileHostedMediaState(session, ownedStatus('uploading'), live, operation);
  assert.equal(result.action, 'show');
  assert.deepEqual(result.snapshot, live);
});

test('Processing and verifying-upload snapshots keep polling owner status', () => {
  assert.equal(shouldPollHostedOwnerStatus({
    status: 'processing',
    captureId: 'restored',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  }), true);
  assert.equal(shouldPollHostedOwnerStatus({
    status: 'verifying-upload',
    captureId: 'capture-current',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  }), true);
  assert.equal(shouldPollHostedOwnerStatus({ status: 'idle' }), false);
  assert.equal(shouldPollHostedOwnerStatus({
    status: 'error', captureId: null, code: 'recapture-required', message: 'Recapture',
  }), false);
});

test('stale live snapshots cannot override the current authoritative operation', () => {
  const staleOperation = { ...operation, mediaId: '33333333-3333-4333-8333-333333333333' };
  const result = reconcileHostedMediaState(session, ownedStatus('capture_pending'), {
    status: 'uploading', captureId: 'stale', progress: 100,
  }, staleOperation);
  assert.equal(result.action, 'show');
  assert.equal(result.snapshot.status, 'error');
  assert.equal(result.snapshot.code, 'recapture-required');
});

test('browser restart restores capture_pending as intentional Recapture/Cancel recovery', () => {
  const result = reconcileHostedMediaState(session, ownedStatus('capture_pending'), { status: 'idle' }, null);
  assert.equal(result.action, 'show');
  assert.equal(result.snapshot.status, 'error');
  assert.equal(result.snapshot.code, 'recapture-required');
  assert.match(result.snapshot.message, /Recapture/);
  assert.match(result.snapshot.message, /cancel/);
});

test('missing offscreen Blob after restart is explicit for an uploading row', () => {
  const result = reconcileHostedMediaState(session, ownedStatus('uploading'), { status: 'idle' }, null);
  assert.equal(result.action, 'show');
  assert.equal(result.snapshot.status, 'error');
  assert.equal(result.snapshot.code, 'raw-capture-unavailable');
});

test('source-change and tab-close cancellation snapshots become actionable errors', () => {
  for (const [code, message] of [
    ['connected-source-changed', 'The connected source changed during capture.'],
    ['connected-tab-closed', 'The connected tab closed during capture.'],
  ]) {
    const result = presentHostedMediaSnapshot({
      status: 'cancelled', captureId: 'capture-current', code, message,
    });
    assert.equal(result.status, 'error');
    assert.equal(result.code, code);
    assert.equal(result.message, message);
  }
  assert.equal(presentHostedMediaSnapshot({
    status: 'cancelled', captureId: 'capture-current', code: 'unexpected', message: 'Cancelled.',
  }).status, 'cancelled');
});

test('local recorder completion remains verification until owner status is authoritative', () => {
  assert.deepEqual(presentHostedMediaSnapshot({
    status: 'processing',
    captureId: 'capture-current',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  }), {
    status: 'verifying-upload',
    captureId: 'capture-current',
    annotationId: operation.annotationId,
    mediaId: operation.mediaId,
  });
});

test('capture_pending cancellation is owner-scoped, needs no server callback, and confirms removed', async () => {
  const calls = [];
  const client = {
    async rpc(name) {
      calls.push(name);
      if (name === 'get_owned_annotation_media_status') {
        const status = calls.filter((value) => value === name).length === 1 ? 'capture_pending' : 'removed';
        return { data: [{
          annotation_id: operation.annotationId, media_id: operation.mediaId, media_type: 'video',
          processing_status: status, processing_stage: null, failure_stage: null, failure_code: null,
          creator_handle: 'creator', annotation_slug: 'clip-11111111',
        }], error: null };
      }
      assert.equal(name, 'cancel_hosted_media_annotation');
      return { data: true, error: null };
    },
  };
  let laterCalls = 0;
  const result = await cancelOwnedHostedMedia(client, session, async () => { laterCalls += 1; });
  assert.equal(result.processingStatus, 'removed');
  assert.equal(laterCalls, 0);
  assert.deepEqual(calls, [
    'get_owned_annotation_media_status',
    'cancel_hosted_media_annotation',
    'get_owned_annotation_media_status',
  ]);
});

test('cancellation fails closed when owner-visible removed state is not confirmed', async () => {
  const row = {
    annotation_id: operation.annotationId, media_id: operation.mediaId, media_type: 'video',
    processing_status: 'capture_pending', processing_stage: null, failure_stage: null, failure_code: null,
    creator_handle: 'creator', annotation_slug: 'clip-11111111',
  };
  const client = {
    async rpc(name) {
      return name === 'cancel_hosted_media_annotation'
        ? { data: true, error: null }
        : { data: [row], error: null };
    },
  };
  await assert.rejects(cancelOwnedHostedMedia(client, session, async () => undefined), /not confirmed/);
});

test('side-panel production wiring gates Processing and persists only recovery identifiers locally', async () => {
  const app = await readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /presentHostedMediaSnapshot\(event\.snapshot\)/);
  assert.match(app, /reconcileHostedMediaState\(/);
  assert.match(app, /chrome\.storage\.local\.set\(\{ \[HOSTED_MEDIA_SESSION_KEY\]: session \}\)/);
  assert.match(app, /cancelOwnedHostedMedia\(/);
  assert.match(app, /chrome\.storage\.local\.remove\(HOSTED_MEDIA_SESSION_KEY\)/);
  assert.match(app, /cancellingHostedMediaRef\.current/);
  assert.match(app, /The hosted-media status could not be restored\. Recapture or cancel this draft\./);
  assert.match(app, /adoptActiveTabContextFromLiveTab\(context, freshTab\)/);
  assert.match(app, /if \(!activeCaptureIdRef\.current\) activeCaptureIdRef\.current = captureId;/);
  assert.match(app, /The raw clip is no longer available\. Recapture or cancel this draft\./);
  assert.match(app, /applyHostedReconciliation\(/);
  assert.match(app, /shouldPollHostedOwnerStatus\(mediaCaptureState\)/);
  assert.match(app, /HOSTED_MEDIA_OWNER_STATUS_POLL_MS/);
  assert.match(app, /<CreatePostedPanel/);
  assert.match(app, /createAnotherAnnotation/);
  assert.doesNotMatch(app, /getPostPublishNavigation/);
  const restore = app.slice(app.indexOf('const result = reconcileHostedMediaState('));
  const restoreCatch = restore.slice(0, restore.indexOf('useEffect(() => {', restore.indexOf('.catch(() => {')));
  assert.ok(restoreCatch.includes("if (!current || cancellingHostedMediaRef.current) return;"));
  assert.ok(restoreCatch.includes("code: 'recapture-required'"));
});
