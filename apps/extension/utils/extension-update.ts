export const EXTENSION_VERSION_PATH = '/extension-version.json';
export const WHATS_NEW_PATH = '/whats-new';
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_CACHE_STORAGE_KEY = 'annotated.extension-update.cache.v1';
export const UPDATE_DISMISS_STORAGE_KEY = 'annotated.extension-update.dismissed.v1';

const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export type ExtensionUpdateCache = {
  checkedAt: number;
  version: string;
};

export type ExtensionUpdateNotice = {
  show: boolean;
  latestVersion: string | null;
  whatsNewUrl: string | null;
};

export function isExtensionVersion(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_VERSION_PATTERN.test(value);
}

export function compareExtensionVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part));
  const b = right.split('.').map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

export function isNewerExtensionVersion(latest: string, installed: string): boolean {
  if (!isExtensionVersion(latest) || !isExtensionVersion(installed)) return false;
  return compareExtensionVersions(latest, installed) > 0;
}

export function parseExtensionVersionDocument(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const version = (value as { version?: unknown }).version;
  return isExtensionVersion(version) ? version : null;
}

export function parseExtensionUpdateCache(value: unknown): ExtensionUpdateCache | null {
  if (!value || typeof value !== 'object') return null;
  const checkedAt = (value as { checkedAt?: unknown }).checkedAt;
  const version = (value as { version?: unknown }).version;
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return null;
  if (!isExtensionVersion(version)) return null;
  return { checkedAt, version };
}

export function parseDismissedExtensionVersion(value: unknown): string | null {
  return isExtensionVersion(value) ? value : null;
}

export function shouldRefreshExtensionUpdateCheck(
  checkedAt: number,
  now: number,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(checkedAt) || !Number.isFinite(now) || !Number.isFinite(intervalMs)) {
    return true;
  }
  if (intervalMs <= 0) return true;
  if (now < checkedAt) return true;
  return now - checkedAt >= intervalMs;
}

export function shouldShowExtensionUpdateBanner(input: {
  installedVersion: string;
  latestVersion: string | null;
  dismissedVersion: string | null;
}): boolean {
  if (!input.latestVersion) return false;
  if (!isNewerExtensionVersion(input.latestVersion, input.installedVersion)) return false;
  return input.dismissedVersion !== input.latestVersion;
}

export function extensionWhatsNewUrl(origin: string): string | null {
  try {
    const url = new URL(WHATS_NEW_PATH, origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function resolveExtensionUpdateNotice(input: {
  now: number;
  installedVersion: string;
  origin: string;
  readCache: () => Promise<unknown>;
  readDismissed: () => Promise<unknown>;
  writeCache: (cache: ExtensionUpdateCache) => Promise<void>;
  fetchDocument: () => Promise<unknown>;
}): Promise<ExtensionUpdateNotice> {
  const hidden: ExtensionUpdateNotice = {
    show: false,
    latestVersion: null,
    whatsNewUrl: null,
  };

  try {
    if (!isExtensionVersion(input.installedVersion)) return hidden;
    const whatsNewUrl = extensionWhatsNewUrl(input.origin);
    if (!whatsNewUrl) return hidden;

    const dismissedVersion = parseDismissedExtensionVersion(await input.readDismissed());
    const cache = parseExtensionUpdateCache(await input.readCache());
    let latestVersion = cache && !shouldRefreshExtensionUpdateCheck(cache.checkedAt, input.now)
      ? cache.version
      : null;

    if (!latestVersion) {
      try {
        const parsed = parseExtensionVersionDocument(await input.fetchDocument());
        if (!parsed) return hidden;
        latestVersion = parsed;
        try {
          await input.writeCache({ checkedAt: input.now, version: parsed });
        } catch {
          // A missed cache write must not surface in the panel.
        }
      } catch {
        latestVersion = cache?.version ?? null;
      }
    }

    if (!latestVersion) return hidden;
    return {
      show: shouldShowExtensionUpdateBanner({
        installedVersion: input.installedVersion,
        latestVersion,
        dismissedVersion,
      }),
      latestVersion,
      whatsNewUrl,
    };
  } catch {
    return hidden;
  }
}
