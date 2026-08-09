import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicFeedQueryPlan,
  buildPublicProfileAnnotationsQueryPlan,
  PUBLIC_ANNOTATION_STATUS,
} from "./public-discovery-query.ts";

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
}

test("public feed query plan explicitly requires published status", () => {
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
