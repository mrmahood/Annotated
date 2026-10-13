import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMENT_TIMESTAMP_FORMAT, formatCommentTimestamp } from "./comment-time.ts";

const CREATED_AT = "2026-10-13T15:04:00.000Z";

test("comment timestamps use a fixed locale and UTC", () => {
  assert.equal(COMMENT_TIMESTAMP_FORMAT.timeZone, "UTC");
  assert.equal(COMMENT_TIMESTAMP_FORMAT.hourCycle, "h12");
  const utc = new Intl.DateTimeFormat("en-US", {
    ...COMMENT_TIMESTAMP_FORMAT,
    timeZone: "UTC",
  }).format(new Date(CREATED_AT));
  const tokyo = new Intl.DateTimeFormat("en-US", {
    ...COMMENT_TIMESTAMP_FORMAT,
    timeZone: "Asia/Tokyo",
  }).format(new Date(CREATED_AT));
  assert.notEqual(utc, tokyo);
  assert.equal(formatCommentTimestamp(CREATED_AT), utc);
  assert.equal(formatCommentTimestamp(CREATED_AT), "Oct 13, 2026, 3:04 PM");
});

test("comment times render through the UTC formatter", async () => {
  const source = await readFile(
    new URL("../app/a/[annotationId]/comments-section.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /formatCommentTimestamp\(comment\.createdAt\)/);
  assert.match(source, /<time dateTime=\{comment\.createdAt\}>/);
  assert.doesNotMatch(source, /Intl\.DateTimeFormat/);
});
