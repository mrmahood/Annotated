import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createHoverOverlayRepaintController,
  hoverOverlayDimCss,
  hoverOverlayHole,
  hoverOverlayRingBox,
  HOVER_OVERLAY_ROOT_CSS,
  SERIALIZED_HOVER_PAGE_FILES,
  writeHoverCssText,
} from './hover-overlay-paint.ts';

const PLAYER = { left: 40, top: 20, right: 680, bottom: 380, width: 640, height: 360 };
const VIEW = { innerWidth: 1280, innerHeight: 720 };

test('dim hole and inset ring keep the four-sided laptop grammar', () => {
  const hole = hoverOverlayHole(PLAYER, VIEW);
  assert.equal(hole, '40px 20px, 680px 20px, 680px 380px, 40px 380px, 40px 20px');
  assert.match(
    hoverOverlayDimCss(0.1, hole),
    /clip-path:polygon\(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 40px 20px/,
  );
  assert.deepEqual(hoverOverlayRingBox(PLAYER, 5), {
    top: 25,
    left: 45,
    width: 630,
    height: 350,
  });
  const flush = { left: 0, top: 56, right: 800, bottom: 506, width: 800, height: 450 };
  const box = hoverOverlayRingBox(flush, 5);
  assert.equal(box.left, 5);
  assert.equal(box.top, 61);
  assert.equal(box.width, 790);
  assert.equal(box.height, 440);
  assert.ok(box.left + box.width < 800);
  assert.ok(box.top + box.height < flush.bottom);
  assert.equal(HOVER_OVERLAY_ROOT_CSS, 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;');
});

test('writeHoverCssText skips identical payloads', () => {
  const style = { cssText: '' };
  const cache = { value: '' };
  assert.equal(writeHoverCssText(style, 'top:1px', cache), true);
  assert.equal(style.cssText, 'top:1px');
  assert.equal(writeHoverCssText(style, 'top:1px', cache), false);
  style.cssText = 'top:1px;';
  assert.equal(writeHoverCssText(style, 'top:1px', cache), false);
  assert.equal(writeHoverCssText(style, 'top:2px', cache), true);
  assert.equal(style.cssText, 'top:2px');
});

test('repaint controller coalesces scroll and resize onto one animation frame', () => {
  const frames = [];
  const listeners = { scroll: [], resize: [] };
  const paints = [];
  const host = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame(handle) {
      frames[handle - 1] = null;
    },
    addEventListener(type, listener, options) {
      listeners[type]?.push({ listener, options });
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] ?? []).filter((entry) => entry.listener !== listener);
    },
  };

  const controller = createHoverOverlayRepaintController(host, () => {
    paints.push(1);
  });
  assert.equal(listeners.scroll.length, 1);
  assert.deepEqual(listeners.scroll[0].options, { capture: true, passive: true });
  assert.deepEqual(listeners.resize[0].options, { passive: true });

  listeners.scroll[0].listener();
  listeners.scroll[0].listener();
  listeners.resize[0].listener();
  assert.equal(frames.length, 1);
  assert.equal(paints.length, 0);
  frames[0](0);
  assert.equal(paints.length, 1);

  listeners.scroll[0].listener();
  assert.equal(frames.length, 2);
  controller.disconnect();
  assert.equal(listeners.scroll.length, 0);
  assert.equal(listeners.resize.length, 0);
  assert.equal(frames[1], null);
  frames[1]?.(0);
  assert.equal(paints.length, 1);
});

test('repaint controller paints synchronously when requestAnimationFrame is missing', () => {
  const paints = [];
  const listeners = { scroll: [] };
  const host = {
    addEventListener(type, listener) {
      listeners[type]?.push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] ?? []).filter((entry) => entry !== listener);
    },
  };
  const controller = createHoverOverlayRepaintController(host, () => {
    paints.push(1);
  });
  listeners.scroll[0]();
  listeners.scroll[0]();
  assert.equal(paints.length, 2);
  controller.disconnect();
});

test('serialized hover injectors keep a closure-free copy of the paint scheduler', async () => {
  for (const file of SERIALIZED_HOVER_PAGE_FILES) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(source, /__annotatedHoverCss/);
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /cancelAnimationFrame/);
    assert.match(source, /capture: true, passive: true/);
    assert.match(source, /if \(raf\) return;/);
    assert.doesNotMatch(source, /from '\.\/hover-overlay-paint/);
  }
});
