import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  advanceModeRevision,
  createInitialDraftState,
  createInitialModeCapabilities,
  createInitialModeRevisions,
  createModeAsyncToken,
  createModeSelectionState,
  getRecommendedMode,
  isModeAsyncTokenCurrent,
  moveSelectionToPage,
  reduceCreateDraftState,
  selectCreateMode,
  updateModeCapabilities,
  updatePageGeneration,
} from './create-mode.ts';

const IDENTITY = { tabId: 42, windowId: 7, sourceKey: 'https://example.test/article' };

function capabilities({ text = 'available', video = 'unavailable', audio = 'unavailable' } = {}) {
  return {
    text: text === 'unavailable' ? { status: text, reason: 'Text unavailable' } : { status: text },
    video: video === 'unavailable' ? { status: video, reason: 'Video unavailable' } : { status: video },
    audio: audio === 'unavailable' ? { status: audio, reason: 'Audio unavailable' } : { status: audio },
  };
}

test('recommendation is deterministic and independent from simultaneous availability', () => {
  assert.deepEqual(createInitialModeCapabilities(), {
    text: { status: 'checking' },
    video: { status: 'checking' },
    audio: { status: 'checking' },
  });
  assert.equal(getRecommendedMode(capabilities()), 'text');
  assert.equal(getRecommendedMode(capabilities({ audio: 'available' })), 'audio');
  assert.equal(getRecommendedMode(capabilities({ video: 'available', audio: 'available' })), 'video');
  assert.equal(getRecommendedMode(capabilities({ text: 'unavailable' })), null);
  assert.throws(() => getRecommendedMode({
    ...capabilities(),
    audio: { status: 'unavailable', reason: 'x'.repeat(161) },
  }));
});

test('an explicit supported selection survives recommendation changes and checking states', () => {
  const page = updatePageGeneration(null, IDENTITY);
  let state = createModeSelectionState(page, capabilities({ audio: 'available' }));
  assert.equal(state.selectedMode, 'audio');
  state = selectCreateMode(state, 'text');
  assert.equal(state.selectedBy, 'explicit');
  state = updateModeCapabilities(state, capabilities({ video: 'available', audio: 'available' }));
  assert.equal(state.recommendedMode, 'video');
  assert.equal(state.selectedMode, 'text');
  state = updateModeCapabilities(state, capabilities({ text: 'checking', video: 'available' }));
  assert.equal(state.selectedMode, 'text');
});

test('an unavailable explicit selection falls back without deleting another capability', () => {
  const page = updatePageGeneration(null, IDENTITY);
  let state = createModeSelectionState(page, capabilities({ audio: 'available' }));
  state = selectCreateMode(state, 'text');
  state = updateModeCapabilities(state, capabilities({ text: 'unavailable', audio: 'available' }));
  assert.equal(state.selectedMode, 'audio');
  assert.equal(state.selectedBy, 'automatic');
  assert.equal(state.capabilities.text.status, 'unavailable');
});

test('page generations are stable for one identity and advance on tab, window, or source change', () => {
  const first = updatePageGeneration(null, IDENTITY);
  assert.equal(first.generation, 1);
  assert.equal(updatePageGeneration(first, { ...IDENTITY }), first);
  const sourceChanged = updatePageGeneration(first, { ...IDENTITY, sourceKey: 'https://example.test/other' });
  assert.equal(sourceChanged.generation, 2);
  assert.equal(updatePageGeneration(sourceChanged, { ...sourceChanged.identity, tabId: 43 }).generation, 3);
  assert.throws(() => updatePageGeneration(null, { ...IDENTITY, sourceKey: ' ' }));
});

test('selection resets to an advisory recommendation only when the page generation changes', () => {
  const first = updatePageGeneration(null, IDENTITY);
  let state = selectCreateMode(
    createModeSelectionState(first, capabilities({ audio: 'available' })),
    'text',
  );
  state = moveSelectionToPage(state, first, capabilities({ video: 'available', audio: 'available' }));
  assert.equal(state.selectedMode, 'text');
  const next = updatePageGeneration(first, { ...IDENTITY, sourceKey: 'https://example.test/next' });
  state = moveSelectionToPage(state, next, capabilities({ video: 'available', audio: 'available' }));
  assert.equal(state.selectedMode, 'video');
  assert.equal(state.selectedBy, 'automatic');
});

test('mode revisions and page generations reject stale asynchronous results', () => {
  const first = updatePageGeneration(null, IDENTITY);
  let revisions = createInitialModeRevisions();
  const token = createModeAsyncToken(first, revisions, 'audio');
  assert.equal(isModeAsyncTokenCurrent(token, first, revisions), true);
  revisions = advanceModeRevision(revisions, 'video');
  assert.equal(isModeAsyncTokenCurrent(token, first, revisions), true);
  revisions = advanceModeRevision(revisions, 'audio');
  assert.equal(isModeAsyncTokenCurrent(token, first, revisions), false);
  const next = updatePageGeneration(first, { ...IDENTITY, sourceKey: 'https://example.test/next' });
  assert.equal(isModeAsyncTokenCurrent(createModeAsyncToken(first, revisions, 'text'), next, revisions), false);
});

test('Text, Video, and Audio draft slices mutate and reset independently', () => {
  let state = createInitialDraftState();
  state = reduceCreateDraftState(state, { type: 'set-text-commentary', commentary: 'Text note' });
  state = reduceCreateDraftState(state, {
    type: 'restore-media',
    mode: 'video',
    sourceKey: 'youtube-video',
    startMs: 1_000,
    endMs: 4_000,
    commentary: 'Video note',
  });
  state = reduceCreateDraftState(state, {
    type: 'restore-media',
    mode: 'audio',
    sourceKey: 'https://example.test/audio',
    startMs: 2_000,
    endMs: 8_000,
    commentary: 'Audio note',
  });
  const beforeVideoPatch = structuredClone(state);
  state = reduceCreateDraftState(state, {
    type: 'patch-media',
    mode: 'video',
    patch: { playerTimeMs: 3_000, durationMs: 10_000, playerReadState: 'reading' },
  });
  assert.deepEqual(state.text, beforeVideoPatch.text);
  assert.deepEqual(state.audio, beforeVideoPatch.audio);
  assert.equal(state.video.playerTimeMs, 3_000);
  const beforeAudioReset = structuredClone(state);
  state = reduceCreateDraftState(state, { type: 'reset-mode', mode: 'audio' });
  assert.deepEqual(state.text, beforeAudioReset.text);
  assert.deepEqual(state.video, beforeAudioReset.video);
  assert.equal(state.audio.commentary, '');
  assert.equal(state.audio.startMs, null);
  assert.equal(state.audio.revision, beforeAudioReset.audio.revision + 1);
});

test('draft contract rejects invalid commentary, times, and media identities', () => {
  const state = createInitialDraftState();
  assert.throws(() => reduceCreateDraftState(state, {
    type: 'set-text-commentary',
    commentary: 'x'.repeat(2_001),
  }));
  assert.throws(() => reduceCreateDraftState(state, {
    type: 'patch-media',
    mode: 'video',
    patch: { startMs: -1 },
  }));
  assert.throws(() => reduceCreateDraftState(state, {
    type: 'patch-media',
    mode: 'audio',
    patch: { sourceKey: ' ' },
  }));
});

test('the side panel is wired to independent Text, Video, and Audio draft slices', async () => {
  const appSource = await readFile(
    new URL('../entrypoints/sidepanel/App.tsx', import.meta.url),
    'utf8',
  );
  assert.match(appSource, /const commentary = createDraftState\.text\.commentary;/);
  assert.match(appSource, /const videoDraftState = createDraftState\.video;/);
  assert.match(appSource, /const audioDraftState = createDraftState\.audio;/);
  assert.doesNotMatch(appSource, /const \[clipStartMs, setClipStartMs\]/);
  assert.doesNotMatch(appSource, /const \[videoDurationMs, setVideoDurationMs\]/);
  assert.doesNotMatch(appSource, /const \[playerReadState, setPlayerReadState\]/);
  assert.match(appSource, /type: 'reset-mode', mode: 'video'/);
  assert.match(appSource, /type: 'reset-mode', mode: 'audio'/);
});
