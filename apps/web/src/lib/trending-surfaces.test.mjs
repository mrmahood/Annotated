import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web Feed strip and /trending page hide below two scored items", async () => {
  const [home, page, strip, header, routes, handles, discovery] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/trending/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/trending-strip.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("./public-routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../packages/shared/src/profile-handle.ts", import.meta.url), "utf8"),
    readFile(new URL("./data/public-discovery.ts", import.meta.url), "utf8"),
  ]);

  assert.match(home, /getTrendingFeedItems/);
  assert.match(home, /trending\.visible/);
  assert.match(home, /TrendingStrip/);
  assert.match(home, /page === 1 \? getTrendingFeedItems/);
  assert.match(page, /getTrendingFeedItems/);
  assert.match(page, /Not enough trending activity yet/);
  assert.match(page, /!trending\.visible/);
  assert.match(page, /active="trending"/);
  assert.match(strip, /Browse Trending/);
  assert.match(strip, /href="\/trending"/);
  assert.match(strip, /getPublicAnnotationPath/);
  assert.match(header, /href="\/trending"/);
  assert.match(header, />\s*Trending\s*</);
  assert.match(routes, /isReservedProfileHandle/);
  assert.match(handles, /'trending'/);
  assert.match(discovery, /list_trending_annotations/);
  assert.doesNotMatch(home + page + strip, /view_count|pageview|telemetry/i);
  assert.doesNotMatch(discovery, /from\("annotation_trending_boosts"\)/);
});

test("ops trending boost stays on the allowlisted /ops path", async () => {
  const [opsPage, opsConsole, route, trending] = await Promise.all([
    readFile(new URL("../app/ops/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ops/ops-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/moderation/trending/boosts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./data/trending.ts", import.meta.url), "utf8"),
  ]);

  assert.match(opsPage, /canAccessOperatorConsole/);
  assert.match(opsPage, /notFound\(\)/);
  assert.match(opsConsole, /Trending boosts/);
  assert.match(opsConsole, /TRENDING_BOOST_CONFIRMATION/);
  assert.match(opsConsole, /Set boost/);
  assert.match(opsConsole, /Clear boost/);
  assert.match(route, /assertModerationOperatorAllowlist/);
  assert.match(route, /set_annotation_trending_boost/);
  assert.match(route, /clear_annotation_trending_boost/);
  assert.match(route, /list_annotation_trending_boosts/);
  assert.match(route, /createServiceClient/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_SUPABASE_SERVICE|service_role_key/i);
  assert.match(trending, /TRENDING_BOOST_CONFIRMATION = "TRENDING_BOOST"/);
  assert.doesNotMatch(opsConsole, /Who to Follow|who-to-follow/i);
});
