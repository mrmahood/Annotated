import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PUBLIC_PAGE,
  PUBLIC_PAGE_SIZE,
  formatHostname,
  getPageHref,
  getPageRange,
  getPagination,
  isCanonicalPageQuery,
  isUuid,
  parsePageQuery,
  truncateExcerpt,
} from "./public-content.ts";

test("parses canonical page values and safely defaults invalid input", () => {
  assert.equal(parsePageQuery(undefined), 1);
  assert.equal(parsePageQuery("2"), 2);
  assert.equal(parsePageQuery("0"), 1);
  assert.equal(parsePageQuery("-3"), 1);
  assert.equal(parsePageQuery("1.5"), 1);
  assert.equal(parsePageQuery("words"), 1);
  assert.equal(parsePageQuery(["2", "3"]), 1);
  assert.equal(parsePageQuery(String(MAX_PUBLIC_PAGE + 1)), 1);
});

test("recognizes one stable URL form for every page", () => {
  assert.equal(isCanonicalPageQuery(undefined), true);
  assert.equal(isCanonicalPageQuery("1"), false);
  assert.equal(isCanonicalPageQuery("02"), false);
  assert.equal(isCanonicalPageQuery("2"), true);
  assert.equal(getPageHref("/", 1), "/");
  assert.equal(getPageHref("/p/profile-id", 3), "/p/profile-id?page=3");
});

test("calculates inclusive range bounds for one extra record", () => {
  assert.deepEqual(getPageRange(1), { from: 0, to: PUBLIC_PAGE_SIZE });
  assert.deepEqual(getPageRange(2), {
    from: PUBLIC_PAGE_SIZE,
    to: PUBLIC_PAGE_SIZE * 2,
  });
  assert.deepEqual(getPageRange(Number.MAX_SAFE_INTEGER), {
    from: (MAX_PUBLIC_PAGE - 1) * PUBLIC_PAGE_SIZE,
    to: MAX_PUBLIC_PAGE * PUBLIC_PAGE_SIZE,
  });
});

test("calculates bounded previous and next pages", () => {
  assert.deepEqual(getPagination(1, true), { previousPage: null, nextPage: 2 });
  assert.deepEqual(getPagination(4, false), { previousPage: 3, nextPage: null });
  assert.deepEqual(getPagination(MAX_PUBLIC_PAGE, true), {
    previousPage: MAX_PUBLIC_PAGE - 1,
    nextPage: null,
  });
});

test("truncates excerpts at a clean word boundary", () => {
  assert.equal(truncateExcerpt("  Short text.  ", 30), "Short text.");
  assert.equal(truncateExcerpt("Alpha beta gamma delta", 17), "Alpha beta…");
  assert.equal(truncateExcerpt("abcdefghijklmnop", 8), "abcdefg…");
  assert.equal(truncateExcerpt("first line\nsecond line\nthird line", 25), "first line\nsecond line…");
});

test("formats only valid HTTP(S) hostnames", () => {
  assert.equal(formatHostname("https://www.Example.com/article"), "example.com");
  assert.equal(formatHostname("http://news.example.test:8080/path"), "news.example.test");
  assert.equal(formatHostname("javascript:alert(1)"), null);
  assert.equal(formatHostname("not a url"), null);
});

test("validates UUID route identifiers", () => {
  assert.equal(isUuid("41000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("41000000-0000-0000-0000-000000000001"), false);
  assert.equal(isUuid("not-a-uuid"), false);
});
