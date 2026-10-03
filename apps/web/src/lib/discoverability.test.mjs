import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FEED_LEDE,
  getLlmsTxt,
  getPublicPageStructuredData,
  getRobotsDocument,
  getSitemapEntries,
  INDEXABLE_PUBLIC_PATHS,
  LEGAL_HEADING,
  LEGAL_LEDE,
  PRIVACY_LEDE,
  TERMS_LEDE,
  TRENDING_HEADING,
  TRENDING_LEDE,
  WHO_TO_FOLLOW_HEADING,
  WHO_TO_FOLLOW_LEDE,
} from "./discoverability.ts";
import { LEGAL_OPERATOR, LEGAL_PATHS } from "./legal.ts";
import { WHO_TO_FOLLOW_PATH } from "./data/who-to-follow.ts";

const ORIGIN = "https://annotated.example";

function withOrigin(run) {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
}

test("llms.txt follows the consultancy reading-file shape with published facts", () => {
  const text = withOrigin(() => getLlmsTxt());
  assert.match(text, /^# Annotated\n\n> Annotated is a public web application/);
  assert.match(text, /\n## Pages\n\n- \[Feed\]/);
  assert.match(text, /\n## Contact\n\n- Email: /);
  assert.match(text, /\n## Optional\n\n- \[Sitemap\]/);
  assert.match(text, new RegExp(`\\[Feed\\]\\(${ORIGIN}/\\): ${escapeRegExp(FEED_LEDE)}`));
  assert.match(text, new RegExp(`\\[Trending\\]\\(${ORIGIN}/trending\\):`));
  assert.match(text, new RegExp(`\\[Who to Follow\\]\\(${ORIGIN}${WHO_TO_FOLLOW_PATH}\\):`));
  assert.match(text, new RegExp(`\\[Legal\\]\\(${ORIGIN}${LEGAL_PATHS.center}\\):`));
  assert.match(text, new RegExp(`\\[Privacy Policy\\]\\(${ORIGIN}${LEGAL_PATHS.privacy}\\):`));
  assert.match(text, new RegExp(`\\[Terms of Service\\]\\(${ORIGIN}${LEGAL_PATHS.terms}\\):`));
  assert.match(text, new RegExp(`Email: ${LEGAL_OPERATOR.email}`));
  assert.match(text, new RegExp(escapeRegExp(LEGAL_OPERATOR.person)));
  assert.match(text, new RegExp(escapeRegExp(LEGAL_OPERATOR.company)));
  assert.match(text, new RegExp(escapeRegExp(LEGAL_OPERATOR.street)));
  assert.match(text, new RegExp(escapeRegExp(LEGAL_OPERATOR.locality)));
  assert.match(text, /Selected hosted media ranges are between 1 and 90 seconds/);
  assert.match(text, /free beta/);
  assert.match(text, /at least 18 years old/);
  assert.doesNotMatch(text, /lovable\.app/i);
  assert.doesNotMatch(text, /\bphone\b|twitter\.com|instagram\.com|\$\d|\boffers?\b/i);
  assert.equal(text.endsWith("\n"), true);
});

test("robots and sitemap cover the stable public pages and skip private routes", () => {
  const robots = withOrigin(() => getRobotsDocument());
  assert.equal(robots.rules.userAgent, "*");
  assert.equal(robots.rules.allow, "/");
  assert.deepEqual(robots.rules.disallow, ["/api/", "/auth/", "/me", "/ops"]);
  assert.equal(robots.sitemap, `${ORIGIN}/sitemap.xml`);

  const urls = withOrigin(() => getSitemapEntries()).map((entry) => entry.url);
  assert.deepEqual(urls, [
    `${ORIGIN}/`,
    `${ORIGIN}/trending`,
    `${ORIGIN}${WHO_TO_FOLLOW_PATH}`,
    `${ORIGIN}${LEGAL_PATHS.center}`,
    `${ORIGIN}${LEGAL_PATHS.privacy}`,
    `${ORIGIN}${LEGAL_PATHS.terms}`,
  ]);
  assert.equal(INDEXABLE_PUBLIC_PATHS.length, urls.length);
  assert.equal(urls.some((url) => url.includes("/me") || url.includes("/ops")), false);
});

test("structured data repeats visible page copy and does not invent an offer", () => {
  const documents = withOrigin(() => INDEXABLE_PUBLIC_PATHS.map((path) => ({
    path,
    data: getPublicPageStructuredData(path),
  })));

  const serialized = JSON.stringify(documents);
  assert.doesNotMatch(serialized, /aggregateRating|offers|price|reviewCount/i);
  assert.doesNotMatch(serialized, /lovable\.app/i);

  const feed = documents.find((entry) => entry.path === "/").data;
  assert.equal(feed["@graph"][0]["@type"], "WebSite");
  assert.equal(feed["@graph"][0].name, "Annotated");
  assert.equal(feed["@graph"][0].description, FEED_LEDE);
  assert.equal(feed["@graph"][0].url, `${ORIGIN}/`);
  assert.equal(feed["@graph"][0].publisher.name, LEGAL_OPERATOR.company);
  assert.equal(feed["@graph"][0].publisher.email, LEGAL_OPERATOR.email);
  assert.equal(feed["@graph"][0].publisher.address, undefined);

  const trending = documents.find((entry) => entry.path === "/trending").data;
  assert.equal(trending["@graph"][0].name, TRENDING_HEADING);
  assert.equal(trending["@graph"][0].description, TRENDING_LEDE);
  assert.equal(trending["@graph"][0].url, `${ORIGIN}/trending`);

  const follow = documents.find((entry) => entry.path === WHO_TO_FOLLOW_PATH).data;
  assert.equal(follow["@graph"][0].name, WHO_TO_FOLLOW_HEADING);
  assert.equal(follow["@graph"][0].description, WHO_TO_FOLLOW_LEDE);

  for (const path of [LEGAL_PATHS.center, LEGAL_PATHS.privacy, LEGAL_PATHS.terms]) {
    const page = documents.find((entry) => entry.path === path).data;
    const webPage = page["@graph"][0];
    const person = page["@graph"][1];
    assert.equal(webPage["@type"], "WebPage");
    assert.equal(webPage.publisher.email, LEGAL_OPERATOR.email);
    assert.equal(webPage.publisher.address.streetAddress, LEGAL_OPERATOR.street);
    assert.equal(
      `${webPage.publisher.address.addressLocality}, ${webPage.publisher.address.addressRegion} ${webPage.publisher.address.postalCode}`,
      LEGAL_OPERATOR.locality,
    );
    assert.equal(webPage.publisher.address.addressCountry, LEGAL_OPERATOR.country);
    assert.equal(person["@type"], "Person");
    assert.equal(person.name, LEGAL_OPERATOR.person);
    assert.equal(person.email, LEGAL_OPERATOR.email);
  }

  const legal = documents.find((entry) => entry.path === LEGAL_PATHS.center).data;
  assert.equal(legal["@graph"][0].name, LEGAL_HEADING);
  assert.equal(legal["@graph"][0].description, LEGAL_LEDE);
  const privacy = documents.find((entry) => entry.path === LEGAL_PATHS.privacy).data;
  assert.equal(privacy["@graph"][0].description, PRIVACY_LEDE);
  const terms = documents.find((entry) => entry.path === LEGAL_PATHS.terms).data;
  assert.equal(terms["@graph"][0].description, TERMS_LEDE);
});

test("missing site origin omits absolute urls instead of inventing one", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    assert.equal(getPublicPageStructuredData("/"), null);
    assert.equal(getRobotsDocument().sitemap, undefined);
    assert.deepEqual(getSitemapEntries(), []);
    const text = getLlmsTxt();
    assert.match(text, /\[Feed\]\(\/\):/);
    assert.match(text, new RegExp(`Email: ${LEGAL_OPERATOR.email}`));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("public pages wire canonical urls and the shared visible copy", async () => {
  const [layout, home, trending, follow, legal, privacy, terms, robots, sitemap, llms] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/trending/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/who-to-follow/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/robots.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/llms.txt/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /metadataBase: new URL\(siteOrigin\)/);
  assert.match(home, /alternates: \{ canonical: getPageHref\(FEED_PATH, page\) \}/);
  assert.match(home, /FEED_LEDE/);
  assert.match(home, /getPublicPageStructuredData\(FEED_PATH\)/);
  assert.match(trending, /canonical: TRENDING_PATH/);
  assert.match(trending, /TRENDING_HEADING/);
  assert.match(trending, /TRENDING_LEDE/);
  assert.match(follow, /canonical: WHO_TO_FOLLOW_PATH/);
  assert.match(follow, /WHO_TO_FOLLOW_HEADING/);
  assert.match(follow, /WHO_TO_FOLLOW_LEDE/);
  assert.match(legal, /canonical: LEGAL_PATHS\.center/);
  assert.match(legal, /LEGAL_HEADING/);
  assert.match(privacy, /canonical: LEGAL_PATHS\.privacy/);
  assert.match(privacy, /structuredData=\{getPublicPageStructuredData\(LEGAL_PATHS\.privacy\)\}/);
  assert.match(terms, /canonical: LEGAL_PATHS\.terms/);
  assert.match(terms, /structuredData=\{getPublicPageStructuredData\(LEGAL_PATHS\.terms\)\}/);
  assert.match(robots, /getRobotsDocument/);
  assert.match(sitemap, /getSitemapEntries/);
  assert.match(llms, /text\/plain; charset=utf-8/);
  assert.match(llms, /getLlmsTxt/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
