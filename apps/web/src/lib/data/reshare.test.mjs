import assert from "node:assert/strict";
import test from "node:test";
import {
  feedItemKey,
  normalizeReshareComment,
  parseCurrentReshareIds,
  parseTimelineRow,
  RESHARE_COMMENT_LIMIT,
} from "./reshare.ts";

const ANNOTATION_ID = "63000000-0000-4000-8000-000000000001";
const RESHARE_ID = "64000000-0000-4000-8000-000000000001";
const USER_ID = "61000000-0000-4000-8000-000000000002";

test("reshare comments follow the 1,000-character comment norm", () => {
  assert.equal(RESHARE_COMMENT_LIMIT, 1_000);
  assert.equal(normalizeReshareComment(undefined), null);
  assert.equal(normalizeReshareComment("   "), null);
  assert.equal(normalizeReshareComment("  Keep this  "), "Keep this");
  assert.throws(
    () => normalizeReshareComment("x".repeat(1_001)),
    /1,000 characters/,
  );
});

test("timeline rows stay annotation-first and reject malformed reshares", () => {
  const annotation = parseTimelineRow({
    item_kind: "annotation",
    item_id: ANNOTATION_ID,
    occurred_at: "2026-09-12T12:00:00.000Z",
    annotation_id: ANNOTATION_ID,
    resharer_user_id: null,
    reshare_comment: null,
  });
  assert.deepEqual(annotation, {
    itemKind: "annotation",
    itemId: ANNOTATION_ID,
    occurredAt: "2026-09-12T12:00:00.000Z",
    annotationId: ANNOTATION_ID,
    resharerUserId: null,
    reshareComment: null,
  });

  const reshare = parseTimelineRow({
    item_kind: "reshare",
    item_id: RESHARE_ID,
    occurred_at: "2026-09-12T13:00:00.000Z",
    annotation_id: ANNOTATION_ID,
    resharer_user_id: USER_ID,
    reshare_comment: "  Nested share  ",
  });
  assert.equal(reshare?.itemKind, "reshare");
  assert.equal(reshare?.reshareComment, "Nested share");
  assert.equal(parseTimelineRow({
    item_kind: "reshare",
    item_id: RESHARE_ID,
    occurred_at: "2026-09-12T13:00:00.000Z",
    annotation_id: ANNOTATION_ID,
    resharer_user_id: null,
    reshare_comment: "Missing actor",
  }), null);
  assert.equal(parseTimelineRow({
    item_kind: "annotation",
    item_id: ANNOTATION_ID,
    occurred_at: "2026-09-12T12:00:00.000Z",
    annotation_id: ANNOTATION_ID,
    resharer_user_id: USER_ID,
    reshare_comment: null,
  }), null);
});

test("viewer reshare ids and feed keys stay bounded to published targets", () => {
  assert.deepEqual(
    [...parseCurrentReshareIds([{ annotation_id: ANNOTATION_ID }, { annotation_id: "nope" }])],
    [ANNOTATION_ID],
  );
  assert.equal(
    feedItemKey({ annotation: { id: ANNOTATION_ID }, reshare: { id: RESHARE_ID } }),
    `reshare:${RESHARE_ID}`,
  );
  assert.equal(
    feedItemKey({ annotation: { id: ANNOTATION_ID }, reshare: null }),
    `annotation:${ANNOTATION_ID}`,
  );
});
