import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web headers use the logo C mark plus Annotated", async () => {
  const [header, styles] = await Promise.all([
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(header, /import \{ LogoMark \} from "\.\/logo-mark"/);
  assert.match(header, /<LogoMark \/>/);
  assert.match(header, />\s*Annotated\s*</);
  assert.doesNotMatch(header, /ANNOTATED/);
  assert.match(styles, /\.logo-mark \{/);
  assert.match(styles, /width: 1\.4em/);
  assert.match(styles, /color: var\(--text-primary\)/);
  assert.match(styles, /\.logo-mark-inline \{/);
  assert.match(styles, /width: 1\.2em/);
  assert.match(styles, /vertical-align: -0\.22em/);
  assert.match(styles, /--logo-stroke: #f6f3ea/);
  assert.match(styles, /--logo-stroke: #1a170c/);
  assert.doesNotMatch(styles, /\.site-wordmark::before/);
  assert.doesNotMatch(styles, /\.site-wordmark::after/);
});

test("web titles, commentary, and comment bodies expand |* display-only", async () => {
  const [card, page, comments, mark] = await Promise.all([
    readFile(new URL("../app/annotation-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/public-annotation-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/a/[annotationId]/comments-section.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/logo-mark.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(mark, /stroke="var\(--logo-stroke\)"/);
  assert.match(mark, /fill="var\(--highlighter\)"/);
  assert.doesNotMatch(mark, /highlighter-ink/);
  assert.match(mark, /splitLogoShortcode/);
  assert.match(mark, /function TextWithLogoMark/);
  assert.match(mark, /segment\.value/);
  assert.doesNotMatch(mark, /<span/);
  assert.match(card, /<TextWithLogoMark text=\{annotation\.title\} \/>/);
  assert.match(card, /<TextWithLogoMark text=\{commentaryLead\} \/>/);
  assert.match(page, /<TextWithLogoMark text=\{annotation\.title\} \/>/);
  assert.match(page, /<TextWithLogoMark text=\{annotation\.commentaryText\} \/>/);
  assert.match(comments, /<TextWithLogoMark text=\{comment\.body\} \/>/);
  assert.match(page, /className="annotation-title"><TextWithLogoMark text=\{annotation\.title\} \/>/);
  assert.match(comments, /<textarea/);
  assert.doesNotMatch(card, /contentEditable|contenteditable/);
  assert.doesNotMatch(page, /contentEditable|contenteditable/);
  assert.doesNotMatch(comments, /contentEditable|contenteditable/);
  assert.doesNotMatch(comments, /<TextWithLogoMark text=\{draft\}/);
});

test("the favicon svg follows the color scheme and the png icons stay", async () => {
  const [svg, png, apple, ico] = await Promise.all([
    readFile(new URL("../app/icon.svg", import.meta.url), "utf8"),
    readFile(new URL("../app/icon.png", import.meta.url)),
    readFile(new URL("../app/apple-icon.png", import.meta.url)),
    readFile(new URL("../app/favicon.ico", import.meta.url)),
  ]);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(svg, /stroke: #f6f3ea/);
  assert.match(svg, /stroke: #1a170c/);
  assert.match(svg, /fill: #ffe14a/);
  assert.ok(png.byteLength > 0);
  assert.ok(apple.byteLength > 0);
  assert.ok(ico.byteLength > 0);
});
