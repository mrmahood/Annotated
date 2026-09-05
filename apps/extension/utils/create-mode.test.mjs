import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CREATE_MODES,
  CREATE_MODE_SELECTION_STORAGE_KEY,
  advanceModeRevision,
  createInitialDraftState,
  createInitialModeCapabilities,
  createInitialModeRevisions,
  createModeAsyncToken,
  createModeSelectionState,
  deserializeCreateModeSelection,
  getRecommendedMode,
  hasCreateModeDraft,
  isModeAsyncTokenCurrent,
  moveSelectionToPage,
  reduceCreateDraftState,
  selectCreateMode,
  serializeCreateModeSelection,
  storedCreateModeSelectionMatches,
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
  assert.deepEqual(CREATE_MODES, ['text', 'video', 'audio']);
  assert.deepEqual(createInitialModeCapabilities(), {
    text: { status: 'checking' },
    video: { status: 'checking' },
    audio: { status: 'checking' },
  });
  assert.equal(getRecommendedMode(capabilities()), 'text');
  assert.equal(getRecommendedMode(capabilities({ audio: 'available' })), 'audio');
  assert.equal(getRecommendedMode(capabilities({ audio: 'available' }), true), 'text');
  assert.equal(getRecommendedMode(capabilities({ video: 'available', audio: 'available' })), 'video');
  assert.equal(getRecommendedMode(capabilities({ video: 'available', audio: 'available' }), true), 'text');
  assert.equal(getRecommendedMode(capabilities({ text: 'unavailable' })), null);
  assert.throws(() => getRecommendedMode({
    ...capabilities(),
    audio: { status: 'unavailable', reason: 'x'.repeat(161) },
  }));
});

test('page-scoped explicit mode selection round-trips through bounded session storage', () => {
  const stored = serializeCreateModeSelection(IDENTITY, 'audio');
  assert.equal(CREATE_MODE_SELECTION_STORAGE_KEY, 'annotated.createModeSelection.v1');
  assert.deepEqual(deserializeCreateModeSelection(structuredClone(stored)), stored);
  assert.equal(storedCreateModeSelectionMatches(stored, { ...IDENTITY }), true);
  assert.equal(storedCreateModeSelectionMatches(stored, { ...IDENTITY, tabId: 43 }), false);
  assert.equal(deserializeCreateModeSelection({ ...stored, selectedMode: 'image' }), null);
  assert.equal(deserializeCreateModeSelection({
    ...stored,
    pageIdentity: { ...IDENTITY, sourceKey: 'x'.repeat(2_049) },
  }), null);
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

test('a temporary checking state does not force an automatic selection to disappear', () => {
  const page = updatePageGeneration(null, IDENTITY);
  const state = createModeSelectionState(page, capabilities({ video: 'available' }));
  const checking = updateModeCapabilities(state, capabilities({
    text: 'checking',
    video: 'checking',
    audio: 'checking',
  }));
  assert.equal(checking.selectedMode, 'video');
  assert.equal(checking.selectedBy, 'automatic');
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

test('transient player-read status does not revise an otherwise unchanged draft', () => {
  const state = reduceCreateDraftState(createInitialDraftState(), {
    type: 'patch-media',
    mode: 'video',
    patch: { playerIdentity: 'video:1:12345678' },
  });
  const reading = reduceCreateDraftState(state, {
    type: 'set-player-read-state',
    mode: 'video',
    state: 'reading',
  });
  assert.equal(reading.video.playerReadState, 'reading');
  assert.equal(reading.video.revision, state.video.revision);
  assert.deepEqual(reading.audio, state.audio);
  assert.deepEqual(reading.text, state.text);
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
  assert.equal(hasCreateModeDraft(state, 'text'), true);
  assert.equal(hasCreateModeDraft(state, 'video'), true);
  assert.equal(hasCreateModeDraft(state, 'audio'), false);
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

test('incidental article audio stays a Web page capability instead of an exclusive podcast flip', async () => {
  const [audioPage, app, publishing] = await Promise.all([
    readFile(new URL('./audio-page.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./audio-publishing.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(audioPage, /hasStrongPodcastSignals/);
  assert.match(audioPage, /PodcastEpisode/);
  assert.match(app, /audioAvailable: true/);
  assert.match(app, /audioIdentity: detection\.source/);
  assert.match(app, /preferText = sourceState\.source\.classification === 'Web page' &&/);
  assert.match(app, /articleHoverConnectionForTab/);
  assert.match(app, /audioHoverConnectionForTab/);
  assert.doesNotMatch(app, /lookupExistingSourceType|EXISTING_NON_AUDIO_SOURCE_MESSAGE/);
  assert.doesNotMatch(publishing, /EXISTING_NON_AUDIO_SOURCE_MESSAGE/);
  assert.doesNotMatch(app, /detection\.status === 'supported'[\s\S]{0,180}\.\.\.detection\.source/);
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
