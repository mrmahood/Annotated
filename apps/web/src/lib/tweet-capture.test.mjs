import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicTweetCapture } from "./tweet-capture.ts";

const ROW = {
  status_url: "https://x.com/reader/status/1234567890",
  tweet_id: "1234567890",
  author_handle: "reader",
  author_name: "Reader",
  tweet_text: "The preserved post.",
  posted_at: "2024-05-01T12:00:00.000Z",
  screenshot_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg",
  screenshot_width: 640,
  screenshot_height: 360,
};

test("a stored post renders its screenshot only from the matching public object", () => {
  const parsed = parsePublicTweetCapture(
    ROW,
    `https://project.supabase.co/storage/v1/object/public/annotation-tweet-captures/${ROW.screenshot_path}`,
  );
  assert.equal(parsed?.statusUrl, ROW.status_url);
  assert.equal(parsed?.screenshotWidth, 640);
  assert.match(parsed?.screenshotUrl ?? "", /annotation-tweet-captures/);
});

test("embed data remains when the screenshot URL does not match the stored path", () => {
  const parsed = parsePublicTweetCapture(ROW, "https://evil.example/other.jpg");
  assert.equal(parsed?.tweetText, "The preserved post.");
  assert.equal(parsed?.screenshotUrl, null);
});

test("a non-status URL is not rendered as a preserved post", () => {
  assert.equal(parsePublicTweetCapture({
    ...ROW,
    status_url: "https://example.com/story",
  }, null), null);
});
