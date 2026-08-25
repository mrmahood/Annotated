import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  VOTE_CACHE_CONTROL,
  VoteApiError,
  assertSameOriginVoteMutation,
  getOptimisticVoteSnapshot,
  parseCurrentVote,
  parsePublicVoteTotals,
  parseVoteMutationResult,
  parseVoteRequest,
  parseVoteSnapshotResponse,
  voteErrorResponse,
  voteJsonResponse,
} from "./voting.ts";

const annotationId = "d2bb1000-0000-4000-8000-000000000001";

test("vote mutation input accepts only one nullable direction field", () => {
  assert.deepEqual(parseVoteRequest({ value: 1 }), { value: 1 });
  assert.deepEqual(parseVoteRequest({ value: -1 }), { value: -1 });
  assert.deepEqual(parseVoteRequest({ value: null }), { value: null });
  for (const invalid of [
    null,
    {},
    { value: 0 },
    { value: "1" },
    { value: 1, userId: "attacker" },
    { annotationId, value: 1 },
  ]) {
    assert.throws(
      () => parseVoteRequest(invalid),
      (error) => error instanceof VoteApiError && error.code === "INVALID_REQUEST",
    );
  }
});

test("public totals parse only the exact requested annotation and safe counts", () => {
  assert.deepEqual(parsePublicVoteTotals([{
    annotation_id: annotationId,
    upvote_count: 12,
    downvote_count: "3",
  }], annotationId), { upvoteCount: 12, downvoteCount: 3 });
  assert.equal(parsePublicVoteTotals([], annotationId), null);
  assert.equal(parsePublicVoteTotals([{
    annotation_id: "d2bb1000-0000-4000-8000-000000000002",
    upvote_count: 12,
    downvote_count: 3,
  }], annotationId), null);
  assert.equal(parsePublicVoteTotals([{
    annotation_id: annotationId,
    upvote_count: -1,
    downvote_count: 0,
  }], annotationId), null);
});

test("current state projection accepts only the requested annotation and nullable vote", () => {
  assert.equal(parseCurrentVote([{ annotation_id: annotationId, current_vote: 1 }], annotationId), 1);
  assert.equal(parseCurrentVote([{ annotation_id: annotationId, current_vote: null }], annotationId), null);
  assert.equal(parseCurrentVote([{ annotation_id: annotationId, current_vote: 0 }], annotationId), undefined);
  assert.equal(parseCurrentVote([], annotationId), undefined);
});

test("trusted mutation results require bounded totals and retry semantics", () => {
  assert.deepEqual(parseVoteMutationResult([{
    result_code: "CREATED",
    current_vote: 1,
    upvote_count: 1,
    downvote_count: 0,
    retry_after_seconds: null,
  }]), {
    resultCode: "CREATED",
    currentVote: 1,
    upvoteCount: 1,
    downvoteCount: 0,
    retryAfterSeconds: null,
  });
  assert.deepEqual(parseVoteMutationResult([{
    result_code: "RATE_LIMITED",
    current_vote: -1,
    upvote_count: 2,
    downvote_count: 4,
    retry_after_seconds: 600,
  }]), {
    resultCode: "RATE_LIMITED",
    currentVote: -1,
    upvoteCount: 2,
    downvoteCount: 4,
    retryAfterSeconds: 600,
  });
  assert.equal(parseVoteMutationResult([{
    result_code: "RATE_LIMITED",
    current_vote: 1,
    upvote_count: 1,
    downvote_count: 0,
    retry_after_seconds: 601,
  }]), null);
  assert.equal(parseVoteMutationResult([{
    result_code: "CREATED",
    current_vote: 1,
    upvote_count: 1,
    downvote_count: 0,
    retry_after_seconds: 1,
  }]), null);
});

test("same-origin mutation validation uses only the configured trusted origin", () => {
  const accepted = new Request("http://127.0.0.1:3000/api/annotations/x/vote", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
  });
  assert.doesNotThrow(() => assertSameOriginVoteMutation(accepted, "http://127.0.0.1:3000"));

  for (const request of [
    new Request(accepted.url, { method: "POST" }),
    new Request(accepted.url, { method: "POST", headers: { origin: "https://evil.example" } }),
    new Request(accepted.url, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "cross-site" },
    }),
    new Request("http://localhost:3000/api/annotations/x/vote", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
    }),
  ]) {
    assert.throws(
      () => assertSameOriginVoteMutation(request, "http://127.0.0.1:3000"),
      (error) => error instanceof VoteApiError && error.code === "CROSS_ORIGIN_REQUEST",
    );
  }
  assert.throws(
    () => assertSameOriginVoteMutation(accepted, "http://not-loopback.example"),
    (error) => error instanceof VoteApiError && error.code === "SERVER_MISCONFIGURED",
  );
});

test("optimistic direction changes remain separate and never produce negative totals", () => {
  assert.deepEqual(
    getOptimisticVoteSnapshot({ currentVote: null, upvoteCount: 0, downvoteCount: 0 }, 1),
    { currentVote: 1, upvoteCount: 1, downvoteCount: 0 },
  );
  assert.deepEqual(
    getOptimisticVoteSnapshot({ currentVote: 1, upvoteCount: 3, downvoteCount: 2 }, -1),
    { currentVote: -1, upvoteCount: 2, downvoteCount: 3 },
  );
  assert.deepEqual(
    getOptimisticVoteSnapshot({ currentVote: -1, upvoteCount: 0, downvoteCount: 0 }, null),
    { currentVote: null, upvoteCount: 0, downvoteCount: 0 },
  );
});

test("client snapshots reject error codes and malformed counts", () => {
  assert.deepEqual(parseVoteSnapshotResponse({
    currentVote: null,
    upvoteCount: 2,
    downvoteCount: 1,
  }), { currentVote: null, upvoteCount: 2, downvoteCount: 1 });
  assert.equal(parseVoteSnapshotResponse({ currentVote: 0, upvoteCount: 2, downvoteCount: 1 }), null);
  assert.equal(parseVoteSnapshotResponse({ currentVote: 1, upvoteCount: Number.MAX_VALUE, downvoteCount: 1 }), null);
});

test("vote responses are private no-store, bounded JSON, and never enable CORS", async () => {
  const response = voteJsonResponse({ currentVote: null, upvoteCount: 0, downvoteCount: 0 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), VOTE_CACHE_CONTROL);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), { currentVote: null, upvoteCount: 0, downvoteCount: 0 });

  const error = voteErrorResponse(new VoteApiError("CROSS_ORIGIN_REQUEST", 403));
  assert.equal(error.status, 403);
  assert.deepEqual(await error.json(), { error: "CROSS_ORIGIN_REQUEST" });
});

test("route and UI source preserve verified identity, rollback, and accessibility boundaries", async () => {
  const [route, controls, page, discovery, card] = await Promise.all([
    readFile(new URL("../app/api/annotations/[annotationId]/vote/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/vote-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/public-annotation-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./data/public-discovery-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/annotation-card.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /assertSameOriginVoteMutation\(request\)/);
  assert.match(route, /auth\.getUser\(\)/);
  assert.doesNotMatch(route, /body\.(?:userId|user_id)/);
  assert.match(route, /"retry-after"/);
  assert.match(controls, /aria-pressed/);
  assert.match(controls, /Saving your vote/);
  assert.match(controls, /refreshAuthoritativeSnapshot\(previous\)/);
  assert.match(controls, /Creators cannot vote on their own annotations/);
  assert.match(page, /getAnnotationVoteSnapshot/);
  assert.match(page, /<VoteControls/);
  assert.doesNotMatch(discovery, /vote/i);
  assert.doesNotMatch(card, /vote/i);
});
