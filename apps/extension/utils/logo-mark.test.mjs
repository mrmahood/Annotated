import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extension root header omits the duplicate wordmark; Me and Create keep a footer lockup', async () => {
  const [app, style, mark, config] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/logo-mark.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /import \{ BrandLockup \} from '\.\/logo-mark'/);
  assert.doesNotMatch(app, /className="wordmark"/);
  assert.doesNotMatch(app, /app-bar-root/);
  assert.doesNotMatch(app, /<LogoMark \/>Annotated/);
  assert.doesNotMatch(app, />ANNOTATED</);
  assert.match(mark, /function BrandLockup/);
  assert.match(mark, /className="brand-lockup"/);
  assert.match(mark, /<LogoMark \/>\s*Annotated/);
  assert.match(app, /<AppearanceControl \/>\s*<BrandLockup \/>/);
  assert.equal(app.match(/<BrandLockup \/>/g)?.length, 2);
  const feedBlock = app.slice(
    app.indexOf("currentScreen.view === 'feed'"),
    app.indexOf("currentScreen.view === 'account'"),
  );
  assert.doesNotMatch(feedBlock, /BrandLockup/);
  const createBlock = app.slice(app.indexOf("currentScreen.view === 'context'"));
  assert.match(createBlock, /<BrandLockup \/>/);
  assert.match(createBlock, /className="create-actions"/);
  assert.doesNotMatch(createBlock, /create-actions[\s\S]*<BrandLockup \/>[\s\S]*create-actions/);
  assert.match(config, /name: 'Annotated'/);
  assert.match(config, /default_title: 'Open Annotated'/);
  assert.match(style, /\.panel \{ min-height: 100vh; display: flex; flex-direction: column; \}/);
  assert.match(style, /\.root-view \{ flex: 1 0 auto; display: flex; flex-direction: column; \}/);
  assert.match(style, /\.account-view \{ flex: 1 0 auto; display: flex; flex-direction: column; gap: 14px; \}/);
  assert.match(style, /\.brand-lockup \{/);
  assert.match(style, /justify-content: center/);
  assert.match(style, /margin-top: auto/);
  assert.match(style, /color: var\(--text-primary\)/);
  assert.match(style, /font-weight: 650/);
  assert.match(style, /\.brand-lockup \.logo-mark \{ width: 1\.15em; height: 1\.15em; color: inherit; \}/);
  assert.match(style, /\.brand-lockup \.logo-mark line \{ stroke-width: 5; \}/);
  assert.match(style, /\.logo-mark \{/);
  assert.match(style, /width: 1\.4em/);
  assert.match(style, /\.logo-mark-inline \{/);
  assert.match(style, /width: 1\.2em/);
  assert.match(style, /vertical-align: -\.22em/);
  assert.doesNotMatch(style, /\.wordmark \{/);
  assert.doesNotMatch(style, /\.app-bar-root \{/);
  assert.doesNotMatch(style, /\.account-view \.brand-lockup/);
  assert.doesNotMatch(style, /color: var\(--text-muted\);\s*font-family: var\(--font-sans\);\s*font-size: 11px;\s*font-weight: 550/);
});

test('extension titles, commentary, and comment bodies expand |* display-only', async () => {
  const [social, app, mark] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/logo-mark.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(mark, /splitLogoShortcode/);
  assert.match(mark, /function TextWithLogoMark/);
  assert.match(mark, /segment\.value/);
  assert.doesNotMatch(mark, /<span/);
  assert.match(social, /<TextWithLogoMark text=\{annotation\.title\} \/>/);
  assert.match(social, /<TextWithLogoMark text=\{annotation\.commentaryText\.trim\(\)\} \/>/);
  assert.match(social, /<TextWithLogoMark text=\{annotation\.commentaryText\} \/>/);
  assert.match(social, /<TextWithLogoMark text=\{comment\.body\} \/>/);
  assert.match(social, /className="annotation-title"><TextWithLogoMark text=\{annotation\.title\} \/>/);
  assert.match(social, /<textarea id=\{`comment-\$\{annotationId\}`\}/);
  assert.match(app, /<textarea/);
  assert.match(app, /function CommentaryField/);
  assert.match(app, /function TitleField/);
  assert.match(app, /<input/);
  assert.doesNotMatch(app, /<TextWithLogoMark/);
  assert.doesNotMatch(social, /contentEditable|contenteditable/);
  assert.doesNotMatch(app, /contentEditable|contenteditable/);
  assert.doesNotMatch(social, /<TextWithLogoMark text=\{body\}/);
});
