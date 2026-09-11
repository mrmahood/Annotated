import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_COOKIE_NAME,
  APPEARANCE_PREFERENCE_ATTRIBUTE,
  APPEARANCE_PREFERENCE_LABELS,
  APPEARANCE_PREFERENCES,
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_THEME_ATTRIBUTE,
  DEFAULT_APPEARANCE_PREFERENCE,
  appearancePreferenceIndex,
  applyAppearanceToRoot,
  getAppearanceBootstrapScript,
  isAppearancePreference,
  parseAppearancePreference,
  readAppearanceCookieValue,
  resolveAppearanceTheme,
  systemPrefersLight,
} from './appearance.ts';

test('appearance preference defaults to system and rejects unknown values', () => {
  assert.deepEqual(APPEARANCE_PREFERENCES, ['system', 'light', 'dark']);
  assert.equal(DEFAULT_APPEARANCE_PREFERENCE, 'system');
  assert.equal(APPEARANCE_STORAGE_KEY, 'annotated.appearance');
  assert.equal(APPEARANCE_COOKIE_NAME, 'annotated-appearance');
  assert.equal(isAppearancePreference('system'), true);
  assert.equal(isAppearancePreference('light'), true);
  assert.equal(isAppearancePreference('dark'), true);
  assert.equal(isAppearancePreference('auto'), false);
  assert.equal(parseAppearancePreference('light'), 'light');
  assert.equal(parseAppearancePreference('dark'), 'dark');
  assert.equal(parseAppearancePreference('system'), 'system');
  assert.equal(parseAppearancePreference('auto'), 'system');
  assert.equal(parseAppearancePreference(null), 'system');
  assert.equal(parseAppearancePreference(''), 'system');
  assert.deepEqual(APPEARANCE_PREFERENCE_LABELS, {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  });
  assert.equal(appearancePreferenceIndex('system'), 0);
  assert.equal(appearancePreferenceIndex('light'), 1);
  assert.equal(appearancePreferenceIndex('dark'), 2);
});

test('system follows an explicit light OS and stays dark-first otherwise', () => {
  assert.equal(systemPrefersLight(true), true);
  assert.equal(systemPrefersLight(false), false);
  assert.equal(systemPrefersLight(null), false);
  assert.equal(systemPrefersLight(undefined), false);
  assert.equal(resolveAppearanceTheme('light', false), 'light');
  assert.equal(resolveAppearanceTheme('dark', true), 'dark');
  assert.equal(resolveAppearanceTheme('system', true), 'light');
  assert.equal(resolveAppearanceTheme('system', false), 'dark');
});

test('cookie reader and root apply share the same theme attributes', () => {
  assert.equal(
    readAppearanceCookieValue(`${APPEARANCE_COOKIE_NAME}=light; other=1`),
    'light',
  );
  assert.equal(
    readAppearanceCookieValue(`session=abc; ${APPEARANCE_COOKIE_NAME}=dark`),
    'dark',
  );
  assert.equal(readAppearanceCookieValue(''), null);
  assert.equal(readAppearanceCookieValue('other=1'), null);

  const root = { attributes: {}, style: { colorScheme: '' } };
  root.setAttribute = (name, value) => {
    root.attributes[name] = value;
  };

  assert.equal(applyAppearanceToRoot(root, 'system', false), 'dark');
  assert.equal(root.attributes[APPEARANCE_THEME_ATTRIBUTE], 'dark');
  assert.equal(root.attributes[APPEARANCE_PREFERENCE_ATTRIBUTE], 'system');
  assert.equal(root.style.colorScheme, 'dark');

  assert.equal(applyAppearanceToRoot(root, 'system', true), 'light');
  assert.equal(root.attributes[APPEARANCE_THEME_ATTRIBUTE], 'light');
  assert.equal(root.style.colorScheme, 'light');
});

test('bootstrap script applies the shared key before paint and stays dark-first', () => {
  const script = getAppearanceBootstrapScript();
  assert.match(script, new RegExp(APPEARANCE_STORAGE_KEY.replace('.', '\\.')));
  assert.match(script, new RegExp(APPEARANCE_COOKIE_NAME));
  assert.match(script, new RegExp(APPEARANCE_THEME_ATTRIBUTE));
  assert.match(script, new RegExp(APPEARANCE_PREFERENCE_ATTRIBUTE));
  assert.match(script, /prefers-color-scheme: light/);
  assert.match(script, /localStorage\.getItem/);
  assert.match(script, /colorScheme/);
  assert.doesNotMatch(script, /eval\(|Function\(/);
  assert.equal(APPEARANCE_CHANGE_EVENT, 'annotated:appearance');
});
