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
  assert.match(styles, /\.logo-mark-inline \{/);
  assert.doesNotMatch(styles, /\.site-wordmark::before/);
  assert.doesNotMatch(styles, /\.site-wordmark::after/);
});

test("web commentary and comment bodies expand |* display-only", async () => {
  const [card, page, comments, mark] = await Promise.all([
    readFile(new URL("../app/annotation-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/public-annotation-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/a/[annotationId]/comments-section.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/logo-mark.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(mark, /splitLogoShortcode/);
  assert.match(mark, /function TextWithLogoMark/);
  assert.match(card, /<TextWithLogoMark text=\{commentaryLead\} \/>/);
  assert.match(page, /<TextWithLogoMark text=\{annotation\.commentaryText\} \/>/);
  assert.match(comments, /<TextWithLogoMark text=\{comment\.body\} \/>/);
  assert.match(card, /\{annotation\.title\}/);
  assert.match(page, /\{annotation\.title\}<\/h1>/);
  assert.match(comments, /<textarea/);
  assert.doesNotMatch(card, /contentEditable|contenteditable/);
  assert.doesNotMatch(page, /contentEditable|contenteditable/);
  assert.doesNotMatch(comments, /contentEditable|contenteditable/);
  assert.doesNotMatch(comments, /<TextWithLogoMark text=\{draft\}/);
  assert.doesNotMatch(page, /<TextWithLogoMark text=\{annotation\.title\}/);
  assert.doesNotMatch(card, /<TextWithLogoMark text=\{annotation\.title\}/);
});
