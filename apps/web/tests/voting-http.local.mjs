import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const USER_IDS = {
  owner: "d2b90000-0000-4000-8000-000000000001",
  voterA: "d2b90000-0000-4000-8000-000000000002",
  voterB: "d2b90000-0000-4000-8000-000000000003",
};
const SOURCE_ID = "d2b92000-0000-4000-8000-000000000001";
const ANNOTATION_IDS = {
  public: "d2b91000-0000-4000-8000-000000000001",
  rate: "d2b91000-0000-4000-8000-000000000002",
  draft: "d2b91000-0000-4000-8000-000000000003",
};

function parseEnvironment(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function readLocalSupabaseEnvironment() {
  const options = {
    cwd: new URL("../../../", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  const output = process.platform === "win32"
    ? execFileSync(
        process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/c", "pnpm exec supabase status -o env"],
        options,
      )
    : execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], options);
  return parseEnvironment(output);
}

const environment = parseEnvironment(
  await readFile(new URL("../.env.local", import.meta.url), "utf8"),
);
for (const key of [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (process.env[key]) environment[key] = process.env[key];
}
const localSupabase = readLocalSupabaseEnvironment();
const localSupabaseUrl = new URL(localSupabase.API_URL);
assert.ok(
  localSupabaseUrl.hostname === "127.0.0.1" || localSupabaseUrl.hostname === "localhost",
  "Supabase CLI did not return a loopback API URL",
);
localSupabaseUrl.hostname = "localhost";
environment.NEXT_PUBLIC_SUPABASE_URL = localSupabaseUrl.origin;
environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = localSupabase.ANON_KEY;
environment.SUPABASE_SERVICE_ROLE_KEY = localSupabase.SERVICE_ROLE_KEY;
const siteUrl = new URL(environment.NEXT_PUBLIC_SITE_URL);
const supabaseUrl = new URL(environment.NEXT_PUBLIC_SUPABASE_URL);
const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;

function assertLoopbackTarget(url) {
  const parsed = url instanceof URL ? url : new URL(url);
  assert.equal(parsed.protocol, "http:", "Local HTTP tests require HTTP loopback");
  assert.ok(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost",
    "Local HTTP tests require a verified loopback hostname",
  );
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  return parsed;
}

assertLoopbackTarget(siteUrl);
assertLoopbackTarget(supabaseUrl);
assert.ok(publishableKey && serviceKey, "Local Supabase keys are required but are never printed");

const service = createClient(supabaseUrl.origin, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function webRequest(path, init = {}) {
  const target = assertLoopbackTarget(new URL(path, siteUrl));
  assert.equal(target.origin, siteUrl.origin, "Every web integration request must use the trusted Local origin");
  return fetch(target, { redirect: "manual", ...init });
}

async function apiJson(path, init, expectedStatus) {
  const response = await webRequest(path, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { throw new Error(`Non-JSON Local response at ${path}`); }
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}: ${text.slice(0, 160)}`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  return { response, body };
}

async function mutation(annotationId, cookie, value, expectedStatus = 200, extraBody = {}) {
  return apiJson(`/api/annotations/${annotationId}/vote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: siteUrl.origin,
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ value, ...extraBody }),
  }, expectedStatus);
}

function runExactLocalSql(sql) {
  assertLoopbackTarget(supabaseUrl);
  return execFileSync(
    "docker",
    [
      "exec", "supabase_db_Annotated", "psql", "-X", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-Atc", sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function ageExactPairRateWindow() {
  const result = runExactLocalSql(`
    update private.annotation_vote_pair_rate_limits
    set window_started_at = pg_catalog.now() - interval '11 minutes'
    where user_id = '${USER_IDS.voterA}'::uuid
      and annotation_id = '${ANNOTATION_IDS.rate}'::uuid
      and window_started_at > pg_catalog.now() - interval '10 minutes'
  `);
  assert.equal(result, "UPDATE 1", "exactly one disposable pair limiter window must be aged");
}

function assertDiscoveryIsolation(html, surface) {
  const newer = html.indexOf("D2b rate voting fixture");
  const older = html.indexOf("D2b public voting fixture");
  assert.ok(newer >= 0, `${surface} omitted the newer published fixture`);
  assert.ok(older >= 0, `${surface} omitted the older published fixture`);
  assert.ok(newer < older, `${surface} did not preserve published_at DESC ordering`);
  assert.equal(html.includes("D2b private voting fixture"), false, `${surface} exposed a draft`);
  assert.doesNotMatch(html, /Sign in to vote|aria-label="(?:Upvote|Downvote)/);
  assert.doesNotMatch(html, /upvoteCount|downvoteCount|currentVote|get_public_annotation_vote_totals/);
  return {
    newerBeforeOlder: true,
    publishedCount: ["D2b rate voting fixture", "D2b public voting fixture"]
      .filter((value) => html.includes(value)).length,
    draftVisible: html.includes("D2b private voting fixture"),
    voteControlsVisible: /Sign in to vote|aria-label="(?:Upvote|Downvote)/.test(html),
  };
}

async function cleanFixtures({ verify = false } = {}) {
  await service.from("annotation_targets").delete().in("annotation_id", Object.values(ANNOTATION_IDS));
  await service.from("annotations").delete().in("id", Object.values(ANNOTATION_IDS));
  await service.from("sources").delete().eq("id", SOURCE_ID);
  for (const id of Object.values(USER_IDS)) {
    await service.auth.admin.deleteUser(id).catch(() => undefined);
  }
  if (verify) {
    const [sources, annotations] = await Promise.all([
      service.from("sources").select("id").eq("id", SOURCE_ID),
      service.from("annotations").select("id").in("id", Object.values(ANNOTATION_IDS)),
    ]);
    assert.deepEqual(sources.data, []);
    assert.deepEqual(annotations.data, []);
    const aggregate = await service.rpc("get_public_annotation_vote_totals", {
      p_annotation_ids: Object.values(ANNOTATION_IDS),
    });
    assert.ifError(aggregate.error);
    assert.deepEqual(aggregate.data, []);
    const privateStateCount = runExactLocalSql(`
      select (
        (select pg_catalog.count(*) from public.annotation_votes
         where annotation_id = any(array[
           '${ANNOTATION_IDS.public}'::uuid,
           '${ANNOTATION_IDS.rate}'::uuid,
           '${ANNOTATION_IDS.draft}'::uuid
         ]))
        +
        (select pg_catalog.count(*) from private.annotation_vote_pair_rate_limits
         where annotation_id = any(array[
           '${ANNOTATION_IDS.public}'::uuid,
           '${ANNOTATION_IDS.rate}'::uuid,
           '${ANNOTATION_IDS.draft}'::uuid
         ]))
        +
        (select pg_catalog.count(*) from private.annotation_vote_user_rate_limits
         where user_id = any(array[
           '${USER_IDS.owner}'::uuid,
           '${USER_IDS.voterA}'::uuid,
           '${USER_IDS.voterB}'::uuid
         ]))
      )
    `);
    assert.equal(privateStateCount, "0");
  }
}

async function createFixtures() {
  for (const [name, id] of Object.entries(USER_IDS)) {
    const created = await service.auth.admin.createUser({
      id,
      email: `phase-d2b-${name.toLowerCase()}@example.test`,
      password: "local-disposable-D2b-only-2026",
      email_confirm: true,
      user_metadata: { full_name: `D2b ${name}` },
    });
    assert.ifError(created.error);
    assert.equal(created.data.user?.id, id);
  }

  const source = await service.from("sources").insert({
    id: SOURCE_ID,
    normalized_url: "https://example.test/d2b/http",
    canonical_url: "https://example.test/d2b/http",
    source_type: "article",
    title: "D2b HTTP voting fixture",
  });
  assert.ifError(source.error);

  const annotations = await service.from("annotations").insert([
    {
      id: ANNOTATION_IDS.public,
      source_id: SOURCE_ID,
      user_id: USER_IDS.owner,
      annotation_type: "article_text",
      commentary_text: "D2b public voting fixture",
      status: "published",
      published_at: "2026-08-25T12:00:00.000Z",
    },
    {
      id: ANNOTATION_IDS.rate,
      source_id: SOURCE_ID,
      user_id: USER_IDS.owner,
      annotation_type: "article_text",
      commentary_text: "D2b rate voting fixture",
      status: "published",
      published_at: "2026-08-25T12:01:00.000Z",
    },
    {
      id: ANNOTATION_IDS.draft,
      source_id: SOURCE_ID,
      user_id: USER_IDS.owner,
      annotation_type: "article_text",
      commentary_text: "D2b private voting fixture",
      status: "draft",
    },
  ]);
  assert.ifError(annotations.error);

  const targets = await service.from("annotation_targets").insert([
    {
      annotation_id: ANNOTATION_IDS.public,
      target_type: "text",
      selected_text: "The public D2b selected passage.",
    },
    {
      annotation_id: ANNOTATION_IDS.rate,
      target_type: "text",
      selected_text: "The rate-limit D2b selected passage.",
    },
  ]);
  assert.ifError(targets.error);
}

async function sessionCookie(userName) {
  const authClient = createClient(supabaseUrl.origin, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signedIn = await authClient.auth.signInWithPassword({
    email: `phase-d2b-${userName.toLowerCase()}@example.test`,
    password: "local-disposable-D2b-only-2026",
  });
  assert.ifError(signedIn.error);
  assert.ok(signedIn.data.session);

  const cookieValues = new Map();
  const serverClient = createServerClient(supabaseUrl.origin, publishableKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => cookies.forEach(({ name, value }) => cookieValues.set(name, value)),
    },
  });
  const sessionSet = await serverClient.auth.setSession({
    access_token: signedIn.data.session.access_token,
    refresh_token: signedIn.data.session.refresh_token,
  });
  assert.ifError(sessionSet.error);
  return [...cookieValues].map(([name, value]) => `${name}=${value}`).join("; ");
}

let cleanupRequired = false;
try {
  await cleanFixtures();
  cleanupRequired = true;
  await createFixtures();
  const [ownerCookie, voterACookie, voterBCookie] = await Promise.all([
    sessionCookie("owner"),
    sessionCookie("votera"),
    sessionCookie("voterb"),
  ]);

  const feedBefore = assertDiscoveryIsolation(
    await (await webRequest("/", { cache: "no-store" })).text(),
    "public feed before voting",
  );
  const profileBefore = assertDiscoveryIsolation(
    await (await webRequest(`/p/${USER_IDS.owner}`, { cache: "no-store" })).text(),
    "profile before voting",
  );

  const signedOut = await apiJson(
    `/api/annotations/${ANNOTATION_IDS.public}/vote`,
    { method: "GET", cache: "no-store" },
    200,
  );
  assert.deepEqual(signedOut.body, { currentVote: null, upvoteCount: 0, downvoteCount: 0 });

  const anonymousMutation = await mutation(ANNOTATION_IDS.public, null, 1, 401);
  assert.deepEqual(anonymousMutation.body, { error: "AUTH_REQUIRED" });

  const crossOrigin = await apiJson(`/api/annotations/${ANNOTATION_IDS.public}/vote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://cross-origin.example",
      "sec-fetch-site": "cross-site",
      cookie: voterACookie,
    },
    body: JSON.stringify({ value: 1 }),
  }, 403);
  assert.deepEqual(crossOrigin.body, { error: "CROSS_ORIGIN_REQUEST" });

  const substitutedUser = await mutation(
    ANNOTATION_IDS.public,
    voterACookie,
    1,
    400,
    { userId: USER_IDS.voterB },
  );
  assert.deepEqual(substitutedUser.body, { error: "INVALID_REQUEST" });

  const created = await mutation(ANNOTATION_IDS.public, voterACookie, 1);
  assert.deepEqual(created.body, {
    resultCode: "CREATED",
    currentVote: 1,
    upvoteCount: 1,
    downvoteCount: 0,
  });
  const voterAState = await apiJson(
    `/api/annotations/${ANNOTATION_IDS.public}/vote`,
    { method: "GET", headers: { cookie: voterACookie }, cache: "no-store" },
    200,
  );
  assert.deepEqual(voterAState.body, { currentVote: 1, upvoteCount: 1, downvoteCount: 0 });
  const voterBState = await apiJson(
    `/api/annotations/${ANNOTATION_IDS.public}/vote`,
    { method: "GET", headers: { cookie: voterBCookie }, cache: "no-store" },
    200,
  );
  assert.deepEqual(voterBState.body, { currentVote: null, upvoteCount: 1, downvoteCount: 0 });

  const changed = await mutation(ANNOTATION_IDS.public, voterACookie, -1);
  assert.deepEqual(changed.body, {
    resultCode: "CHANGED",
    currentVote: -1,
    upvoteCount: 0,
    downvoteCount: 1,
  });
  const cleared = await mutation(ANNOTATION_IDS.public, voterACookie, null);
  assert.deepEqual(cleared.body, {
    resultCode: "CLEARED",
    currentVote: null,
    upvoteCount: 0,
    downvoteCount: 0,
  });

  const selfVote = await mutation(ANNOTATION_IDS.public, ownerCookie, 1, 403);
  assert.deepEqual(selfVote.body, { error: "SELF_VOTE_FORBIDDEN" });
  const privateVote = await mutation(ANNOTATION_IDS.draft, voterACookie, 1, 404);
  assert.deepEqual(privateVote.body, { error: "ANNOTATION_UNAVAILABLE" });

  let acceptedRateState = null;
  for (let index = 0; index < 20; index += 1) {
    const accepted = await mutation(ANNOTATION_IDS.rate, voterACookie, index % 2 === 0 ? 1 : -1);
    acceptedRateState = accepted.body;
  }
  const rateLimited = await mutation(ANNOTATION_IDS.rate, voterACookie, 1, 429);
  assert.equal(rateLimited.body.error, "RATE_LIMITED");
  assert.equal(rateLimited.body.currentVote, acceptedRateState.currentVote);
  assert.equal(rateLimited.body.upvoteCount, acceptedRateState.upvoteCount);
  assert.equal(rateLimited.body.downvoteCount, acceptedRateState.downvoteCount);
  assert.ok(rateLimited.body.retryAfterSeconds >= 1 && rateLimited.body.retryAfterSeconds <= 600);
  assert.equal(rateLimited.response.headers.get("retry-after"), String(rateLimited.body.retryAfterSeconds));

  ageExactPairRateWindow();
  const recovered = await mutation(ANNOTATION_IDS.rate, voterACookie, 1);
  assert.deepEqual(recovered.body, {
    resultCode: "CHANGED",
    currentVote: 1,
    upvoteCount: 1,
    downvoteCount: 0,
  });

  await mutation(ANNOTATION_IDS.public, voterACookie, 1);
  const routeRows = await service
    .from("annotations")
    .select("slug, profiles!annotations_user_id_fkey(username)")
    .eq("id", ANNOTATION_IDS.public)
    .single();
  assert.ifError(routeRows.error);
  const profile = Array.isArray(routeRows.data.profiles)
    ? routeRows.data.profiles[0]
    : routeRows.data.profiles;
  const canonicalPath = `/${profile.username}/${routeRows.data.slug}`;

  const signedOutPage = await webRequest(canonicalPath, { cache: "no-store" });
  assert.equal(signedOutPage.status, 200);
  const signedOutHtml = await signedOutPage.text();
  assert.match(signedOutHtml, /Sign in to vote/);
  assert.match(signedOutHtml, /aria-label="Upvote; 1 upvote"/);
  assert.match(signedOutHtml, /aria-label="Downvote; 0 downvotes"/);

  const voterPage = await webRequest(canonicalPath, {
    headers: { cookie: voterACookie },
    cache: "no-store",
  });
  assert.equal(voterPage.status, 200);
  const voterHtml = await voterPage.text();
  assert.match(voterHtml, /aria-pressed="true"/);
  assert.doesNotMatch(voterHtml, /Sign in to vote/);

  const ownerPage = await webRequest(canonicalPath, {
    headers: { cookie: ownerCookie },
    cache: "no-store",
  });
  assert.equal(ownerPage.status, 200);
  assert.match(await ownerPage.text(), /Creators cannot vote on their own annotations/);

  const feedAfter = assertDiscoveryIsolation(
    await (await webRequest("/", { cache: "no-store" })).text(),
    "public feed after voting",
  );
  const profileAfter = assertDiscoveryIsolation(
    await (await webRequest(`/p/${USER_IDS.owner}`, { cache: "no-store" })).text(),
    "profile after voting",
  );
  assert.deepEqual(feedAfter, feedBefore);
  assert.deepEqual(profileAfter, profileBefore);

  const publicPayloads = JSON.stringify([
    signedOut.body,
    voterAState.body,
    voterBState.body,
    created.body,
    changed.body,
    cleared.body,
    rateLimited.body,
  ]);
  for (const userId of Object.values(USER_IDS)) assert.equal(publicPayloads.includes(userId), false);
  assert.equal(/user[_-]?id|voter/i.test(publicPayloads), false);

  const directVoteRead = await service.from("annotation_votes").select("*");
  assert.ok(directVoteRead.error, "service API role must remain unable to read voter rows");

  console.log("PASS: verified Local sessions create, change, clear, and isolate current-user vote state.");
  console.log("PASS: same-origin, caller-ID rejection, self-vote, private-state, and HTTP 429 boundaries hold.");
  console.log("PASS: canonical page renders signed-out, selected-vote, creator, and accessible total states.");
  console.log("PASS: feed and profile cards remain vote-free with unchanged publication ordering.");
  console.log("PASS: exact disposable pair limiter window recovered after the recorded HTTP 429.");
  console.log("PASS: public responses contain no voter identities or readable vote graph.");
} finally {
  if (cleanupRequired) {
    await cleanFixtures({ verify: true });
    console.log("PASS: exact Local D2b HTTP fixtures were removed and absence verified.");
  }
}
