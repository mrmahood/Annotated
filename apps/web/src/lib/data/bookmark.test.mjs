import assert from "node:assert/strict";
import test from "node:test";
import { parseBookmarkListRow, parseCurrentBookmarkIds } from "./bookmark.ts";

const ANNOTATION_ID = "73000000-0000-4000-8000-000000000001";

test("viewer bookmark ids stay bounded to published targets", () => {
  assert.deepEqual(
    [...parseCurrentBookmarkIds([{ annotation_id: ANNOTATION_ID }, { annotation_id: "nope" }])],
    [ANNOTATION_ID],
  );
  assert.deepEqual([...parseCurrentBookmarkIds(null)], []);
});

test("bookmark list rows require a published annotation id and timestamp", () => {
  assert.deepEqual(
    parseBookmarkListRow({
      annotation_id: ANNOTATION_ID,
      bookmarked_at: "2026-09-12T13:00:00.000Z",
    }),
    {
      annotationId: ANNOTATION_ID,
      bookmarkedAt: "2026-09-12T13:00:00.000Z",
    },
  );
  assert.equal(parseBookmarkListRow({
    annotation_id: ANNOTATION_ID,
    bookmarked_at: "not-a-date",
  }), null);
  assert.equal(parseBookmarkListRow({
    annotation_id: "nope",
    bookmarked_at: "2026-09-12T13:00:00.000Z",
  }), null);
});
