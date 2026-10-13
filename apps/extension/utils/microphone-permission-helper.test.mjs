import assert from 'node:assert/strict';
import test from 'node:test';
import { MICROPHONE_PERMISSION_MESSAGE } from './audio-commentary.ts';
import { openMicrophonePermissionHelper } from './microphone-permission-helper.ts';

function helperChrome() {
  const created = [];
  const removedWindows = [];
  let onMessage = null;
  let onRemoved = null;
  return {
    created,
    removedWindows,
    fireMessage(message) { onMessage?.(message); },
    fireRemoved(tabId) { onRemoved?.(tabId); },
    runtime: {
      getURL: (path) => `chrome-extension://annotated${path}`,
      onMessage: {
        addListener(listener) { onMessage = listener; },
        removeListener() { onMessage = null; },
      },
    },
    windows: {
      async create(createData) {
        created.push(createData);
        return { id: 9, tabs: [{ id: 3 }] };
      },
      remove(windowId) {
        removedWindows.push(windowId);
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener) { onRemoved = listener; },
        removeListener() { onRemoved = null; },
      },
    },
  };
}

test('the microphone helper opens a popup and does not activate a tab', async () => {
  const chrome = helperChrome();
  const pending = openMicrophonePermissionHelper(chrome);
  await Promise.resolve();
  assert.equal(chrome.created.length, 1);
  assert.equal(chrome.created[0].type, 'popup');
  assert.equal(chrome.created[0].focused, true);
  assert.equal(chrome.created[0].url, 'chrome-extension://annotated/microphone-permission.html');
  assert.equal('active' in chrome.created[0], false);
  chrome.fireMessage({ type: MICROPHONE_PERMISSION_MESSAGE, result: 'granted' });
  assert.equal(await pending, 'granted');
  assert.deepEqual(chrome.removedWindows, [9]);
});

test('a permission result that arrives before the popup resolves still closes it', async () => {
  let resolveCreate;
  const chrome = helperChrome();
  chrome.windows.create = (createData) => {
    chrome.created.push(createData);
    return new Promise((resolve) => {
      resolveCreate = () => resolve({ id: 9, tabs: [{ id: 3 }] });
    });
  };
  const pending = openMicrophonePermissionHelper(chrome);
  await Promise.resolve();
  chrome.fireMessage({ type: MICROPHONE_PERMISSION_MESSAGE, result: 'granted' });
  assert.equal(await pending, 'granted');
  assert.deepEqual(chrome.removedWindows, []);
  resolveCreate();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(chrome.removedWindows, [9]);
});

test('closing the microphone helper popup counts as dismissed', async () => {
  const chrome = helperChrome();
  const pending = openMicrophonePermissionHelper(chrome);
  await Promise.resolve();
  chrome.fireRemoved(3);
  assert.equal(await pending, 'dismissed');
});
