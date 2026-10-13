import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FOLLOW_INSERT_PREFER,
  followInsertHeaders,
  requireFollowSession,
} from "./follow-session.ts";

const FOLLOWER_ID = "bf09f0e7-50b7-4eb6-80c1-9ed0ee7b6f9f";
const ACCESS_TOKEN = "session-access-token";

function createAuth(sessions) {
  const calls = [];
  let reads = 0;
  return {
    calls,
    auth: {
      async initialize() {
        calls.push(["initialize"]);
      },
      async getSession() {
        const session = sessions[Math.min(reads, sessions.length - 1)] ?? null;
        reads += 1;
        calls.push(["getSession", Boolean(session?.access_token)]);
        return { data: { session }, error: null };
      },
      async getUser(jwt) {
        calls.push(["getUser", jwt ?? null]);
        if (jwt !== ACCESS_TOKEN) return { data: { user: null }, error: { message: "missing" } };
        return { data: { user: { id: FOLLOWER_ID } }, error: null };
      },
    },
  };
}

test("the first follow waits until the session cookie is readable", async () => {
  const { auth, calls } = createAuth([null, { access_token: ACCESS_TOKEN }]);

  const session = await requireFollowSession({ auth });

  assert.deepEqual(session, { userId: FOLLOWER_ID, accessToken: ACCESS_TOKEN });
  assert.deepEqual(
    calls.filter(([name]) => name === "getSession"),
    [["getSession", false], ["getSession", true]],
  );
  assert.ok(calls.findIndex(([name]) => name === "initialize") < calls.findIndex(([name]) => name === "getSession"));
  assert.deepEqual(calls.filter(([name]) => name === "getUser"), [["getUser", ACCESS_TOKEN]]);
});

test("follow does not proceed when the session is still missing", async () => {
  const { auth, calls } = createAuth([null, null]);
  await assert.rejects(
    () => requireFollowSession({ auth }),
    /Authentication is required/,
  );
  assert.equal(calls.some(([name]) => name === "getUser"), false);
});

test("a follow insert does not ask PostgREST to return the private row", async () => {
  assert.equal(FOLLOW_INSERT_PREFER, "return=minimal");
  assert.deepEqual(followInsertHeaders(ACCESS_TOKEN), {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Prefer: "return=minimal",
  });
  const source = await readFile(new URL("./social-mutations.ts", import.meta.url), "utf8");
  assert.match(source, /requireFollowSession\(supabase\)/);
  assert.match(source, /from\("profile_follows"\)\.insert/);
  assert.match(source, /setHeader\("Authorization", headers\.Authorization\)/);
  assert.match(source, /setHeader\("Prefer", headers\.Prefer\)/);
  assert.match(source, /followInsertHeaders\(accessToken\)/);
});
