import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_STORAGE_KEY,
  SYSTEM_LIGHT_MEDIA_QUERY,
  applyAppearanceToRoot,
  parseAppearancePreference,
  type AppearancePreference,
  type AppearanceRoot,
} from '@annotated/shared/appearance';

export {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_PREFERENCE_LABELS,
  APPEARANCE_PREFERENCES,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCE,
  SYSTEM_LIGHT_MEDIA_QUERY,
  appearancePreferenceIndex,
  applyAppearanceToRoot,
  parseAppearancePreference,
} from '@annotated/shared/appearance';

export type { AppearancePreference, AppearanceTheme } from '@annotated/shared/appearance';

type AppearanceStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type AppearanceChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

export type AppearanceChrome = {
  storage?: {
    local?: AppearanceStorageArea;
    onChanged?: {
      addListener(listener: AppearanceChangeListener): void;
      removeListener(listener: AppearanceChangeListener): void;
    };
  };
};

type AppearanceMirror = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function readMirror(mirror?: AppearanceMirror | null): AppearancePreference {
  try {
    return parseAppearancePreference(mirror?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return parseAppearancePreference(null);
  }
}

function writeMirror(preference: AppearancePreference, mirror?: AppearanceMirror | null): void {
  try {
    mirror?.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Sidepanel localStorage is only a sync cache for first paint.
  }
}

export function readLocalAppearancePreference(mirror?: AppearanceMirror | null): AppearancePreference {
  return readMirror(mirror);
}

export function applyAppearancePreference(
  preference: AppearancePreference,
  root: AppearanceRoot,
  prefersLight: boolean,
) {
  return applyAppearanceToRoot(root, parseAppearancePreference(preference), prefersLight);
}

export async function readChromeAppearancePreference(
  chromeApi?: AppearanceChrome | null,
  mirror?: AppearanceMirror | null,
): Promise<AppearancePreference> {
  try {
    const stored = await chromeApi?.storage?.local?.get(APPEARANCE_STORAGE_KEY);
    if (stored && APPEARANCE_STORAGE_KEY in stored) {
      return parseAppearancePreference(stored[APPEARANCE_STORAGE_KEY]);
    }
  } catch {
    // Fall back to the localStorage mirror when chrome.storage is unavailable.
  }

  return readMirror(mirror);
}

export async function persistAppearancePreference(
  preference: AppearancePreference,
  chromeApi?: AppearanceChrome | null,
  mirror?: AppearanceMirror | null,
): Promise<AppearancePreference> {
  const next = parseAppearancePreference(preference);
  writeMirror(next, mirror);
  try {
    await chromeApi?.storage?.local?.set({ [APPEARANCE_STORAGE_KEY]: next });
  } catch {
    // The live document can still update when persistence is blocked.
  }
  return next;
}

export function dispatchAppearanceChange(preference: AppearancePreference): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: preference }));
}

export function installAppearanceRuntime(
  root: AppearanceRoot,
  chromeApi?: AppearanceChrome | null,
  mirror?: AppearanceMirror | null,
  matchMedia?: ((query: string) => { matches: boolean; addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void }) | null,
): () => void {
  const media = matchMedia?.(SYSTEM_LIGHT_MEDIA_QUERY) ?? null;
  const applyCurrent = (preference: AppearancePreference) => {
    writeMirror(preference, mirror);
    applyAppearancePreference(preference, root, media?.matches === true);
  };

  applyCurrent(readMirror(mirror));
  void readChromeAppearancePreference(chromeApi, mirror).then(applyCurrent);

  const onMedia = () => {
    if (readMirror(mirror) === 'system') applyCurrent('system');
  };
  media?.addEventListener('change', onMedia);

  const onStorage: AppearanceChangeListener = (changes, areaName) => {
    if (areaName !== 'local' || !changes[APPEARANCE_STORAGE_KEY]) return;
    applyCurrent(parseAppearancePreference(changes[APPEARANCE_STORAGE_KEY]?.newValue));
    dispatchAppearanceChange(parseAppearancePreference(changes[APPEARANCE_STORAGE_KEY]?.newValue));
  };
  chromeApi?.storage?.onChanged?.addListener(onStorage);

  return () => {
    media?.removeEventListener('change', onMedia);
    chromeApi?.storage?.onChanged?.removeListener(onStorage);
  };
}
