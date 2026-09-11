import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extension root wordmark is the logo C mark plus Annotated', async () => {
  const [app, style] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /import \{ LogoMark \} from '\.\/logo-mark'/);
  assert.match(app, /<span className="wordmark"><LogoMark \/>Annotated<\/span>/);
  assert.doesNotMatch(app, />ANNOTATED</);
  assert.match(style, /\.logo-mark \{/);
  assert.match(style, /\.logo-mark-inline \{/);
});

test('extension commentary and comment bodies expand |* display-only', async () => {
  const [social, app, mark] = await Promise.all([
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/logo-mark.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(mark, /splitLogoShortcode/);
  assert.match(mark, /function TextWithLogoMark/);
  assert.match(social, /<TextWithLogoMark text=\{annotation\.commentaryText\.trim\(\)\} \/>/);
  assert.match(social, /<TextWithLogoMark text=\{annotation\.commentaryText\} \/>/);
  assert.match(social, /<TextWithLogoMark text=\{comment\.body\} \/>/);
  assert.match(social, /className="annotation-title">\{annotation\.title\}<\/p>/);
  assert.match(social, /<textarea id=\{`comment-\$\{annotationId\}`\}/);
  assert.match(app, /<textarea/);
  assert.match(app, /function CommentaryField/);
  assert.doesNotMatch(social, /contentEditable|contenteditable/);
  assert.doesNotMatch(app, /contentEditable|contenteditable/);
  assert.doesNotMatch(social, /<TextWithLogoMark text=\{annotation\.title\}/);
  assert.doesNotMatch(social, /<TextWithLogoMark text=\{body\}/);
});
