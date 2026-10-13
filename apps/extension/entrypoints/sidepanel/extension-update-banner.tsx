import { Component, useEffect, useState, type ReactNode } from 'react';
import { getWebAppOrigin } from '../../utils/web-app-url';
import {
  EXTENSION_VERSION_PATH,
  UPDATE_CACHE_STORAGE_KEY,
  UPDATE_DISMISS_STORAGE_KEY,
  resolveExtensionUpdateNotice,
  type ExtensionUpdateCache,
  type ExtensionUpdateNotice,
} from '../../utils/extension-update';

const chrome = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;

class ExtensionUpdateErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    // The banner is optional. A failure here must not reach Create or capture.
  }

  override render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

async function readStorageValue(key: string): Promise<unknown> {
  const stored = await chrome.storage.local.get(key);
  return stored[key];
}

async function writeUpdateCache(cache: ExtensionUpdateCache): Promise<void> {
  await chrome.storage.local.set({ [UPDATE_CACHE_STORAGE_KEY]: cache });
}

async function writeDismissedVersion(version: string): Promise<void> {
  await chrome.storage.local.set({ [UPDATE_DISMISS_STORAGE_KEY]: version });
}

function ExtensionUpdateBannerBody() {
  const [notice, setNotice] = useState<ExtensionUpdateNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const origin = getWebAppOrigin();
        const installedVersion = chrome.runtime.getManifest().version;
        const resolved = await resolveExtensionUpdateNotice({
          now: Date.now(),
          installedVersion,
          origin,
          readCache: () => readStorageValue(UPDATE_CACHE_STORAGE_KEY),
          readDismissed: () => readStorageValue(UPDATE_DISMISS_STORAGE_KEY),
          writeCache: writeUpdateCache,
          fetchDocument: async () => {
            const response = await fetch(new URL(EXTENSION_VERSION_PATH, origin).href, {
              cache: 'no-store',
              credentials: 'omit',
              signal: controller.signal,
            });
            if (!response.ok) throw new Error('extension version unavailable');
            return response.json() as Promise<unknown>;
          },
        });
        if (!cancelled) setNotice(resolved);
      } catch {
        if (!cancelled) setNotice(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (!notice?.show || !notice.latestVersion || !notice.whatsNewUrl) return null;

  const dismiss = () => {
    const version = notice.latestVersion;
    setNotice(null);
    if (!version) return;
    void writeDismissedVersion(version).catch(() => undefined);
  };

  return (
    <aside className="extension-update-banner" aria-label="Update available">
      <p>
        <strong>Update available</strong>
        <span>{notice.latestVersion}</span>
      </p>
      <a href={notice.whatsNewUrl} target="_blank" rel="noreferrer">What's new</a>
      <button type="button" aria-label="Dismiss update notice" onClick={dismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </aside>
  );
}

export function ExtensionUpdateBanner() {
  return (
    <ExtensionUpdateErrorBoundary>
      <ExtensionUpdateBannerBody />
    </ExtensionUpdateErrorBoundary>
  );
}
