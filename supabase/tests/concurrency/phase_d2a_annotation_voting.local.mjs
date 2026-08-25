import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const USER_IDS = {
  owner: "d2ac0000-0000-4000-8000-000000000001",
  pair: "d2ac0000-0000-4000-8000-000000000002",
  direction: "d2ac0000-0000-4000-8000-000000000003",
  global: "d2ac0000-0000-4000-8000-000000000004",
  clear: "d2ac0000-0000-4000-8000-000000000005",
};
const SOURCE_ID = "d2ac2000-0000-4000-8000-000000000001";
const ANNOTATION_IDS = Array.from(
  { length: 7 },
  (_, index) => `d2ac1000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function readLocalEnvironment() {
  const output = process.platform === "win32"
    ? execFileSync(
        process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/c", "pnpm exec supabase status -o env"],
        { cwd: new URL("../../../", import.meta.url), encoding: "utf8" },
      )
    : execFileSync(
        "pnpm",
        ["exec", "supabase", "status", "-o", "env"],
        { cwd: new URL("../../../", import.meta.url), encoding: "utf8" },
      );
  const environment = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/);
    if (match) environment[match[1]] = match[2] ?? match[3];
  }
  assert.match(environment.API_URL ?? "", /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  assert.ok(environment.SERVICE_ROLE_KEY, "Local service role key is unavailable");
  return {
    apiUrl: environment.API_URL,
    serviceRoleKey: environment.SERVICE_ROLE_KEY,
  };
}

const { apiUrl, serviceRoleKey } = readLocalEnvironment();
const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

async function request(path, init = {}, expectedStatuses = [200]) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...serviceHeaders, ...init.headers },
  });
  const text = await response.text();
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`Unexpected Local response ${response.status} for ${path}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function mutate(userId, annotationId, value) {
  const rows = await request("/rest/v1/rpc/mutate_annotation_vote", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId,
      p_annotation_id: annotationId,
      p_value: value,
    }),
  });
  assert.equal(rows.length, 1);
  return rows[0];
}

async function totals(annotationIds) {
  return request("/rest/v1/rpc/get_public_annotation_vote_totals", {
    method: "POST",
    body: JSON.stringify({ p_annotation_ids: annotationIds }),
  });
}

async function createFixtures() {
  for (const [name, id] of Object.entries(USER_IDS)) {
    await request("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        id,
        email: `phase-d2a-${name}@example.test`,
        password: "local-disposable-D2a-only-2026",
        email_confirm: true,
        user_metadata: { full_name: `D2a ${name}` },
      }),
    });
  }

  await request("/rest/v1/sources", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      id: SOURCE_ID,
      normalized_url: "https://example.test/d2a/concurrency",
      canonical_url: "https://example.test/d2a/concurrency",
      source_type: "article",
      title: "D2a concurrent voting fixture",
    }),
  }, [201]);

  await request("/rest/v1/annotations", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(ANNOTATION_IDS.map((id, index) => ({
      id,
      source_id: SOURCE_ID,
      user_id: USER_IDS.owner,
      annotation_type: "article_text",
      commentary_text: `D2a concurrent annotation ${index + 1}`,
      status: "published",
      published_at: new Date().toISOString(),
    }))),
  }, [201]);
}

async function cleanFixtures({ verify = false } = {}) {
  await request(
    `/rest/v1/annotations?id=in.(${ANNOTATION_IDS.join(",")})`,
    { method: "DELETE", headers: { prefer: "return=minimal" } },
    [204],
  ).catch(() => undefined);
  await request(
    `/rest/v1/sources?id=eq.${SOURCE_ID}`,
    { method: "DELETE", headers: { prefer: "return=minimal" } },
    [204],
  ).catch(() => undefined);
  for (const id of Object.values(USER_IDS)) {
    await request(`/auth/v1/admin/users/${id}`, { method: "DELETE" }, [200, 204, 404])
      .catch(() => undefined);
  }

  if (verify) {
    const sources = await request(`/rest/v1/sources?id=eq.${SOURCE_ID}&select=id`);
    const annotations = await request(
      `/rest/v1/annotations?id=in.(${ANNOTATION_IDS.join(",")})&select=id`,
    );
    assert.deepEqual(sources, []);
    assert.deepEqual(annotations, []);
    assert.deepEqual(await totals(ANNOTATION_IDS), []);
  }
}

let fixturesCreated = false;
try {
  await cleanFixtures();
  fixturesCreated = true;
  await createFixtures();

  const directVoteRead = await fetch(`${apiUrl}/rest/v1/annotation_votes?select=*`, {
    headers: serviceHeaders,
  });
  assert.equal(directVoteRead.status, 403, "service role must not read voter rows directly");
  assert.equal((await directVoteRead.text()).includes(USER_IDS.pair), false);

  const pairResults = await Promise.all(
    Array.from({ length: 20 }, () => mutate(USER_IDS.pair, ANNOTATION_IDS[0], 1)),
  );
  assert.equal(pairResults.filter(({ result_code }) => result_code === "CREATED").length, 1);
  assert.equal(pairResults.filter(({ result_code }) => result_code === "UNCHANGED").length, 19);
  const pairRejected = await mutate(USER_IDS.pair, ANNOTATION_IDS[0], -1);
  assert.equal(pairRejected.result_code, "RATE_LIMITED");
  assert.equal(pairRejected.current_vote, 1);
  assert.ok(pairRejected.retry_after_seconds >= 1 && pairRejected.retry_after_seconds <= 600);

  const directionResults = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      mutate(USER_IDS.direction, ANNOTATION_IDS[0], index % 2 === 0 ? 1 : -1)),
  );
  assert.equal(directionResults.filter(({ result_code }) => result_code === "CREATED").length, 1);
  assert.equal(directionResults.every(({ result_code }) =>
    ["CREATED", "CHANGED", "UNCHANGED"].includes(result_code)), true);
  const pairTotals = await totals([ANNOTATION_IDS[0]]);
  assert.equal(pairTotals[0].upvote_count + pairTotals[0].downvote_count, 2);
  assert.deepEqual(Object.keys(pairTotals[0]).sort(), [
    "annotation_id", "downvote_count", "upvote_count",
  ]);

  const clearCreated = await mutate(USER_IDS.clear, ANNOTATION_IDS[6], 1);
  assert.equal(clearCreated.result_code, "CREATED");
  const clearResults = await Promise.all(
    Array.from({ length: 19 }, () => mutate(USER_IDS.clear, ANNOTATION_IDS[6], null)),
  );
  assert.equal(clearResults.filter(({ result_code }) => result_code === "CLEARED").length, 1);
  assert.equal(clearResults.filter(({ result_code }) => result_code === "UNCHANGED").length, 18);
  assert.deepEqual(await totals([ANNOTATION_IDS[6]]), [{
    annotation_id: ANNOTATION_IDS[6],
    upvote_count: 0,
    downvote_count: 0,
  }]);

  for (let annotationIndex = 0; annotationIndex < 5; annotationIndex += 1) {
    const batch = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        mutate(USER_IDS.global, ANNOTATION_IDS[annotationIndex], index % 2 === 0 ? 1 : -1)),
    );
    assert.equal(batch.every(({ result_code }) => result_code !== "RATE_LIMITED"), true);
  }
  const globalRejected = await mutate(USER_IDS.global, ANNOTATION_IDS[5], 1);
  assert.equal(globalRejected.result_code, "RATE_LIMITED");
  assert.equal(globalRejected.current_vote, null);
  assert.ok(globalRejected.retry_after_seconds >= 1 && globalRejected.retry_after_seconds <= 600);
  const untouchedTotals = await totals([ANNOTATION_IDS[5]]);
  assert.deepEqual(untouchedTotals, [{
    annotation_id: ANNOTATION_IDS[5],
    upvote_count: 0,
    downvote_count: 0,
  }]);

  console.log("PASS: concurrent create/change/clear and pair/global rejection remained atomic.");
  console.log("PASS: voter identities and private limiter state were unavailable over the API.");
} finally {
  if (fixturesCreated) {
    await cleanFixtures({ verify: true });
    console.log("PASS: exact Local D2a concurrency fixtures were removed and absence verified.");
  }
}
