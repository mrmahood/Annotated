import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ATTACH_TWEET_CAPTURE_RPC,
  buildTweetCapturePayload,
  storeTweetCapture,
  tweetCropSourceRect,
  tweetScreenshotOutputSize,
} from './tweet-capture.ts';

const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE = 'https://twitter.com/Reader/status/1234567890?s=20';

test('a status page keeps the post URL, highlighted text, and crop rect', () => {
  const payload = buildTweetCapturePayload({
    pageUrl: PAGE,
    selectedText: 'Highlighted claim',
    snapshot: {
      tweetId: '1234567890',
      authorHandle: 'reader',
      authorName: 'Reader Name',
      tweetText: 'The full post text',
      postedAt: '2024-05-01T12:00:00.000Z',
      rect: { x: 10, y: 20, width: 480, height: 220 },
      viewportWidth: 800,
      viewportHeight: 600,
    },
  });
  assert.equal(payload?.statusUrl, 'https://x.com/reader/status/1234567890');
  assert.equal(payload?.tweetText, 'The full post text');
  assert.equal(payload?.authorName, 'Reader Name');
  assert.deepEqual(payload?.rect, { x: 10, y: 20, width: 480, height: 220 });
});

test('a mismatched article snapshot does not replace the status identity', () => {
  const payload = buildTweetCapturePayload({
    pageUrl: PAGE,
    selectedText: 'Highlighted claim',
    snapshot: {
      tweetId: '999',
      authorHandle: 'other',
      tweetText: 'A quoted post',
      rect: { x: 0, y: 0, width: 400, height: 200 },
      viewportWidth: 800,
      viewportHeight: 600,
    },
  });
  assert.equal(payload?.tweetId, '1234567890');
  assert.equal(payload?.authorHandle, 'reader');
  assert.equal(payload?.tweetText, 'Highlighted claim');
  assert.equal(payload?.rect, null);
});

test('ordinary article URLs do not become post captures', async () => {
  assert.equal(buildTweetCapturePayload({
    pageUrl: 'https://example.com/story',
    selectedText: 'Passage',
  }), null);
  let injected = false;
  const result = await storeTweetCapture({
    auth: { async getUser() { throw new Error('must not read the session'); } },
    storage: { from() { throw new Error('must not upload'); } },
    async rpc() { throw new Error('must not attach'); },
  }, {
    annotationId: ANNOTATION_ID,
    tabId: 7,
    windowId: 3,
    pageUrl: 'https://example.com/story',
    selectedText: 'Passage',
  }, {
    async executeScript() { injected = true; return null; },
    async isTabVisible() { return true; },
    async captureVisibleTab() { return ''; },
    async cropScreenshot() { return null; },
  });
  assert.equal(result.stored, false);
  assert.equal(injected, false);
});

test('the crop uses the visible intersection and bounds the long edge', () => {
  const source = tweetCropSourceRect({
    cssRect: { x: -20, y: 40, width: 500, height: 300 },
    viewportWidth: 400,
    viewportHeight: 800,
    imageWidth: 800,
    imageHeight: 1600,
  });
  assert.deepEqual(source, { sx: 0, sy: 80, sw: 800, sh: 600 });
  assert.deepEqual(tweetScreenshotOutputSize(2000, 1000), { width: 1400, height: 700 });
  assert.equal(tweetCropSourceRect({
    cssRect: { x: 0, y: 0, width: 10, height: 10 },
    viewportWidth: 400,
    viewportHeight: 800,
    imageWidth: 800,
    imageHeight: 1600,
  }), null);
});

test('visible tab capture is cropped and attached with the post embed', async () => {
  const calls = [];
  const blob = new Blob([new Uint8Array(32)], { type: 'image/jpeg' });
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: USER_ID } }, error: null };
      },
    },
    storage: {
      from(bucket) {
        calls.push(['bucket', bucket]);
        return {
          async upload(path, body, options) {
            calls.push(['upload', path, body.size, options]);
            return { data: { path }, error: null };
          },
          async remove(paths) {
            calls.push(['remove', paths]);
            return { error: null };
          },
        };
      },
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      return { data: true, error: null };
    },
  };
  const result = await storeTweetCapture(client, {
    annotationId: ANNOTATION_ID,
    tabId: 7,
    windowId: 3,
    pageUrl: PAGE,
    selectedText: 'Highlighted claim',
  }, {
    async executeScript() {
      return {
        tweetId: '1234567890',
        authorHandle: 'reader',
        authorName: 'Reader',
        tweetText: 'Post body',
        postedAt: '2024-05-01T12:00:00.000Z',
        rect: { x: 0, y: 0, width: 400, height: 200 },
        viewportWidth: 800,
        viewportHeight: 600,
      };
    },
    async isTabVisible(tabId, windowId) {
      assert.equal(tabId, 7);
      assert.equal(windowId, 3);
      return true;
    },
    async captureVisibleTab() {
      return 'data:image/png;base64,aaaa';
    },
    async cropScreenshot(_dataUrl, payload) {
      assert.equal(payload.statusUrl, 'https://x.com/reader/status/1234567890');
      return { blob, width: 400, height: 200 };
    },
  });
  assert.deepEqual(result, { stored: true });
  const rpc = calls.find((call) => call[0] === 'rpc');
  assert.equal(rpc[1], ATTACH_TWEET_CAPTURE_RPC);
  assert.equal(rpc[2].p_status_url, 'https://x.com/reader/status/1234567890');
  assert.equal(rpc[2].p_tweet_text, 'Post body');
  assert.equal(rpc[2].p_screenshot_byte_size, 32);
  assert.match(rpc[2].p_screenshot_path, new RegExp(`^${USER_ID}/`));
  assert.equal(calls.some((call) => call[0] === 'remove'), false);
});

test('a hidden tab stores the post without a screenshot', async () => {
  const calls = [];
  const client = {
    auth: { async getUser() { return { data: { user: { id: USER_ID } }, error: null }; } },
    storage: { from() { throw new Error('screenshot upload must not run'); } },
    async rpc(_name, args) {
      calls.push(args);
      return { data: true, error: null };
    },
  };
  const result = await storeTweetCapture(client, {
    annotationId: ANNOTATION_ID,
    tabId: 7,
    windowId: 3,
    pageUrl: PAGE,
    selectedText: 'Highlighted claim',
  }, {
    async executeScript() { return null; },
    async isTabVisible() { return false; },
    async captureVisibleTab() { throw new Error('must not capture'); },
    async cropScreenshot() { throw new Error('must not crop'); },
  });
  assert.equal(result.stored, true);
  assert.equal(calls[0].p_screenshot_path, null);
  assert.equal(calls[0].p_tweet_text, 'Highlighted claim');
});

test('post capture stays a one-shot script and does not add a content script', async () => {
  const [capture, config] = await Promise.all([
    readFile(new URL('./tweet-capture.ts', import.meta.url), 'utf8'),
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(capture, /export function extractTweetSnapshotFromPage/);
  assert.match(capture, /captureVisibleTab/);
  assert.match(capture, /data-testid="tweetText"/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
});
