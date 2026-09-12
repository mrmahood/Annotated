import assert from "node:assert/strict";
import test from "node:test";
import {
  TRENDING_BOOST_CONFIRMATION,
  TRENDING_BOOST_MAX,
  TRENDING_MAX_CARDS,
  TRENDING_MIN_VISIBLE,
  buildTrendingBoostBody,
  clampTrendingLimit,
  isTrendingBoostReady,
  parseTrendingBoostList,
  parseTrendingBoostRequest,
  parseTrendingListRow,
  shouldShowTrendingSurface,
} from "./trending.ts";

const annotationId = "81000000-0000-4000-8000-000000000001";

test("trending hide threshold and card cap match the locked v1 contract", () => {
  assert.equal(TRENDING_MIN_VISIBLE, 2);
  assert.equal(TRENDING_MAX_CARDS, 8);
  assert.equal(shouldShowTrendingSurface(0), false);
  assert.equal(shouldShowTrendingSurface(1), false);
  assert.equal(shouldShowTrendingSurface(2), true);
  assert.equal(shouldShowTrendingSurface(8), true);
  assert.equal(shouldShowTrendingSurface(8.5), false);
  assert.equal(clampTrendingLimit(0), 1);
  assert.equal(clampTrendingLimit(9), 8);
  assert.equal(clampTrendingLimit(5), 5);
});

test("trending list rows accept numeric or numeric-string scores", () => {
  assert.deepEqual(parseTrendingListRow({
    annotation_id: annotationId,
    score: "17.0000",
  }), { annotationId, score: 17 });
  assert.equal(parseTrendingListRow({ annotation_id: "not-a-uuid", score: 1 }), null);
  assert.equal(parseTrendingListRow({ annotation_id: annotationId, score: "nope" }), null);
});

test("ops boost parse and enablement stay exact and published-id only", () => {
  assert.equal(isTrendingBoostReady({
    annotationId,
    typedConfirm: TRENDING_BOOST_CONFIRMATION,
    action: "set",
    boost: "5",
  }), true);
  assert.equal(isTrendingBoostReady({
    annotationId,
    typedConfirm: "trending_boost",
    action: "set",
    boost: "5",
  }), false);
  assert.equal(isTrendingBoostReady({
    annotationId: "not-a-uuid",
    typedConfirm: TRENDING_BOOST_CONFIRMATION,
    action: "clear",
    boost: "",
  }), false);
  assert.equal(isTrendingBoostReady({
    annotationId,
    typedConfirm: TRENDING_BOOST_CONFIRMATION,
    action: "set",
    boost: String(TRENDING_BOOST_MAX + 1),
  }), false);

  assert.deepEqual(parseTrendingBoostRequest({
    annotationId,
    action: "set",
    boost: 12,
    confirm: TRENDING_BOOST_CONFIRMATION,
  }), {
    annotationId,
    action: "set",
    boost: 12,
    confirm: TRENDING_BOOST_CONFIRMATION,
  });
  assert.equal(parseTrendingBoostRequest({
    annotationId,
    action: "set",
    boost: 12,
    confirm: TRENDING_BOOST_CONFIRMATION,
    extra: true,
  }), null);
  assert.deepEqual(parseTrendingBoostRequest({
    annotationId,
    action: "clear",
    confirm: TRENDING_BOOST_CONFIRMATION,
  }), {
    annotationId,
    action: "clear",
    confirm: TRENDING_BOOST_CONFIRMATION,
  });
  assert.deepEqual(buildTrendingBoostBody({
    annotationId,
    action: "set",
    boost: "7.5",
  }), {
    annotationId,
    action: "set",
    boost: 7.5,
    confirm: TRENDING_BOOST_CONFIRMATION,
  });
  assert.deepEqual(parseTrendingBoostList({
    boosts: [{
      annotation_id: annotationId,
      boost: "5.00",
      updated_at: "2026-09-12T18:00:00.000Z",
    }],
  }), [{
    annotationId,
    boost: 5,
    updatedAt: "2026-09-12T18:00:00.000Z",
  }]);
  assert.deepEqual(parseTrendingBoostList({
    boosts: [{
      annotationId,
      boost: 8,
      updatedAt: "2026-09-12T18:00:00.000Z",
    }],
  }), [{
    annotationId,
    boost: 8,
    updatedAt: "2026-09-12T18:00:00.000Z",
  }]);
});
