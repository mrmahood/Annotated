import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getYouTubeTimestampUrl } from '@annotated/shared/youtube';
import {
  takeLeadingNormalizedWindow,
  takeTrailingNormalizedWindow,
} from './article-hover-page.ts';
import {
  buildArticleTextFragmentUrl,
  encodeTextFragmentValue,
  getSourceOpenUrl,
  stripWrappingQuotes,
} from './source-open-url.ts';

const ARTICLE = 'https://abc7.com/post/federal-judge-blocks-deportation-west-chester-man-detained-by-ice-during-immigration-check-in/19681050/';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const AUDIO = 'https://example.com/podcast/episode-42';
const SHORT_PASSAGE = 'The unique passage on this page.';
const ABC7_PREFIX = 'Because they did not allow him to do a credible fear interview with respect to Guyana, the country that they said they were going to send him to and he was under supervision, it was depriving him of his right to due process, so that is the basis of our habeas corpus, meaning you don\'t have a right to hold him without due process,';
const ABC7_SUFFIX = 'He cannot be removed from the detention center to any country at any time until we are fully finished with these submissions.';
const ABC7_STORED = `${ABC7_PREFIX} said Alex's attorney Jane Oak. ${ABC7_SUFFIX}`;

test('article Open source uses a start/end text fragment for long edited quotes', () => {
  const href = buildArticleTextFragmentUrl(ARTICLE, ABC7_STORED);
  const start = takeLeadingNormalizedWindow(ABC7_STORED);
  const end = takeTrailingNormalizedWindow(ABC7_STORED);
  assert.ok(href.startsWith(`${ARTICLE}#:~:text=`));
  assert.match(href, /#:~:text=/);
  assert.ok(href.includes(','));
  assert.ok(href.includes(encodeTextFragmentValue(start)));
  assert.ok(href.includes(encodeTextFragmentValue(end)));
  assert.equal(href.includes(encodeURIComponent("Alex's attorney")), false);
  assert.equal(
    getSourceOpenUrl({ kind: 'article', canonicalUrl: ARTICLE, selectedText: ABC7_STORED }),
    href,
  );
});

test('article Open source uses a single textStart for a short unique passage', () => {
  const href = buildArticleTextFragmentUrl('https://example.com/story', SHORT_PASSAGE);
  assert.equal(
    href,
    `https://example.com/story#:~:text=${encodeTextFragmentValue(SHORT_PASSAGE)}`,
  );
});

test('article Open source falls back to the bare URL when the quote is too short or unsafe', () => {
  assert.equal(buildArticleTextFragmentUrl(ARTICLE, 'too short'), ARTICLE);
  assert.equal(buildArticleTextFragmentUrl(ARTICLE, '   '), ARTICLE);
  assert.equal(buildArticleTextFragmentUrl(ARTICLE, '“”'), ARTICLE);
  assert.equal(buildArticleTextFragmentUrl('javascript:alert(1)', SHORT_PASSAGE), 'javascript:alert(1)');
  assert.equal(
    buildArticleTextFragmentUrl(`${ARTICLE}#existing`, SHORT_PASSAGE).startsWith(`${ARTICLE}#:~:text=`),
    true,
  );
});

test('text fragment values strip wrapping quotes and percent-encode dashes', () => {
  assert.equal(stripWrappingQuotes(`“${SHORT_PASSAGE}”`), SHORT_PASSAGE);
  assert.equal(stripWrappingQuotes(`"${SHORT_PASSAGE}"`), SHORT_PASSAGE);
  assert.ok(encodeTextFragmentValue('word-boundary').includes('%2D'));
  const href = buildArticleTextFragmentUrl(
    'https://example.com/story',
    `"${SHORT_PASSAGE}"`,
  );
  assert.equal(
    href,
    `https://example.com/story#:~:text=${encodeTextFragmentValue(SHORT_PASSAGE)}`,
  );
});

test('YouTube Open source keeps the existing timestamp URL; audio stays a bare canonical', () => {
  assert.equal(
    getSourceOpenUrl({ kind: 'youtube', canonicalUrl: YOUTUBE, startMs: 42_000 }),
    getYouTubeTimestampUrl(YOUTUBE, 42_000),
  );
  assert.equal(
    getSourceOpenUrl({ kind: 'audio', canonicalUrl: AUDIO, startMs: 12_000 }),
    AUDIO,
  );
});

test('Open source helper does not add host permissions or content scripts', async () => {
  const [config, helper, social] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('./source-open-url.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen'\]/);
  assert.doesNotMatch(config, /host_permissions|content_scripts|defineContentScript/);
  assert.doesNotMatch(helper, /chrome\.|host_permissions|defineContentScript|executeScript/);
  assert.match(social, /getSourceOpenUrl/);
  assert.match(social, /#:~:text=|sourceOpenHref|handleArticleSourceOpenClick/);
  assert.match(social, /View original source/);
  assert.match(social, /Open on YouTube/);
});
