import {
  applyAudioHoverOnConnectedTab,
  audioHoverApplyResultFromPage,
  annotationMatchesConnectedAudio,
  openAudioSourceOnConnectedTab,
  scheduleAudioHoverOpenIdleClear,
  type AudioHoverApplyResult,
  type AudioHoverChrome,
  type AudioHoverConnection,
  type AudioHoverTarget,
} from './audio-hover-link.ts';
import { applyAudioHoverHighlightOnPage } from './audio-hover-page.ts';
import { classifySourceUrl } from './social-helpers.ts';
import { normalizeAudioSourceUrl } from '@annotated/shared/audio-source';

export const AUDIO_HOVER_PENDING_KEY = 'annotatedAudioHoverPending';
export const AUDIO_HOVER_PENDING_TTL_MS = 12 * 60 * 1000;
export const AUDIO_PENDING_CONNECT_HINT =
  'Player highlight applies when the episode finishes loading.';

export type AudioHoverPendingTarget = {
  normalizedUrl: string;
  canonicalUrl: string;
  startMs: number | null;
  endMs: number | null;
  strength: 'strong';
  setAt: number;
};

export type AudioPendingChrome = AudioHoverChrome & {
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
  };
  tabs: AudioHoverChrome['tabs'] & {
    create?: (createProperties: { url: string; active: true }) => Promise<{
      id?: number;
      url?: string;
      status?: string;
      windowId?: number;
    }>;
    query?: (queryInfo?: Record<string, unknown>) => Promise<Array<{
      id?: number;
      url?: string;
      status?: string;
      windowId?: number;
    }>>;
  };
  windows?: {
    update?: (windowId: number, update: { focused: true }) => Promise<unknown>;
  };
};

export type AudioSourceOpenOutcome = {
  applied: AudioHoverApplyResult | null;
  awaitingConnection: boolean;
};

function tryNormalizeAudioUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    if (classifySourceUrl(value) === 'youtube') return null;
    return normalizeAudioSourceUrl(value);
  } catch {
    return null;
  }
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function resolvePendingChrome(override?: AudioPendingChrome): AudioPendingChrome | null {
  if (override) return override;
  const chrome = (globalThis as { chrome?: AudioPendingChrome }).chrome;
  return chrome?.scripting && chrome.storage && chrome.tabs ? chrome : null;
}

export function isAudioHoverPendingTarget(value: unknown): value is AudioHoverPendingTarget {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<AudioHoverPendingTarget>;
  const startOk = pending.startMs === null || finiteMs(pending.startMs) !== null;
  const endOk = pending.endMs === null || finiteMs(pending.endMs) !== null;
  return (
    typeof pending.normalizedUrl === 'string' &&
    pending.normalizedUrl.trim().length > 0 &&
    typeof pending.canonicalUrl === 'string' &&
    pending.canonicalUrl.trim().length > 0 &&
    pending.strength === 'strong' &&
    startOk &&
    endOk &&
    typeof pending.setAt === 'number' &&
    Number.isFinite(pending.setAt)
  );
}

export function audioHoverPendingIsExpired(
  pending: Pick<AudioHoverPendingTarget, 'setAt'>,
  now = Date.now(),
): boolean {
  return now - pending.setAt > AUDIO_HOVER_PENDING_TTL_MS;
}

export function audioHoverPendingMatchesUrl(
  pending: Pick<AudioHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl'>,
  tabUrl: string | null | undefined,
): boolean {
  const live = tryNormalizeAudioUrl(tabUrl);
  if (!live) return false;
  const candidates = [
    tryNormalizeAudioUrl(pending.normalizedUrl),
    tryNormalizeAudioUrl(pending.canonicalUrl),
  ].filter((value): value is string => value !== null);
  return candidates.includes(live);
}

export function audioHoverPendingMatchesTarget(
  pending: Pick<AudioHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl' | 'startMs' | 'endMs'>,
  target: Pick<AudioHoverTarget, 'canonicalUrl' | 'normalizedUrl' | 'startMs' | 'endMs'>,
): boolean {
  if ((pending.startMs ?? null) !== (target.startMs ?? null)) return false;
  if ((pending.endMs ?? null) !== (target.endMs ?? null)) return false;
  return (
    audioHoverPendingMatchesUrl(pending, target.normalizedUrl) ||
    audioHoverPendingMatchesUrl(pending, target.canonicalUrl)
  );
}

export async function clearAudioHoverPending(
  chromeApi?: AudioPendingChrome,
): Promise<void> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return;
  try {
    await chrome.storage.session.remove(AUDIO_HOVER_PENDING_KEY);
  } catch {
    // Session clear is best-effort; expiry also drops stale targets.
  }
}

export async function readAudioHoverPending(
  chromeApi?: AudioPendingChrome,
  now = Date.now(),
): Promise<AudioHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return null;
  try {
    const stored = await chrome.storage.session.get(AUDIO_HOVER_PENDING_KEY);
    const value = stored[AUDIO_HOVER_PENDING_KEY];
    if (!isAudioHoverPendingTarget(value)) {
      if (value !== undefined) await chrome.storage.session.remove(AUDIO_HOVER_PENDING_KEY);
      return null;
    }
    if (audioHoverPendingIsExpired(value, now)) {
      await chrome.storage.session.remove(AUDIO_HOVER_PENDING_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function writeAudioHoverPending(
  target: Pick<AudioHoverTarget, 'canonicalUrl' | 'normalizedUrl' | 'startMs' | 'endMs'>,
  chromeApi?: AudioPendingChrome,
  now = Date.now(),
): Promise<AudioHoverPendingTarget | null> {
  const chrome = resolvePendingChrome(chromeApi);
  const normalizedUrl = tryNormalizeAudioUrl(target.normalizedUrl) ??
    tryNormalizeAudioUrl(target.canonicalUrl);
  const canonicalUrl = typeof target.canonicalUrl === 'string' ? target.canonicalUrl.trim() : '';
  if (!chrome || !normalizedUrl || !canonicalUrl) return null;
  const pending: AudioHoverPendingTarget = {
    normalizedUrl,
    canonicalUrl,
    startMs: finiteMs(target.startMs),
    endMs: finiteMs(target.endMs),
    strength: 'strong',
    setAt: now,
  };
  try {
    await chrome.storage.session.set({ [AUDIO_HOVER_PENDING_KEY]: pending });
    return pending;
  } catch {
    return null;
  }
}

async function clearPendingAfterApply(
  result: AudioHoverApplyResult,
  chromeApi?: AudioPendingChrome,
) {
  if (result.status === 'matched' || result.status === 'source-mismatch') {
    await clearAudioHoverPending(chromeApi);
  }
}

export async function applyPendingAudioHoverOnTab(
  tab: { tabId: number; tabUrl: string },
  chromeApi?: AudioPendingChrome,
  now = Date.now(),
): Promise<AudioHoverApplyResult> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome || !Number.isInteger(tab.tabId) || tab.tabId < 0) {
    return { status: 'unavailable' };
  }
  const pending = await readAudioHoverPending(chrome, now);
  if (!pending || !audioHoverPendingMatchesUrl(pending, tab.tabUrl)) {
    return { status: 'unavailable' };
  }
  const expectedNormalizedUrl = tryNormalizeAudioUrl(tab.tabUrl);
  if (!expectedNormalizedUrl) return { status: 'unavailable' };
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      func: applyAudioHoverHighlightOnPage,
      args: [{
        expectedNormalizedUrl,
        strength: pending.strength,
        startMs: pending.startMs,
        endMs: pending.endMs,
      }],
    });
    const result = audioHoverApplyResultFromPage(injection);
    await clearPendingAfterApply(result, chrome);
    if (result.status === 'matched') {
      scheduleAudioHoverOpenIdleClear({ tabId: tab.tabId, tabUrl: tab.tabUrl }, chrome);
    }
    return result;
  } catch {
    return { status: 'unavailable' };
  }
}

export type ExistingAudioTab = {
  id: number;
  url: string;
  status?: string;
  windowId?: number;
};

export function findExistingAudioTab(
  tabs: Array<{ id?: number; url?: string; status?: string; windowId?: number }>,
  pending: Pick<AudioHoverPendingTarget, 'normalizedUrl' | 'canonicalUrl'>,
): ExistingAudioTab | null {
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id) || (tab.id ?? -1) < 0 || typeof tab.url !== 'string') continue;
    if (audioHoverPendingMatchesUrl(pending, tab.url)) {
      return {
        id: tab.id as number,
        url: tab.url,
        ...(tab.status ? { status: tab.status } : {}),
        ...(typeof tab.windowId === 'number' ? { windowId: tab.windowId } : {}),
      };
    }
  }
  return null;
}

export async function applyPendingAudioHoverOnConnection(
  connection: AudioHoverConnection,
  chromeApi?: AudioPendingChrome,
  now = Date.now(),
): Promise<AudioHoverApplyResult> {
  const chrome = resolvePendingChrome(chromeApi);
  if (!chrome) return { status: 'unavailable' };
  const pending = await readAudioHoverPending(chrome, now);
  if (!pending || !audioHoverPendingMatchesUrl(pending, connection.tabUrl)) {
    return { status: 'unavailable' };
  }
  const result = await applyAudioHoverOnConnectedTab(
    connection,
    {
      canonicalUrl: pending.canonicalUrl,
      normalizedUrl: pending.normalizedUrl,
      strength: pending.strength,
      startMs: pending.startMs,
      endMs: pending.endMs,
    },
    chrome,
  );
  await clearPendingAfterApply(result, chrome);
  if (result.status === 'matched') {
    scheduleAudioHoverOpenIdleClear(connection, chrome);
  }
  return result;
}

async function focusExistingOrCreateTab(
  href: string,
  pending: AudioHoverPendingTarget,
  chromeApi: AudioPendingChrome,
  openFallback?: (href: string) => void,
): Promise<ExistingAudioTab | null> {
  try {
    const listed = chromeApi.tabs.query ? await chromeApi.tabs.query({}) : [];
    const existing = findExistingAudioTab(listed, pending);
    if (existing) {
      try {
        await chromeApi.tabs.update?.(existing.id, { active: true });
        if (existing.windowId != null) {
          await chromeApi.windows?.update?.(existing.windowId, { focused: true });
        }
      } catch {
        // Focus is best-effort; pending apply still runs on complete/activate.
      }
      return existing;
    }
  } catch {
    // Query failures fall through to create.
  }

  try {
    if (chromeApi.tabs.create) {
      const created = await chromeApi.tabs.create({ url: href, active: true });
      if (created && Number.isInteger(created.id) && (created.id ?? -1) >= 0) {
        return {
          id: created.id as number,
          url: typeof created.url === 'string' && created.url ? created.url : href,
          ...(created.status ? { status: created.status } : {}),
          ...(typeof created.windowId === 'number' ? { windowId: created.windowId } : {}),
        };
      }
      return null;
    }
  } catch {
    // Fall through to the window.open path when tabs.create is unavailable.
  }
  openFallback?.(href);
  return null;
}

export async function openAudioSourceFromPanel(input: {
  target: Pick<AudioHoverTarget, 'canonicalUrl' | 'normalizedUrl' | 'startMs' | 'endMs'>;
  connection: AudioHoverConnection | null;
  href: string;
  chromeApi?: AudioPendingChrome;
  now?: number;
  openFallback?: (href: string) => void;
}): Promise<AudioSourceOpenOutcome> {
  const chrome = resolvePendingChrome(input.chromeApi);
  if (!chrome) {
    input.openFallback?.(input.href);
    return { applied: null, awaitingConnection: true };
  }

  const pending = await writeAudioHoverPending(input.target, chrome, input.now ?? Date.now());

  if (
    input.connection &&
    annotationMatchesConnectedAudio({
      kind: 'audio',
      startMs: input.target.startMs,
      endMs: input.target.endMs,
      source: {
        type: 'podcast',
        canonicalUrl: input.target.canonicalUrl,
        normalizedUrl: input.target.normalizedUrl,
      },
    }, input.connection.tabUrl)
  ) {
    const applied = await openAudioSourceOnConnectedTab(
      input.connection,
      { ...input.target, strength: 'strong' },
      chrome,
    );
    if (applied.status === 'matched') {
      await clearAudioHoverPending(chrome);
      return { applied, awaitingConnection: false };
    }
    if (applied.status === 'source-mismatch') {
      await clearAudioHoverPending(chrome);
      return { applied, awaitingConnection: false };
    }
  }

  if (!pending) {
    await focusExistingOrCreateTab(input.href, {
      normalizedUrl: input.target.normalizedUrl,
      canonicalUrl: input.target.canonicalUrl,
      startMs: finiteMs(input.target.startMs),
      endMs: finiteMs(input.target.endMs),
      strength: 'strong',
      setAt: input.now ?? Date.now(),
    }, chrome, input.openFallback);
    return { applied: null, awaitingConnection: true };
  }

  const opened = await focusExistingOrCreateTab(input.href, pending, chrome, input.openFallback);
  if (opened?.status === 'complete' && audioHoverPendingMatchesUrl(pending, opened.url)) {
    const applied = await applyPendingAudioHoverOnTab(
      { tabId: opened.id, tabUrl: opened.url },
      chrome,
      input.now ?? Date.now(),
    );
    if (applied.status === 'matched') {
      return { applied, awaitingConnection: false };
    }
    return { applied, awaitingConnection: true };
  }

  return { applied: null, awaitingConnection: true };
}
