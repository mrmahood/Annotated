import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAppearanceBootstrapScript } from '@annotated/shared/appearance';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearancePreference,
  installAppearanceRuntime,
  persistAppearancePreference,
  readChromeAppearancePreference,
  readLocalAppearancePreference,
} from './appearance.ts';

test('extension preference helper mirrors chrome.storage.local and applies data-theme', async () => {
  const store = {};
  const chromeApi = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(items) {
          Object.assign(store, items);
        },
      },
    },
  };
  const mirror = new Map();
  const storage = {
    getItem: (key) => mirror.get(key) ?? null,
    setItem: (key, value) => mirror.set(key, value),
  };

  assert.equal(readLocalAppearancePreference(storage), 'system');
  assert.equal(await readChromeAppearancePreference(chromeApi, storage), 'system');

  const saved = await persistAppearancePreference('light', chromeApi, storage);
  assert.equal(saved, 'light');
  assert.equal(store[APPEARANCE_STORAGE_KEY], 'light');
  assert.equal(mirror.get(APPEARANCE_STORAGE_KEY), 'light');
  assert.equal(await readChromeAppearancePreference(chromeApi, storage), 'light');

  const root = { attributes: {}, style: { colorScheme: '' } };
  root.setAttribute = (name, value) => {
    root.attributes[name] = value;
  };
  assert.equal(applyAppearancePreference('system', root, false), 'dark');
  assert.equal(root.attributes['data-theme'], 'dark');
  assert.equal(applyAppearancePreference('system', root, true), 'light');
  assert.equal(root.attributes['data-theme'], 'light');
});

test('extension runtime follows System media-query changes immediately', () => {
  const listeners = [];
  const media = {
    matches: false,
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    removeEventListener(_type, listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const root = { attributes: {}, style: { colorScheme: '' } };
  root.setAttribute = (name, value) => {
    root.attributes[name] = value;
  };
  const mirror = new Map([[APPEARANCE_STORAGE_KEY, 'system']]);
  const storage = {
    getItem: (key) => mirror.get(key) ?? null,
    setItem: (key, value) => mirror.set(key, value),
  };

  const uninstall = installAppearanceRuntime(root, null, storage, () => media);
  assert.equal(root.attributes['data-theme'], 'dark');
  media.matches = true;
  listeners.forEach((listener) => listener());
  assert.equal(root.attributes['data-theme'], 'light');
  uninstall();
  assert.equal(listeners.length, 0);
});

test('Me tab and sidepanel styles wire the shared appearance control', async () => {
  const [app, control, style, html, main] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/appearance-control.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/main.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /import \{ AppearanceControl \} from '\.\/appearance-control'/);
  assert.match(app, /<h1 className="visually-hidden">Me<\/h1>/);
  assert.match(app, /<AppearanceControl \/>/);
  assert.match(control, /role="radiogroup"/);
  assert.match(control, /aria-label="Appearance"/);
  assert.match(control, /APPEARANCE_PREFERENCES\.map/);
  assert.match(control, /persistAppearancePreference\(saved, getExtensionChrome\(\)/);
  assert.match(main, /installAppearanceRuntime/);
  assert.match(main, /getExtensionChrome\(\)/);
  assert.match(html, /annotated\.appearance/);
  assert.ok(html.includes(getAppearanceBootstrapScript()));
  assert.match(style, /:root\[data-theme="light"\]/);
  assert.match(style, /color-scheme: light/);
  assert.match(style, /\.appearance-segmented/);
  assert.match(style, /color-scheme: inherit/);
  assert.doesNotMatch(style, /\.commentary-audio[^}]*color-scheme: dark/);
});
