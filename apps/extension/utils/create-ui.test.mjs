import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP_URL = new URL('../entrypoints/sidepanel/App.tsx', import.meta.url);
const STYLE_URL = new URL('../entrypoints/sidepanel/style.css', import.meta.url);

test('Create is the visible compatibility label and the switcher uses native fixed-order radios', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /currentScreen\.view === 'context' \? 'Create'/);
  assert.match(source, /view === 'context' \? 'Create'/);
  assert.doesNotMatch(source, /currentScreen\.view === 'context' \? 'Context'/);
  assert.match(source, /<h1>Create<\/h1>/);
  assert.match(source, /<fieldset className="create-mode-switcher">/);
  assert.match(source, /<legend>Create mode<\/legend>/);
  assert.match(source, /CREATE_MODES\.map\(\(mode\) =>/);
  assert.match(source, /type="radio" name="create-mode"/);
  assert.match(source, /disabled=\{unavailable\}/);
  assert.match(source, /role="status" aria-live="polite"/);
});

test('inactive and detached drafts are indicated without exposing another source details', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /!selected && savedDraftModes\[mode\]/);
  assert.match(source, /'Draft saved'/);
  assert.match(source, /detachedDraftModes\[selectedCreateMode\]/);
  assert.match(source, /This draft belongs to another connected source\./);
  assert.match(source, /Discard \{CREATE_MODE_LABELS\[selectedCreateMode\]\} draft and start here/);
  assert.doesNotMatch(source, /if \(detection\.status === 'not-audio-page'\) void clearAudioDraft/);
});

test('the switcher and editor actions have explicit 390 and 340 pixel contracts', async () => {
  const style = await readFile(STYLE_URL, 'utf8');
  assert.match(style, /@media \(max-width: 390px\)/);
  assert.match(style, /@media \(max-width: 340px\)/);
  assert.match(style, /\.create-mode-option \{ min-height: 48px;/);
  assert.match(style, /\.create-mode-options \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /\.clip-control-row \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /\.create-actions \{ grid-template-columns: 1fr; \}/);
});

test('player selection is a bounded native radio group and gates every clip action', async () => {
  const [source, style] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(STYLE_URL, 'utf8'),
  ]);
  assert.match(source, /<fieldset className="player-selector">/);
  assert.match(source, /<legend>Choose \{label\} player<\/legend>/);
  assert.match(source, /type="radio"\s+name=\{`\$\{mode\}-player`\}/);
  assert.match(source, /\{index \+ 1\} of \{discovery\.candidates\.length\}/);
  assert.match(source, /Too many \{label\} players/);
  assert.match(source, /disabled=\{!videoPlayerSelected/);
  assert.match(source, /disabled=\{!audioPlayerSelected/);
  assert.match(source, /runSelectedPlayerAction\(\s*'video'/);
  assert.match(source, /runSelectedPlayerAction\(\s*'audio'/);
  assert.match(style, /\.player-option-label[^}]*overflow-wrap: anywhere/);
});
