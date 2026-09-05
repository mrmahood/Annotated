import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getYouTubeTimestampUrl } from '@annotated/shared/youtube';
import {
  prepareArticlePassageQuery,
  stripWrappingQuotes,
  takeLeadingNormalizedWindow,
  takeTrailingNormalizedWindow,
} from './article-hover-page.ts';
import {
  buildArticleTextFragmentUrl,
  encodeTextFragmentValue,
  getSourceOpenUrl,
} from './source-open-url.ts';

const ARTICLE = 'https://abc7.com/post/federal-judge-blocks-deportation-west-chester-man-detained-by-ice-during-immigration-check-in/19681050/';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const AUDIO = 'https://example.com/podcast/episode-42';
const SHORT_PASSAGE = 'The unique passage on this page.';
const IRAN_STORED = '. Central Command announced that as of Friday, the ongoing U.S. military blockade of Iranian ports has redirected 62 commerci';
const IRAN_CLEANED = 'Central Command announced that as of Friday, the ongoing U.S. military blockade of Iranian ports has redirected 62';
const ENES_URL = 'https://www.foxnews.com/outkick-sports/enes-kanter-freedoms-legal-representatives-file-foia-request-related-chicago-sky-ejection-incident';
const ENES_STORED = 'dom exercised his constitutional right as an American when he attended the WNBA game in Chicago," AFPI chief legal affairs officer Leigh Ann O’Neill said in a statement. "Today, we launched an investigation, seeking critical documents that will assist in our efforts to ensure that public entities are held ac';
const ENES_CLEANED = 'exercised his constitutional right as an American when he attended the WNBA game in Chicago," AFPI chief legal affairs officer Leigh Ann O’Neill said in a statement. "Today, we launched an investigation, seeking critical documents that will assist in our efforts to ensure that public entities are held';
const ABC7_PREFIX = 'Because they did not allow him to do a credible fear interview with respect to Guyana, the country that they said they were going to send him to and he was under supervision, it was depriving him of his right to due process, so that is the basis of our habeas corpus, meaning you don\'t have a right to hold him without due process,';
const ABC7_SUFFIX = 'He cannot be removed from the detention center to any country at any time until we are fully finished with these submissions.';
const ABC7_STORED = `${ABC7_PREFIX} said Alex's attorney Jane Oak. ${ABC7_SUFFIX}`;

test('article text-fragment helper uses a start/end directive for long edited quotes', () => {
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
    ARTICLE,
  );
});

test('Iran-style truncated Open source fragment uses the cleaned prefix, not commerci', () => {
  assert.equal(prepareArticlePassageQuery(IRAN_STORED), IRAN_CLEANED);
  const href = buildArticleTextFragmentUrl('https://example.com/live-news', IRAN_STORED);
  assert.equal(
    href,
    `https://example.com/live-news#:~:text=${encodeTextFragmentValue(IRAN_CLEANED)}`,
  );
  assert.equal(href.includes('commerci'), false);
  assert.match(href, /62$/);
  assert.equal(
    getSourceOpenUrl({
      kind: 'article',
      canonicalUrl: 'https://example.com/live-news',
      selectedText: IRAN_STORED,
    }),
    'https://example.com/live-news',
  );
});

test('Enes-style leading truncation Open source fragment drops dom and held ac', () => {
  assert.equal(prepareArticlePassageQuery(ENES_STORED), ENES_CLEANED);
  assert.match(ENES_CLEANED, /^exercised /);
  const href = buildArticleTextFragmentUrl(ENES_URL, ENES_STORED);
  const decoded = decodeURIComponent(href);
  assert.ok(href.startsWith(`${ENES_URL}#:~:text=`));
  assert.match(decoded, /exercised his constitutional right/);
  assert.equal(decoded.includes('dom '), false);
  assert.equal(decoded.startsWith(`${ENES_URL}#:~:text=dom`), false);
  assert.equal(decoded.includes('held ac'), false);
  assert.equal(
    getSourceOpenUrl({
      kind: 'article',
      canonicalUrl: ENES_URL,
      selectedText: ENES_STORED,
    }),
    ENES_URL,
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
  assert.equal(buildArticleTextFragmentUrl(ARTICLE, '. hi commerci'), ARTICLE);
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

test('article Open source uses the bare canonical URL, not a text fragment', () => {
  assert.equal(
    getSourceOpenUrl({ kind: 'article', canonicalUrl: ARTICLE, selectedText: SHORT_PASSAGE }),
    ARTICLE,
  );
  assert.equal(
    getSourceOpenUrl({
      kind: 'article',
      canonicalUrl: `${ARTICLE}#existing`,
      selectedText: SHORT_PASSAGE,
    }),
    ARTICLE,
  );
  assert.equal(
    getSourceOpenUrl({
      kind: 'article',
      canonicalUrl: `${ARTICLE}#:~:text=old`,
      selectedText: SHORT_PASSAGE,
    }),
    ARTICLE,
  );
});

test('YouTube Open source keeps the existing timestamp URL; audio and page-video stay a bare canonical', () => {
  assert.equal(
    getSourceOpenUrl({ kind: 'youtube', canonicalUrl: YOUTUBE, startMs: 42_000 }),
    getYouTubeTimestampUrl(YOUTUBE, 42_000),
  );
  assert.equal(
    getSourceOpenUrl({ kind: 'audio', canonicalUrl: AUDIO, startMs: 12_000 }),
    AUDIO,
  );
  assert.equal(
    getSourceOpenUrl({ kind: 'video', canonicalUrl: ENES_URL, startMs: 8_000 }),
    ENES_URL,
  );
  assert.equal(
    getSourceOpenUrl({
      kind: 'tiktok',
      canonicalUrl: 'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      startMs: 8_000,
    }),
    'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
  );
});

test('Open source helper stays URL-only and adds no persistent content scripts', async () => {
  const [config, helper, social] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('./source-open-url.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /permissions:\s*\['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'\]/);
  assert.match(config, /host_permissions:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/);
  assert.doesNotMatch(config, /content_scripts|defineContentScript/);
  assert.doesNotMatch(helper, /chrome\.|host_permissions|defineContentScript|executeScript/);
  assert.match(social, /getSourceOpenUrl/);
  assert.match(social, /sourceOpenHref|handleArticleSourceOpenClick|handleAudioSourceOpenClick/);
  assert.doesNotMatch(helper, /return buildArticleTextFragmentUrl/);
  assert.match(social, /View original source/);
  assert.match(social, /Open on YouTube/);
});
