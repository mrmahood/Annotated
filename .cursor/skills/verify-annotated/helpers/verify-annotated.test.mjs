import assert from "node:assert/strict";
import test from "node:test";
import { classifyQuietList } from "./drive-outcome.mjs";
import {
  DEDICATED_TEST_EMAIL,
  createSupabaseMintPort,
  mintDedicatedTestSession,
  parseGenerateLink,
  readMintEnv,
  redactSecrets,
  toPlaywrightCookies,
} from "./mint-test-session.mjs";

const TRENDING_TITLE = "What’s Trending | Annotated";

test("populated discovery list is a card pass", () => {
  assert.deepEqual(classifyQuietList({
    httpStatus: 200,
    title: TRENDING_TITLE,
    expectedTitle: TRENDING_TITLE,
    listCount: 1,
    emptyVisible: false,
    unavailableVisible: false,
  }), { result: "pass", exitCode: 0, reason: "cards" });
});

test("quiet heading on HTTP 200 is pass-empty", () => {
  assert.deepEqual(classifyQuietList({
    httpStatus: 200,
    title: "Who to Follow | Annotated",
    expectedTitle: "Who to Follow | Annotated",
    listCount: 0,
    emptyVisible: true,
    unavailableVisible: false,
  }), { result: "pass-empty", exitCode: 2, reason: "empty" });
});

test("unavailable alert fails even when the title is right", () => {
  assert.deepEqual(classifyQuietList({
    httpStatus: 200,
    title: TRENDING_TITLE,
    expectedTitle: TRENDING_TITLE,
    listCount: 0,
    emptyVisible: false,
    unavailableVisible: true,
  }), { result: "fail", exitCode: 1, reason: "unavailable" });
});

test("wrong title fails even when the empty heading is visible", () => {
  assert.deepEqual(classifyQuietList({
    httpStatus: 200,
    title: "Error",
    expectedTitle: TRENDING_TITLE,
    listCount: 0,
    emptyVisible: true,
    unavailableVisible: false,
  }), { result: "fail", exitCode: 1, reason: "title" });
});

test("HTTP 500 fails even when the empty heading is visible", () => {
  assert.deepEqual(classifyQuietList({
    httpStatus: 500,
    title: TRENDING_TITLE,
    expectedTitle: TRENDING_TITLE,
    listCount: 0,
    emptyVisible: true,
    unavailableVisible: false,
  }), { result: "fail", exitCode: 1, reason: "http" });
});

test("a page with neither cards nor the empty heading fails", () => {
  assert.deepEqual(classifyQuietList({
    httpStatus: 200,
    title: TRENDING_TITLE,
    expectedTitle: TRENDING_TITLE,
    listCount: 0,
    emptyVisible: false,
    unavailableVisible: false,
  }), { result: "fail", exitCode: 1, reason: "unrecognized" });
});

test("missing service role key stays unreachable and does not echo other env", () => {
  const result = readMintEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-canary-value" });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.message, "set SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(result.message.includes("anon-canary-value"), false);
  assert.equal("serviceRoleKey" in result, false);
});

test("service role without the project URL stays unreachable and hides the key", () => {
  const key = "service-role-canary-value";
  const result = readMintEnv({ SUPABASE_SERVICE_ROLE_KEY: key });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.message, "set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  assert.equal(result.message.includes(key), false);
});

test("anon key alias satisfies the publishable key input", () => {
  const result = readMintEnv({
    SUPABASE_SERVICE_ROLE_KEY: "service-role-canary-value",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-canary-value",
  });
  assert.equal(result.ok, true);
  assert.equal(result.email, DEDICATED_TEST_EMAIL);
  assert.equal(result.publishableKey, "anon-canary-value");
});

test("mint refuses any other email before the port is called", async () => {
  let called = false;
  const port = {
    async generateMagicLink() {
      called = true;
      return { status: "ok", tokenHash: "hash", otpType: "magiclink" };
    },
    async createConfirmedUser() {
      called = true;
    },
    async verifyMagicLink() {
      called = true;
      return [{ name: "sb-test-auth-token", value: "cookie" }];
    },
  };
  await assert.rejects(() => mintDedicatedTestSession(port, "other@gmail.com"), { code: "mint_refused_email" });
  assert.equal(called, false);
});

test("mint reuses an existing user and keeps secrets out of the log", async () => {
  const cookieValue = "super-secret-cookie-value";
  const calls = [];
  const result = await mintDedicatedTestSession({
    async generateMagicLink(email) {
      calls.push(`generate:${email}`);
      return { status: "ok", tokenHash: "hash-1", otpType: "magiclink" };
    },
    async createConfirmedUser(email) {
      calls.push(`create:${email}`);
    },
    async verifyMagicLink(link) {
      calls.push(`verify:${link.tokenHash}`);
      return [{ name: "sb-test-auth-token", value: cookieValue }];
    },
  }, DEDICATED_TEST_EMAIL);
  assert.deepEqual(calls, [`generate:${DEDICATED_TEST_EMAIL}`, "verify:hash-1"]);
  assert.equal(result.cookies[0].value, cookieValue);
  assert.equal(result.log.includes(cookieValue), false);
  assert.equal(result.log.includes("hash-1"), false);
  assert.equal(result.log, `session minted for ${DEDICATED_TEST_EMAIL}; cookie count 1`);
});

test("mint creates the dedicated user only when generate_link reports the user is missing", async () => {
  const calls = [];
  let generates = 0;
  await mintDedicatedTestSession({
    async generateMagicLink(email) {
      generates += 1;
      calls.push(`generate:${email}`);
      if (generates === 1) return { status: "user_not_found" };
      return { status: "ok", tokenHash: "hash-2", otpType: "email" };
    },
    async createConfirmedUser(email) {
      calls.push(`create:${email}`);
    },
    async verifyMagicLink(link) {
      calls.push(`verify:${link.otpType}`);
      return [{ name: "sb-test-auth-token", value: "v" }];
    },
  }, DEDICATED_TEST_EMAIL);
  assert.deepEqual(calls, [
    `generate:${DEDICATED_TEST_EMAIL}`,
    `create:${DEDICATED_TEST_EMAIL}`,
    `generate:${DEDICATED_TEST_EMAIL}`,
    "verify:email",
  ]);
});

test("generate_link parser returns the hash and drops the email OTP", () => {
  const parsed = parseGenerateLink(200, {
    properties: {
      hashed_token: "hashed-token-value",
      email_otp: "123456",
      verification_type: "magiclink",
    },
  });
  assert.deepEqual(parsed, { status: "ok", tokenHash: "hashed-token-value", otpType: "magiclink" });
  assert.equal("email_otp" in parsed, false);
});

test("generate_link parser treats a missing user as user_not_found and hides the body", () => {
  assert.deepEqual(parseGenerateLink(404, { msg: "User not found", email_otp: "999999" }), {
    status: "user_not_found",
  });
});

test("admin port sends magiclink for the dedicated email and does not leak the key on failure", async () => {
  const serviceRoleKey = "service-role-canary-value";
  const requests = [];
  const port = createSupabaseMintPort({
    url: "https://example.supabase.co",
    serviceRoleKey,
    publishableKey: "anon-canary-value",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        status: 500,
        async json() {
          return { msg: serviceRoleKey };
        },
      };
    },
    verifyMagicLink: async () => {
      throw new Error("verify should not run");
    },
  });
  await assert.rejects(() => mintDedicatedTestSession(port, DEDICATED_TEST_EMAIL), (error) => {
    assert.equal(error.code, "mint_link_failed");
    assert.equal(error.message.includes(serviceRoleKey), false);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.supabase.co/auth/v1/admin/generate_link");
  assert.deepEqual(JSON.parse(requests[0].init.body), { type: "magiclink", email: DEDICATED_TEST_EMAIL });
  assert.equal(requests[0].init.body.includes(serviceRoleKey), false);
});

test("admin port creates the user and verifies with the publishable key only", async () => {
  const serviceRoleKey = "service-role-canary-value";
  const publishableKey = "anon-canary-value";
  const requests = [];
  let verified = null;
  const port = createSupabaseMintPort({
    url: "https://example.supabase.co",
    serviceRoleKey,
    publishableKey,
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith("/generate_link") && requests.filter((item) => item.url.endsWith("/generate_link")).length === 1) {
        return { status: 404, async json() { return { msg: "User not found" }; } };
      }
      if (url.endsWith("/admin/users")) {
        return { status: 200, ok: true, async json() { return { id: "user" }; } };
      }
      return {
        status: 200,
        ok: true,
        async json() {
          return { properties: { hashed_token: "hashed-token-value", email_otp: "123456", verification_type: "magiclink" } };
        },
      };
    },
    verifyMagicLink: async (link, context) => {
      verified = { link, context };
      return [{ name: "sb-example-auth-token", value: "cookie-value" }];
    },
  });
  const result = await mintDedicatedTestSession(port, DEDICATED_TEST_EMAIL);
  assert.deepEqual(requests.map((item) => item.url), [
    "https://example.supabase.co/auth/v1/admin/generate_link",
    "https://example.supabase.co/auth/v1/admin/users",
    "https://example.supabase.co/auth/v1/admin/generate_link",
  ]);
  assert.deepEqual(requests[1].body, { email: DEDICATED_TEST_EMAIL, email_confirm: true });
  assert.equal(verified.context.publishableKey, publishableKey);
  assert.equal(verified.context.publishableKey === serviceRoleKey, false);
  assert.deepEqual(verified.link, { status: "ok", tokenHash: "hashed-token-value", otpType: "magiclink" });
  assert.equal(result.log.includes("cookie-value"), false);
  assert.equal(result.log.includes("123456"), false);
  assert.equal(result.log.includes(serviceRoleKey), false);
});

test("playwright cookies keep the value and do not invent a second domain", () => {
  const cookies = toPlaywrightCookies([
    { name: "sb-example-auth-token", value: "cookie-value", options: { path: "/", sameSite: "lax", httpOnly: false } },
  ], "https://annotated.cbandcoop.com");
  assert.deepEqual(cookies, [{
    name: "sb-example-auth-token",
    value: "cookie-value",
    url: "https://annotated.cbandcoop.com",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);
});

test("redactSecrets removes a known token and a JWT", () => {
  const text = redactSecrets("failed eyJhbGciOiJI.eyJzdWIiOiIx.signatureX with service-role-canary-value", [
    "service-role-canary-value",
  ]);
  assert.equal(text.includes("service-role-canary-value"), false);
  assert.equal(text.includes("eyJhbGciOi"), false);
  assert.match(text, /\[redacted\]/);
});
