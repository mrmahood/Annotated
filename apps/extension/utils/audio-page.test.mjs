import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyConnectedSource,
  getAudioPlayerReadiness,
  hasStrongPodcastSignals,
  selectAudioPlayerCandidate,
  validateAudioPageSnapshot,
} from './audio-page.ts';

const base = {
  currentTime: 12,
  duration: 120,
  paused: true,
  ended: false,
  sourcePresent: true,
  operable: true,
};

test('prefers the currently playing audio element', () => {
  const selection = selectAudioPlayerCandidate([
    { ...base, playerId: 'audio:0', elementType: 'audio' },
    { ...base, playerId: 'audio:1', elementType: 'audio', paused: false },
  ]);
  assert.equal(selection.status, 'supported');
  assert.equal(selection.status === 'supported' && selection.player.playerId, 'audio:1');
});

test('prefers audio over an explicitly audio-only video element', () => {
  const selection = selectAudioPlayerCandidate([
    { ...base, playerId: 'audio-only-video:0', elementType: 'audio-only-video' },
    { ...base, playerId: 'audio:1', elementType: 'audio' },
  ]);
  assert.equal(selection.status, 'supported');
  assert.equal(selection.status === 'supported' && selection.player.playerId, 'audio:1');
});

test('keeps genuinely ambiguous audio players ambiguous', () => {
  assert.equal(selectAudioPlayerCandidate([
    { ...base, playerId: 'audio:0', elementType: 'audio' },
    { ...base, playerId: 'audio:1', elementType: 'audio' },
  ]).status, 'ambiguous');
});

test('selects a credible unplayed audio source before duration is available', () => {
  const selection = selectAudioPlayerCandidate([
    { ...base, playerId: 'audio:0', elementType: 'audio', currentTime: 0, duration: null },
  ]);
  assert.equal(selection.status, 'supported');
  assert.equal(selection.status === 'supported' && selection.player.playerId, 'audio:0');
});

test('reports player readiness separately and keeps finite time capturable', () => {
  assert.deepEqual(getAudioPlayerReadiness({
    ...base,
    playerId: 'audio:0',
    elementType: 'audio',
    currentTime: 7.25,
    duration: null,
  }), {
    status: 'duration-unavailable',
    currentTime: 7.25,
    duration: null,
  });
  assert.deepEqual(getAudioPlayerReadiness({
    ...base,
    playerId: 'audio:0',
    elementType: 'audio',
    currentTime: null,
    duration: null,
  }), {
    status: 'current-time-unavailable',
    currentTime: null,
    duration: null,
  });
});

test('loaded audio is both supported and ready', () => {
  const result = validateAudioPageSnapshot('https://example.test/episode', {
    pageUrl: 'https://example.test/episode',
    candidates: [{ ...base, playerId: 'audio:0', elementType: 'audio' }],
    metadata: { title: 'Episode', schemaTypes: ['PodcastEpisode'] },
  });
  assert.equal(result.status, 'supported');
  assert.equal(result.status === 'supported' && result.source.playerStatus, 'ready');
  assert.equal(result.status === 'supported' && result.readiness?.duration, 120);
});

test('unplayed supported audio classifies the page as audio without loaded duration', () => {
  const result = validateAudioPageSnapshot('https://example.test/episode', {
    pageUrl: 'https://example.test/episode',
    candidates: [{
      ...base,
      playerId: 'audio:0',
      elementType: 'audio',
      currentTime: 0,
      duration: null,
    }],
    metadata: { title: 'Episode', ogType: 'music.song' },
  });
  assert.equal(result.status, 'supported');
  assert.equal(result.status === 'supported' && result.source.playerStatus, 'duration-unavailable');
  assert.equal(classifyConnectedSource('https://example.test/episode', result.status), 'audio');
});

test('an ambiguous supported audio page stays audio with dedicated player state', () => {
  const result = validateAudioPageSnapshot('https://example.test/episode', {
    pageUrl: 'https://example.test/episode',
    candidates: [
      { ...base, playerId: 'audio:0', elementType: 'audio', duration: null },
      { ...base, playerId: 'audio:1', elementType: 'audio', duration: null },
    ],
    metadata: { title: 'Episode', audioMetadataPresent: true },
  });
  assert.equal(result.status, 'supported');
  assert.equal(result.status === 'supported' && result.selection.status, 'ambiguous');
  assert.equal(result.status === 'supported' && result.source.playerStatus, 'ambiguous');
});

test('validates supported audio metadata and normalized episode identity', () => {
  const result = validateAudioPageSnapshot('https://Example.test/episode/42?t=10', {
    pageUrl: 'https://example.test/episode/42?utm_source=x',
    candidates: [{ ...base, playerId: 'audio:0', elementType: 'audio' }],
    metadata: {
      title: ' Episode 42 ',
      canonicalUrl: 'https://example.test/episode/42',
      publisher: 'Example FM',
      showName: 'The Example Show',
      author: 'A. Host',
      ogType: 'music.radio_station',
      podcastSignalsPresent: true,
    },
  });
  assert.equal(result.status, 'supported');
  assert.equal(result.status === 'supported' && result.source.normalizedUrl, 'https://example.test/episode/42');
  assert.equal(result.status === 'supported' && result.source.showName, 'The Example Show');
});

test('does not accept an arbitrary video descriptor as audio playback', () => {
  assert.equal(selectAudioPlayerCandidate([{
    ...base,
    playerId: 'video:0',
    elementType: 'video',
  }]).status, 'no-audio');
});

test('a visible video descriptor does not turn a normal page into podcast mode', () => {
  const result = validateAudioPageSnapshot('https://example.com/article', {
    pageUrl: 'https://example.com/article',
    candidates: [{
      ...base,
      playerId: 'video:0',
      elementType: 'video',
    }],
    metadata: { title: 'Article' },
  });
  assert.equal(result.status, 'not-audio-page');
  assert.equal(classifyConnectedSource('https://example.com/article', result.status), 'article');
});

test('hidden inoperable audio-only media does not make a Fox-shaped article audio-capable', () => {
  const articleUrl = 'https://www.foxnews.com/us/prosecutor-infamous-killer-mom-case-says-women-lindsay-clancy-jury-may-bring-strange-twist-verdict';
  const result = validateAudioPageSnapshot(articleUrl, {
    pageUrl: articleUrl,
    candidates: [{
      ...base,
      playerId: 'audio-only-video:0',
      elementType: 'audio-only-video',
      duration: 292.968,
      operable: false,
    }],
    metadata: { title: 'Fox News article' },
  });

  assert.equal(result.status, 'not-audio-page');
  assert.equal(classifyConnectedSource(articleUrl, result.status), 'article');
});

test('hidden vendor media plus a visible Fox article video does not enable Audio', () => {
  const articleUrl = 'https://www.foxnews.com/politics/la-dem-candidates-torched-disgusted-residents-disgraceful-debate-both-bad';
  const result = validateAudioPageSnapshot(articleUrl, {
    pageUrl: articleUrl,
    candidates: [
      {
        ...base,
        playerId: 'audio-only-video:0',
        elementType: 'audio-only-video',
        currentTime: 0,
        duration: 336.216,
        operable: false,
      },
      {
        ...base,
        playerId: 'video:1',
        elementType: 'video',
        currentTime: 7.041667,
        duration: 7.041667,
        ended: true,
      },
    ],
    metadata: { title: 'Fox News article', audioMetadataPresent: false },
  });

  assert.equal(result.status, 'not-audio-page');
  assert.equal(classifyConnectedSource(articleUrl, result.status), 'article');
});

test('an audio element without a media source is not a credible player', () => {
  assert.equal(selectAudioPlayerCandidate([{
    ...base,
    playerId: 'audio:0',
    elementType: 'audio',
    sourcePresent: false,
  }]).status, 'no-audio');
});

test('a bare NYT-like article audio player is an audio capability without exclusive podcast signals', () => {
  const articleUrl = 'https://www.nytimes.com/2026/09/04/us/politics/trump-administration-fund-compensation-jan-6.html';
  const result = validateAudioPageSnapshot(articleUrl, {
    pageUrl: articleUrl,
    candidates: [{ ...base, playerId: 'audio:0', elementType: 'audio' }],
    metadata: {
      title: 'Trump Administration Fund Compensation',
      ogType: 'article',
      author: 'Reporter',
      audioMetadataPresent: false,
      applePodcasts: false,
      podcastSignalsPresent: false,
      schemaTypes: ['NewsArticle'],
    },
  });
  assert.equal(result.status, 'supported');
  assert.equal(result.status === 'supported' && result.exclusivePodcast, false);
  assert.equal(classifyConnectedSource(articleUrl, result.status), 'audio');
  assert.equal(hasStrongPodcastSignals({
    ogType: 'article',
    schemaTypes: ['NewsArticle'],
    audioMetadataPresent: false,
  }), false);
});

test('strong podcast metadata still classifies a page with an audio player as podcast', () => {
  const result = validateAudioPageSnapshot('https://example.test/shows/42', {
    pageUrl: 'https://example.test/shows/42',
    candidates: [{ ...base, playerId: 'audio:0', elementType: 'audio' }],
    metadata: {
      title: 'Episode 42',
      schemaTypes: ['PodcastEpisode'],
    },
  });
  assert.equal(result.status, 'supported');
  assert.equal(result.status === 'supported' && result.exclusivePodcast, true);
  assert.equal(classifyConnectedSource('https://example.test/shows/42', result.status), 'audio');
  assert.equal(hasStrongPodcastSignals({ ogType: 'music.song' }), true);
  assert.equal(hasStrongPodcastSignals({ applePodcasts: true }), true);
  assert.equal(hasStrongPodcastSignals({ audioMetadataPresent: true }), true);
});

test('the serialized page snapshot reads schema, og:type, and Apple podcast signals', async () => {
  const source = await readFile(new URL('./audio-page.ts', import.meta.url), 'utf8');
  const snapshot = source.slice(source.indexOf('export function readAudioPageSnapshot'), source.indexOf('export function validateAudioPageSnapshot'));
  assert.match(snapshot, /PodcastEpisode/);
  assert.match(snapshot, /og:type/);
  assert.match(snapshot, /podcasts\.apple\.com/);
  assert.match(snapshot, /podcastSignalsPresent/);
});

test('discriminates article, YouTube, supported audio, and unsupported audio states', () => {
  assert.equal(classifyConnectedSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'no-audio'), 'youtube');
  assert.equal(classifyConnectedSource('https://example.com/article', 'not-audio-page'), 'article');
  assert.equal(classifyConnectedSource('https://example.com/episode', 'supported'), 'audio');
  assert.equal(classifyConnectedSource('https://example.com/episode', 'no-audio'), 'audio-unsupported');
});
