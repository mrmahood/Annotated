import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("home hero shows an accessible passage-and-note illustration above the install button", async () => {
  const [home, illustration, styles, header] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hero-illustration.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(home, /import \{ HeroIllustration \} from "\.\/hero-illustration"/);
  const illustrationAt = home.indexOf("<HeroIllustration />");
  const installAt = home.indexOf("<InstallForChromeButton />");
  assert.ok(illustrationAt > -1 && installAt > illustrationAt);

  assert.match(illustration, /role="img"/);
  assert.match(illustration, /aria-label="[^"]*Needs context[^"]*"/);
  assert.match(illustration, /figures are comparisons/);
  assert.match(illustration, /asteriskRays/);
  assert.match(illustration, /LOGO_MARK_VIEWBOX/);
  assert.doesNotMatch(illustration, /<img[\s>]/);

  assert.match(styles, /\.hero-illustration-highlight/);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(styles, /hero-highlight-sweep/);
  assert.match(styles, /hero-note-pop/);
  const motionBlock = styles.slice(
    styles.indexOf("@media (prefers-reduced-motion: no-preference)"),
    styles.indexOf("@keyframes hero-highlight-sweep"),
  );
  assert.match(motionBlock, /\.hero-illustration-highlight/);
  assert.match(motionBlock, /\.hero-illustration-note/);
  assert.doesNotMatch(
    styles.slice(0, styles.indexOf("@media (prefers-reduced-motion: no-preference)")),
    /\.hero-illustration-note\s*\{[^}]*opacity:\s*0/,
  );

  const mobileCallout = styles.slice(styles.indexOf("@media (max-width: 640px)"));
  assert.match(mobileCallout, /\.install-extension-callout p \{ display: none; \}/);

  assert.match(header, /<LogoMark \/>/);
  assert.doesNotMatch(header, /HeroIllustration|hero-illustration/);
});
