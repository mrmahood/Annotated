import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicFeedQueryPlan,
  buildPublicProfileAnnotationsQueryPlan,
  PUBLIC_ANNOTATION_CARD_SELECT,
  PUBLIC_ANNOTATION_STATUS,
} from "./public-discovery-query.ts";

const VOTE_DISCOVERY_TERMS = [
  "annotation_votes",
  "get_public_annotation_vote_totals",
  "get_current_annotation_vote",
  "upvote_count",
  "downvote_count",
  "current_vote",
  "vote_total",
  "score",
];

function assertPublishedOnly(plan) {
  assert.deepEqual(
    plan.filters.find((filter) => filter.column === "status"),
    { column: "status", value: PUBLIC_ANNOTATION_STATUS },
  );
  assert.equal(plan.select.includes("claims"), false);
  assert.equal(plan.select.includes("annotation_type"), true);
  assert.equal(plan.select.includes("source_type"), true);
  assert.equal(plan.select.includes("start_ms"), true);
  assert.equal(plan.select.includes("end_ms"), true);
  for (const term of VOTE_DISCOVERY_TERMS) {
    assert.equal(plan.select.toLowerCase().includes(term), false, `${term} leaked into discovery`);
    assert.equal(
      plan.filters.some((filter) => filter.column.toLowerCase().includes(term)),
      false,
      `${term} affects discovery filtering`,
    );
    assert.equal(
      plan.orders.some((order) => order.column.toLowerCase().includes(term)),
      false,
      `${term} affects discovery ordering`,
    );
  }
}

test("public cards select only detail-independent attribution and excerpt fields", () => {
  const normalized = PUBLIC_ANNOTATION_CARD_SELECT.replace(/\s+/g, " ").trim();
  assert.equal(normalized, [
    "id, slug, annotation_type, commentary_text, published_at,",
    "annotator:profiles!annotations_user_id_fkey(id, username, display_name, avatar_url),",
    "source:sources!annotations_source_id_fkey(canonical_url, normalized_url, source_type, title, author, publisher, metadata),",
    "target:annotation_targets!annotation_targets_annotation_id_fkey(target_type, selected_text, start_ms, end_ms)",
  ].join(" "));
});

test("public feed query plan explicitly requires published status", () => {
  assert.equal(PUBLIC_ANNOTATION_STATUS, "published");
  assert.notEqual(PUBLIC_ANNOTATION_STATUS, "hidden");
  assert.notEqual(PUBLIC_ANNOTATION_STATUS, "removed");
  const plan = buildPublicFeedQueryPlan();
  assertPublishedOnly(plan);
  assert.deepEqual(plan.orders, [
    { column: "published_at", ascending: false },
    { column: "id", ascending: false },
  ]);
});

test("profile annotation query plan requires published status and creator id", () => {
  const profileId = "41000000-0000-4000-8000-000000000001";
  const plan = buildPublicProfileAnnotationsQueryPlan(profileId);
  assertPublishedOnly(plan);
  assert.deepEqual(plan.filters.find((filter) => filter.column === "user_id"), {
    column: "user_id",
    value: profileId,
  });
});

test("feed and profile discovery stay vote-free and share identical stable ordering", () => {
  const feed = buildPublicFeedQueryPlan();
  const profile = buildPublicProfileAnnotationsQueryPlan(
    "41000000-0000-4000-8000-000000000001",
  );

  assert.equal(feed.select, profile.select);
  assert.deepEqual(feed.orders, profile.orders);
  assert.deepEqual(feed.orders, [
    { column: "published_at", ascending: false },
    { column: "id", ascending: false },
  ]);
  assert.deepEqual(
    feed.filters,
    profile.filters.filter((filter) => filter.column !== "user_id"),
  );
});
