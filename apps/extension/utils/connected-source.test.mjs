import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSourceState,
  hostedVideoBeginRpc,
  isHostedWatchSource,
  videoPlayerSourceKey,
} from './connected-source.ts';

const ABC_NEWS = 'https://www.tiktok.com/@abcnews/video/7682104834304036110';
const ABC_TITLE = '(32)ABC News (@abcnews) | TikTok';
const BBC_WATCH = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const HTML5_PAGE = 'https://www.example.test/news/clip';
const SPOTIFY = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ';

test('TikTok watch URLs classify as TikTok, not Web page', () => {
  const state = getSourceState(ABC_TITLE, ABC_NEWS);
  assert.equal(state.status, 'connected');
  assert.equal(state.source.classification, 'TikTok');
  assert.equal(state.source.hostname, 'tiktok.com');
  assert.equal(state.source.videoId, '7682104834304036110');
  assert.equal(state.source.handle, 'abcnews');
  assert.equal(state.source.normalizedUrl, ABC_NEWS);
  assert.equal(isHostedWatchSource(state.source), true);
  assert.equal(videoPlayerSourceKey(state.source), '7682104834304036110');
});

test('TikTok watch URLs keep hosted identity when query, locale, or extra path is present', () => {
  const title = 'BBC News';
  for (const url of [
    `${BBC_WATCH}?is_from_webapp=1&sender_device=pc&t=12`,
    'https://m.tiktok.com/@bbcnews/video/7550123456789012345',
    'https://www.tiktok.com/en/@bbcnews/video/7550123456789012345',
    `${BBC_WATCH}/`,
  ]) {
    const state = getSourceState(title, url);
    assert.equal(state.status, 'connected', url);
    assert.equal(state.source.classification, 'TikTok', url);
    assert.equal(state.source.videoId, '7550123456789012345', url);
    assert.equal(hostedVideoBeginRpc(url), 'begin_hosted_tiktok_annotation', url);
  }
});

test('Video publish RPC follows watch identity, not generic webpage video', () => {
  assert.equal(hostedVideoBeginRpc(ABC_NEWS), 'begin_hosted_tiktok_annotation');
  assert.equal(hostedVideoBeginRpc(YOUTUBE), 'begin_hosted_youtube_annotation');
  assert.equal(hostedVideoBeginRpc(HTML5_PAGE), 'begin_hosted_webpage_video_annotation');
  assert.equal(hostedVideoBeginRpc('https://www.tiktok.com/foryou'), 'begin_hosted_webpage_video_annotation');
});

test('YouTube watch URLs stay on the YouTube hosted begin path', () => {
  const state = getSourceState('Never Gonna Give You Up', YOUTUBE);
  assert.equal(state.status, 'connected');
  assert.equal(state.source.classification, 'YouTube');
  assert.equal(state.source.videoId, 'dQw4w9WgXcQ');
  assert.equal(hostedVideoBeginRpc(YOUTUBE), 'begin_hosted_youtube_annotation');
});

test('Spotify episode URLs classify as Spotify, not generic webpage audio', () => {
  const state = getSourceState('The Daily | Spotify', `${SPOTIFY}?si=share`);
  assert.equal(state.status, 'connected');
  assert.equal(state.source.classification, 'Spotify');
  assert.equal(state.source.hostname, 'open.spotify.com');
  assert.equal(state.source.episodeId, '7makk4oTQel546B0P8lOOJ');
  assert.equal(state.source.normalizedUrl, SPOTIFY);
  assert.equal(isHostedWatchSource(state.source), false);
});

test('Spotify home, search, and show-only URLs stay generic Web page', () => {
  for (const url of [
    'https://open.spotify.com/',
    'https://open.spotify.com/search/news',
    'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
  ]) {
    const state = getSourceState('Spotify', url);
    assert.equal(state.status, 'connected', url);
    assert.equal(state.source.classification, 'Web page', url);
  }
});

test('non-TikTok HTML5 pages stay Web page for generic webpage-video publish', () => {
  const state = getSourceState('News clip', HTML5_PAGE);
  assert.equal(state.status, 'connected');
  assert.equal(state.source.classification, 'Web page');
  assert.equal(state.source.hostname, 'www.example.test');
  assert.equal(hostedVideoBeginRpc(HTML5_PAGE), 'begin_hosted_webpage_video_annotation');
  assert.equal(isHostedWatchSource(state.source), false);
});
