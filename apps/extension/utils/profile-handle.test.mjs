import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP_URL = new URL('../entrypoints/sidepanel/App.tsx', import.meta.url);
const FORM_URL = new URL('../entrypoints/sidepanel/profile-handle-form.tsx', import.meta.url);
const HELPERS_URL = new URL('./social-helpers.ts', import.meta.url);

test('extension Me claims and changes handles through set_profile_handle only', async () => {
  const [app, form, helpers] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(FORM_URL, 'utf8'),
    readFile(HELPERS_URL, 'utf8'),
  ]);

  assert.match(app, /select\('display_name, avatar_url, username'\)/);
  assert.match(app, /username: getMetadataText\(profile\?\.username\) \|\| null/);
  assert.match(app, /<ProfileHandleForm/);
  assert.match(app, /currentHandle=\{authState\.account\.username\}/);
  assert.match(app, /@{authState\.account\.username}/);
  assert.match(form, /setProfileHandle/);
  assert.match(form, /from '@annotated\/shared\/profile-handle'/);
  assert.match(form, /Claim handle/);
  assert.match(form, /Change handle/);
  assert.doesNotMatch(form, /from\('profiles'\)/);
  assert.doesNotMatch(form, /\.update\(/);
  assert.doesNotMatch(form, /twitter|x\.com|provider handle/i);
  assert.match(helpers, /isReservedProfileHandle/);
  assert.match(helpers, /PROFILE_HANDLE_PATTERN/);
});

test('extension Me does not show a handle form while signed out', async () => {
  const app = await readFile(APP_URL, 'utf8');
  const signedOut = app.slice(
    app.indexOf("authState.status === 'signed-out'"),
    app.indexOf("authState.status === 'signing-in'"),
  );
  assert.match(signedOut, /Sign in to publish/);
  assert.doesNotMatch(signedOut, /ProfileHandleForm/);
  assert.doesNotMatch(app, /ensure_profile_handle/);
});
