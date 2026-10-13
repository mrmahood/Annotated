import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMMENT_TIMESTAMP_FORMAT,
  formatCommentTimestamp,
  formatLocalCommentTimestamp,
} from "./comment-time.ts";

const CREATED_AT = "2026-10-13T15:04:00.000Z";
const EASTERN_POST = "2026-10-13T06:55:00.000Z";

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

test("a 6:55 AM UTC comment reads 2:55 AM in US Eastern after a day", () => {
  const postedAt = Date.parse(EASTERN_POST);
  const nextDay = postedAt + 26 * 60 * 60 * 1000;
  assert.equal(formatCommentTimestamp(EASTERN_POST), "Oct 13, 2026, 6:55 AM");
  assert.equal(
    formatLocalCommentTimestamp(EASTERN_POST, nextDay, "America/New_York"),
    "Oct 13, 2026, 2:55 AM",
  );
  assert.equal(
    formatLocalCommentTimestamp(EASTERN_POST, nextDay, "America/Los_Angeles"),
    "Oct 12, 2026, 11:55 PM",
  );
});

test("a recent comment uses a relative label instead of the UTC clock", () => {
  const postedAt = Date.parse(EASTERN_POST);
  assert.equal(formatLocalCommentTimestamp(EASTERN_POST, postedAt + 5 * 60 * 1000, "America/New_York"), "5 min ago");
  assert.equal(formatLocalCommentTimestamp(EASTERN_POST, postedAt + 60 * 1000, "America/New_York"), "1 min ago");
  assert.equal(formatLocalCommentTimestamp(EASTERN_POST, postedAt + 30 * 1000, "America/New_York"), "just now");
  assert.equal(formatLocalCommentTimestamp(EASTERN_POST, postedAt + 2 * 60 * 60 * 1000, "UTC"), "2 hours ago");
  assert.equal(
    formatLocalCommentTimestamp(EASTERN_POST, postedAt - 60 * 1000, "America/New_York"),
    "Oct 13, 2026, 2:55 AM",
  );
});

test("comment times hydrate the UTC label and localize after mount", async () => {
  const component = await readFile(new URL("../app/comment-time.tsx", import.meta.url), "utf8");
  const list = await readFile(
    new URL("../app/a/[annotationId]/comments-section.tsx", import.meta.url),
    "utf8",
  );
  const effectAt = component.indexOf("useEffect");
  const viewerAt = component.indexOf("formatViewerCommentTimestamp(dateTime)");
  assert.ok(effectAt >= 0 && viewerAt > effectAt);
  assert.match(component, /const utcLabel = formatCommentTimestamp\(dateTime\)/);
  assert.match(component, /<time dateTime=\{dateTime\}>/);
  assert.match(component, /viewer\?\.dateTime === dateTime \? viewer\.label : utcLabel/);
  assert.match(component, /requestAnimationFrame/);
  assert.doesNotMatch(component, /Intl\.DateTimeFormat/);
  assert.match(list, /<CommentTime dateTime=\{comment\.createdAt\} \/>/);
  assert.doesNotMatch(list, /formatCommentTimestamp\(comment\.createdAt\)/);
  assert.doesNotMatch(list, /Intl\.DateTimeFormat/);
});
