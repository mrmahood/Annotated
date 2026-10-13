import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BNM_SNIPPET,
  DEMO_COMMENTARY,
  DEMO_COMMENTARY_TITLE,
  DEMO_NOTES,
  DEMO_PAGE_TITLE,
  DEMO_PASSAGE,
  DEMO_TEASER,
  DEMO_TOUR_STEPS,
  DEMO_VALUE_PROP,
  EESI_SNIPPET,
  composeDemoPostText,
  demoHighlightColor,
  demoHighlightElementId,
  demoOpenGraphImage,
  demoTourIsPlaying,
} from "../app/demo/demo-data.ts";

const demoDir = new URL("../app/demo/", import.meta.url);

async function readDemo(name) {
  return readFile(new URL(name, demoDir), "utf8");
}

test("demo notes reuse the published Batam fact-check and add other verdicts", () => {
  const [needsContext, misleading, receipts] = DEMO_NOTES;
  assert.equal(needsContext.verdict, "needs_context");
  assert.equal(needsContext.noteType, "fact_check");
  assert.equal(needsContext.title, DEMO_COMMENTARY_TITLE);
  assert.equal(needsContext.commentary, DEMO_COMMENTARY);
  assert.equal(needsContext.passage, DEMO_PASSAGE);
  assert.equal(needsContext.sources[0].url, "https://www.eesi.org/articles/view/data-centers-and-water-consumption/");
  assert.equal(needsContext.sources[0].snippet, EESI_SNIPPET);
  assert.equal(needsContext.sources[1].url, "https://www.bnm.gov.my/documents/20124/19910400/qb25q3_en_box1.pdf");
  assert.equal(needsContext.sources[1].snippet, BNM_SNIPPET);
  assert.equal(misleading.verdict, "misleading");
  assert.equal(receipts.noteType, "receipts");
  assert.equal(receipts.verdict, null);
  assert.equal(demoHighlightColor(needsContext), "yellow");
  assert.equal(demoHighlightColor(misleading), "amber");
  assert.equal(demoHighlightColor(receipts), "yellow");
  assert.match(DEMO_PASSAGE, /300,000 gallons of water a day/);
  assert.match(DEMO_COMMENTARY, /water-usage effectiveness of 2\.2/);
  const preview = composeDemoPostText(needsContext);
  assert.match(preview, new RegExp(`^${DEMO_COMMENTARY_TITLE}\\nhttps://annotated\\.cbandcoop\\.com/factdesk/`));
  assert.doesNotMatch(preview, /x\.com\/intent|api\.twitter\.com/);
  assert.deepEqual(DEMO_TOUR_STEPS.map((item) => item.label), [
    "Highlight",
    "Open card",
    "Verdict",
    "Sources",
    "Consensus",
    "Preserved post",
    "Post to X",
  ]);
  assert.equal(demoTourIsPlaying("auto", false), true);
  assert.equal(demoTourIsPlaying("auto", true), false);
  assert.equal(demoTourIsPlaying("play", true), true);
  assert.equal(demoTourIsPlaying("pause", false), false);
  assert.equal(demoHighlightElementId("needs-context"), "demo-highlight-needs-context");
  assert.equal(demoHighlightElementId("misleading"), "demo-highlight-misleading");
  assert.deepEqual(demoOpenGraphImage("https://annotated.cbandcoop.com"), {
    url: "https://annotated.cbandcoop.com/demo/opengraph-image",
    width: 1200,
    height: 630,
    alt: DEMO_PAGE_TITLE,
  });
});

test("the public demo page is read-only, linked from the hero, and has an OG image", async () => {
  const [page, experience, image, styles, home] = await Promise.all([
    readDemo("page.tsx"),
    readDemo("demo-experience.tsx"),
    readDemo("opengraph-image.tsx"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  const surface = `${page}\n${experience}\n${image}`;

  assert.match(page, /title: DEMO_PAGE_TITLE/);
  assert.match(page, /description: DEMO_PAGE_DESCRIPTION/);
  assert.match(page, /canonical: DEMO_PAGE_PATH/);
  assert.match(page, /getMetadataBaseOrigin\(\)/);
  assert.match(page, /demoOpenGraphImage\(metadataOrigin\)/);
  assert.match(page, /images: \[demoImage\]/);
  assert.match(page, /twitter: \{ images: \[demoImage\] \}/);
  assert.equal(DEMO_PAGE_TITLE, "Annotated demo: the fact-check layer for the web");
  assert.match(experience, /\{DEMO_VALUE_PROP\}/);
  assert.match(experience, /Watch the 90-second extension demo/);
  assert.match(experience, /href="\/demo\.mp4"/);
  assert.doesNotMatch(experience, /<video/);
  const demoVideo = await readFile(new URL("../../public/demo.mp4", import.meta.url));
  assert.equal(demoVideo.byteLength, 5_099_592);
  assert.equal(
    createHash("sha256").update(demoVideo).digest("hex"),
    "fe7fa4f370a7131feb8c175f2b77782406162efa257f8b697cb027bebf42afa4",
  );
  assert.doesNotMatch(surface, /<video/);
  assert.equal(
    DEMO_VALUE_PROP,
    "Annotated is the fact-check layer for the web: highlight any claim, attach sources, and they stay attached.",
  );
  assert.match(experience, /\{DEMO_TEASER\}/);
  assert.equal(DEMO_TEASER, "AI research tab — coming next");
  assert.match(experience, /Install for Chrome/);
  assert.match(experience, /EXTENSION_WHATS_NEW_PATH/);
  assert.match(experience, /View the feed/);
  assert.match(experience, /href="\/"/);
  assert.match(experience, /DEMO_GITHUB_URL/);
  assert.match(experience, /Why this matters/);
  assert.match(experience, /aria-label="Guided tour"/);
  assert.match(experience, /"Pause"/);
  assert.match(experience, /"Play"/);
  assert.match(experience, /Replay/);
  assert.match(experience, /Skip/);
  assert.match(experience, /data-demo-highlight=\{note\.id\}/);
  assert.match(experience, /data-demo-card=""/);
  assert.match(experience, /data-demo-tour-next=""/);
  assert.match(experience, /data-demo-tour-pause=""/);
  assert.match(experience, /data-demo-tour-replay=""/);
  assert.match(experience, /data-demo-tour-skip=""/);
  assert.match(experience, /data-demo-post-x=""/);
  assert.match(experience, /data-demo-cta-install=""/);
  assert.match(experience, /data-demo-cta-feed=""/);
  assert.match(experience, /data-demo-cta-github=""/);
  assert.match(experience, /prefers-reduced-motion: reduce/);
  assert.match(experience, /Example content/);
  assert.match(experience, /Post to X/);
  assert.match(experience, /Composed text only/);
  assert.match(experience, /aria-pressed=\{pressed\}/);
  assert.match(experience, /aria-expanded=\{pressed\}/);
  assert.match(experience, /role="dialog"/);
  const escapeHandler = experience.slice(
    experience.indexOf('if (event.key !== "Escape") return;'),
    experience.indexOf("window.addEventListener"),
  );
  assert.match(escapeHandler, /focusReturnId\.current = panelNoteId/);
  assert.match(experience, /const closeCard = \(\) => \{[\s\S]*focusReturnId\.current = panelNoteId/);
  assert.match(experience, /onClick=\{closeCard\}/);
  assert.match(experience, /demo-panel-resting/);
  assert.match(experience, /desktop && resting/);
  assert.match(page, /installCallout=\{false\}/);
  assert.match(styles, /\.demo-panel\.demo-panel-resting \{ display: none; \}/);
  assert.match(experience, /document\.getElementById\(demoHighlightElementId\(noteId\)\)\?\.focus\(\)/);
  assert.match(experience, /Needs context/);
  assert.match(experience, /They stay read-only here/);
  assert.doesNotMatch(experience, /How to use this demo/);
  assert.doesNotMatch(experience, /onAgree|onDisagree|onToggleHelpful|Mark helpful/);
  assert.doesNotMatch(surface, /supabase|x\.com\/intent|rate_annotation|createClient\(/);
  assert.match(image, /ImageResponse/);
  assert.match(image, /alt = DEMO_PAGE_TITLE/);
  assert.match(image, /width: 1200/);
  assert.match(image, /height: 630/);
  assert.match(styles, /\.demo-panel \{/);
  assert.match(styles, /\.demo-highlight-amber/);
  assert.match(styles, /\.demo-highlight-yellow/);
  const desktop = styles.slice(styles.lastIndexOf("@media (min-width: 960px)"));
  assert.match(desktop, /\.demo-panel \{[\s\S]*position: sticky/);
  assert.match(desktop, /\.demo-backdrop \{ display: none; \}/);
  assert.match(desktop, /\.demo-panel\.demo-panel-resting \{ display: grid; \}/);
  assert.match(home, /href="\/demo"/);
  const hero = home.slice(home.indexOf("landing-hero"), home.indexOf("</header>"));
  assert.match(hero, /href="\/demo"/);
});
