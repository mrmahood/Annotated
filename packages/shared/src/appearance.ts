export const APPEARANCE_PREFERENCES = ['system', 'light', 'dark'] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];
export type AppearanceTheme = 'light' | 'dark';

export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = 'system';
export const APPEARANCE_STORAGE_KEY = 'annotated.appearance';
export const APPEARANCE_COOKIE_NAME = 'annotated-appearance';
export const APPEARANCE_THEME_ATTRIBUTE = 'data-theme';
export const APPEARANCE_PREFERENCE_ATTRIBUTE = 'data-appearance';
export const APPEARANCE_CHANGE_EVENT = 'annotated:appearance';
export const SYSTEM_LIGHT_MEDIA_QUERY = '(prefers-color-scheme: light)';

export const APPEARANCE_PREFERENCE_LABELS: Record<AppearancePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export type AppearanceRoot = {
  setAttribute(name: string, value: string): void;
  style: { colorScheme: string };
};

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function parseAppearancePreference(value: unknown): AppearancePreference {
  return isAppearancePreference(value) ? value : DEFAULT_APPEARANCE_PREFERENCE;
}

export function systemPrefersLight(matches?: boolean | null): boolean {
  return matches === true;
}

export function resolveAppearanceTheme(
  preference: AppearancePreference,
  prefersLight: boolean,
): AppearanceTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemPrefersLight(prefersLight) ? 'light' : 'dark';
}

export function appearancePreferenceIndex(preference: AppearancePreference): number {
  return APPEARANCE_PREFERENCES.indexOf(preference);
}

export function readAppearanceCookieValue(cookieHeader: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${APPEARANCE_COOKIE_NAME}=`)) continue;
    const raw = trimmed.slice(APPEARANCE_COOKIE_NAME.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}

export function applyAppearanceToRoot(
  root: AppearanceRoot,
  preference: AppearancePreference,
  prefersLight: boolean,
): AppearanceTheme {
  const theme = resolveAppearanceTheme(preference, prefersLight);
  root.setAttribute(APPEARANCE_THEME_ATTRIBUTE, theme);
  root.setAttribute(APPEARANCE_PREFERENCE_ATTRIBUTE, preference);
  root.style.colorScheme = theme;
  return theme;
}

export function getAppearanceBootstrapScript(): string {
  return `(function(){try{var k=${JSON.stringify(APPEARANCE_STORAGE_KEY)};var c=${JSON.stringify(APPEARANCE_COOKIE_NAME)};var valid={system:1,light:1,dark:1};function parse(v){return valid[v]?v:'system';}function cookie(){var parts=document.cookie?document.cookie.split(';'):[];for(var i=0;i<parts.length;i++){var p=parts[i].trim();if(p.indexOf(c+'=')===0){try{return decodeURIComponent(p.slice(c.length+1));}catch(e){return p.slice(c.length+1);}}}return '';}var stored='';try{stored=localStorage.getItem(k)||'';}catch(e){}var pref=parse(stored||cookie());var light=pref==='light'||(pref!=='dark'&&window.matchMedia&&window.matchMedia(${JSON.stringify(SYSTEM_LIGHT_MEDIA_QUERY)}).matches);var theme=light?'light':'dark';var root=document.documentElement;root.setAttribute(${JSON.stringify(APPEARANCE_THEME_ATTRIBUTE)},theme);root.setAttribute(${JSON.stringify(APPEARANCE_PREFERENCE_ATTRIBUTE)},pref);root.style.colorScheme=theme;}catch(e){}})();`;
}
