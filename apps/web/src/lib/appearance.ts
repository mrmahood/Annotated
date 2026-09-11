import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_COOKIE_NAME,
  APPEARANCE_STORAGE_KEY,
  applyAppearanceToRoot,
  parseAppearancePreference,
  readAppearanceCookieValue,
  type AppearancePreference,
  type AppearanceRoot,
} from "@annotated/shared/appearance";

export {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_COOKIE_NAME,
  APPEARANCE_PREFERENCE_ATTRIBUTE,
  APPEARANCE_PREFERENCE_LABELS,
  APPEARANCE_PREFERENCES,
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_THEME_ATTRIBUTE,
  DEFAULT_APPEARANCE_PREFERENCE,
  SYSTEM_LIGHT_MEDIA_QUERY,
  appearancePreferenceIndex,
  applyAppearanceToRoot,
  getAppearanceBootstrapScript,
  parseAppearancePreference,
  resolveAppearanceTheme,
} from "@annotated/shared/appearance";

export type { AppearancePreference, AppearanceTheme } from "@annotated/shared/appearance";

export const APPEARANCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type AppearanceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readStoredAppearancePreference(
  storage?: AppearanceStorage | null,
  cookieHeader = "",
): AppearancePreference {
  try {
    const stored = storage?.getItem(APPEARANCE_STORAGE_KEY);
    if (stored != null) return parseAppearancePreference(stored);
  } catch {
    // Storage can be blocked; fall through to the cookie.
  }

  return parseAppearancePreference(readAppearanceCookieValue(cookieHeader));
}

export function appearanceCookieString(
  preference: AppearancePreference,
  secure = false,
): string {
  const parts = [
    `${APPEARANCE_COOKIE_NAME}=${encodeURIComponent(preference)}`,
    "Path=/",
    `Max-Age=${APPEARANCE_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage?: AppearanceStorage | null,
  cookieWriter?: (value: string) => void,
  secure = false,
): AppearancePreference {
  const next = parseAppearancePreference(preference);

  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, next);
  } catch {
    // Persistence is best-effort; the live document can still update.
  }

  cookieWriter?.(appearanceCookieString(next, secure));
  return next;
}

export function applyStoredAppearance(
  root: AppearanceRoot,
  preference: AppearancePreference,
  prefersLight: boolean,
): ReturnType<typeof applyAppearanceToRoot> {
  return applyAppearanceToRoot(root, parseAppearancePreference(preference), prefersLight);
}

export function dispatchAppearanceChange(preference: AppearancePreference): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: preference }));
}
