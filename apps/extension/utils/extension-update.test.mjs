import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  EXTENSION_VERSION_PATH,
  UPDATE_CHECK_INTERVAL_MS,
  WHATS_NEW_PATH,
  compareExtensionVersions,
  extensionWhatsNewUrl,
  isNewerExtensionVersion,
  parseExtensionVersionDocument,
  resolveExtensionUpdateNotice,
  shouldRefreshExtensionUpdateCheck,
  shouldShowExtensionUpdateBanner,
} from './extension-update.ts';

const ORIGIN = 'https://annotated.cbandcoop.com';

test('version comparison treats only strict semver increases as updates', () => {
  assert.equal(compareExtensionVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareExtensionVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareExtensionVersions('0.2.1', '0.2.0'), 1);
  assert.equal(compareExtensionVersions('0.10.0', '0.9.0'), 1);
  assert.equal(isNewerExtensionVersion('0.2.0', '0.1.0'), true);
  assert.equal(isNewerExtensionVersion('0.2.0', '0.2.0'), false);
  assert.equal(isNewerExtensionVersion('0.1.0', '0.2.0'), false);
  assert.equal(isNewerExtensionVersion('0.2', '0.1.0'), false);
  assert.equal(parseExtensionVersionDocument({ name: 'Annotated', version: '0.2.0' }), '0.2.0');
  assert.equal(parseExtensionVersionDocument({ version: '2' }), null);
  assert.equal(parseExtensionVersionDocument(null), null);
  assert.equal(extensionWhatsNewUrl(ORIGIN), `${ORIGIN}${WHATS_NEW_PATH}`);
  assert.equal(EXTENSION_VERSION_PATH, '/extension-version.json');
});

test('a fresh cache skips the network and a dismissed version stays hidden', async () => {
  let fetches = 0;
  const now = 1_700_000_000_000;
  const fresh = await resolveExtensionUpdateNotice({
    now,
    installedVersion: '0.1.0',
    origin: ORIGIN,
    readCache: async () => ({ checkedAt: now - 60_000, version: '0.2.0' }),
    readDismissed: async () => null,
    writeCache: async () => {
      throw new Error('cache must not be rewritten');
    },
    fetchDocument: async () => {
      fetches += 1;
      return { version: '9.9.9' };
    },
  });
  assert.equal(fetches, 0);
  assert.equal(fresh.show, true);
  assert.equal(fresh.latestVersion, '0.2.0');
  assert.equal(fresh.whatsNewUrl, `${ORIGIN}/whats-new`);

  const dismissed = await resolveExtensionUpdateNotice({
    now,
    installedVersion: '0.1.0',
    origin: ORIGIN,
    readCache: async () => ({ checkedAt: now - 60_000, version: '0.2.0' }),
    readDismissed: async () => '0.2.0',
    writeCache: async () => undefined,
    fetchDocument: async () => {
      throw new Error('dismissed cache must not fetch');
    },
  });
  assert.equal(dismissed.show, false);
  assert.equal(dismissed.latestVersion, '0.2.0');

  const newerThanDismissed = await resolveExtensionUpdateNotice({
    now,
    installedVersion: '0.1.0',
    origin: ORIGIN,
    readCache: async () => ({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS, version: '0.3.0' }),
    readDismissed: async () => '0.2.0',
    writeCache: async () => undefined,
    fetchDocument: async () => ({ version: '0.3.0' }),
  });
  assert.equal(newerThanDismissed.show, true);
  assert.equal(newerThanDismissed.latestVersion, '0.3.0');
});

test('fetch failures stay silent and do not invent an update', async () => {
  const failed = await resolveExtensionUpdateNotice({
    now: 10_000,
    installedVersion: '0.2.0',
    origin: ORIGIN,
    readCache: async () => null,
    readDismissed: async () => null,
    writeCache: async () => {
      throw new Error('nothing to cache');
    },
    fetchDocument: async () => {
      throw new Error('network down');
    },
  });
  assert.deepEqual(failed, { show: false, latestVersion: null, whatsNewUrl: null });

  const malformed = await resolveExtensionUpdateNotice({
    now: 10_000,
    installedVersion: '0.2.0',
    origin: ORIGIN,
    readCache: async () => null,
    readDismissed: async () => {
      throw new Error('storage unavailable');
    },
    writeCache: async () => undefined,
    fetchDocument: async () => ({ version: 'latest' }),
  });
  assert.equal(malformed.show, false);

  const sameVersion = await resolveExtensionUpdateNotice({
    now: 10_000,
    installedVersion: '0.2.0',
    origin: ORIGIN,
    readCache: async () => null,
    readDismissed: async () => null,
    writeCache: async () => undefined,
    fetchDocument: async () => ({ version: '0.2.0' }),
  });
  assert.equal(sameVersion.show, false);
  assert.equal(sameVersion.latestVersion, '0.2.0');
  assert.equal(shouldShowExtensionUpdateBanner({
    installedVersion: '0.1.0',
    latestVersion: '0.2.0',
    dismissedVersion: null,
  }), true);
  assert.equal(shouldRefreshExtensionUpdateCheck(0, UPDATE_CHECK_INTERVAL_MS - 1), false);
  assert.equal(shouldRefreshExtensionUpdateCheck(0, UPDATE_CHECK_INTERVAL_MS), true);
});

test('the sidebar banner is an isolated header child with a silent error boundary', async () => {
  const [app, banner, logic, style] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/extension-update-banner.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./extension-update.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
  ]);

  const header = app.slice(app.indexOf('<header className="app-header">'), app.indexOf('</header>') + '</header>'.length);
  assert.match(header, /<nav className="top-tabs" aria-label="Primary">/);
  assert.match(header, /<ExtensionUpdateBanner \/>/);
  assert.equal([...app.matchAll(/<ExtensionUpdateBanner/g)].length, 1);
  assert.match(app, /import \{ ExtensionUpdateBanner \} from '\.\/extension-update-banner'/);
  const createView = app.slice(app.indexOf('visually-hidden">Create'));
  assert.doesNotMatch(createView, /ExtensionUpdateBanner|extension-update/);

  assert.match(banner, /class ExtensionUpdateErrorBoundary/);
  assert.match(banner, /getDerivedStateFromError/);
  assert.match(banner, /componentDidCatch/);
  assert.match(banner, /return null/);
  assert.match(banner, /aria-label="Update available"/);
  assert.match(banner, /aria-label="Dismiss update notice"/);
  assert.match(banner, /WHATS_NEW_PATH|whatsNewUrl/);
  assert.match(banner, /cache: 'no-store'/);
  assert.doesNotMatch(banner, /media-capture|hosted-media|create-mode|tabCapture|beginPublish|captureSelection/);
  assert.doesNotMatch(logic, /media-capture|hosted-media|create-mode|tabCapture/);
  assert.match(style, /\.extension-update-banner \{/);
});
