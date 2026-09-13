import { getAudioSourceIdentity, isApplePodcastsUrl } from '@annotated/shared/audio-source';
import { isTikTokVideoUrl, getTikTokVideoIdentity } from '@annotated/shared/tiktok';
import { getSpotifyEpisodeIdentity, isSpotifyEpisodeUrl } from '@annotated/shared/spotify';
import { normalizeArticleUrl } from '@annotated/shared/url-normalization';
import { isYouTubeVideoUrl, getYouTubeVideoIdentity } from '@annotated/shared/youtube';
import type { AudioPageSource } from './audio-page.ts';
import { normalizeSpotifyEpisodeTitle } from './spotify-page.ts';
import { normalizeTikTokVideoTitle } from './tiktok-page.ts';
import { normalizeYouTubeVideoTitle } from './youtube-page.ts';

export type ArticlePageSource = {
  title: string;
  hostname: string;
  url: string;
  classification: 'Web page';
  audioDetectionResolved: boolean;
  audioAvailable: boolean;
  audioIdentity: AudioPageSource | null;
  exclusivePodcast: boolean;
  videoDetectionResolved: boolean;
  videoAvailable: boolean;
};

export type YouTubePageSource = {
  title: string;
  hostname: 'youtube.com';
  url: string;
  classification: 'YouTube';
  videoId: string;
  normalizedUrl: string;
  canonicalUrl: string;
  channelName: string | null;
  metadataResolved: boolean;
};

export type TikTokPageSource = {
  title: string;
  hostname: 'tiktok.com';
  url: string;
  classification: 'TikTok';
  videoId: string;
  handle: string;
  normalizedUrl: string;
  canonicalUrl: string;
  author: string | null;
  metadataResolved: boolean;
};

export type SpotifyPageSource = {
  title: string;
  hostname: 'open.spotify.com';
  url: string;
  classification: 'Spotify';
  episodeId: string;
  normalizedUrl: string;
  canonicalUrl: string;
  author: string | null;
  showName: string | null;
  metadataResolved: boolean;
  pageBlock: null | 'login' | 'unreadable-time';
};

export type AudioVideoPageSource = AudioPageSource & {
  videoDetectionResolved: boolean;
  videoAvailable: boolean;
};

export type PageSource =
  | ArticlePageSource
  | YouTubePageSource
  | TikTokPageSource
  | SpotifyPageSource
  | AudioVideoPageSource;

export type SourceState =
  | { status: 'loading' }
  | { status: 'connected'; source: PageSource }
  | { status: 'refreshing' }
  | { status: 'not-connected' }
  | { status: 'different-tab' }
  | { status: 'reconnect-required' }
  | { status: 'unsupported'; url?: string }
  | { status: 'unexpected-error'; message: string };

export type HostedVideoBeginRpc =
  | 'begin_hosted_youtube_annotation'
  | 'begin_hosted_tiktok_annotation'
  | 'begin_hosted_webpage_video_annotation';

export function isHostedWatchSource(source: PageSource): source is YouTubePageSource | TikTokPageSource {
  return source.classification === 'YouTube' || source.classification === 'TikTok';
}

export function isWebpageVideoCapableSource(
  source: PageSource,
): source is ArticlePageSource | AudioVideoPageSource {
  return source.classification === 'Web page' ||
    (source.classification === 'Podcast / web audio' && !isApplePodcastsUrl(source.url));
}

export function videoPlayerSourceKey(source: PageSource): string {
  return isHostedWatchSource(source) ? source.videoId : normalizeArticleUrl(source.url);
}

export function hostedVideoBeginRpc(url: string): HostedVideoBeginRpc {
  if (isYouTubeVideoUrl(url)) return 'begin_hosted_youtube_annotation';
  if (isTikTokVideoUrl(url)) return 'begin_hosted_tiktok_annotation';
  return 'begin_hosted_webpage_video_annotation';
}

export function getSourceState(title: string, value: string): SourceState {
  const tabUrl = value.trim();
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'unsupported', url: tabUrl };
    }
    if (isYouTubeVideoUrl(tabUrl)) {
      return {
        status: 'connected',
        source: {
          title: normalizeYouTubeVideoTitle(title) || 'youtube.com',
          hostname: 'youtube.com',
          url: tabUrl,
          classification: 'YouTube',
          ...getYouTubeVideoIdentity(tabUrl),
          channelName: null,
          metadataResolved: false,
        },
      };
    }
    if (isTikTokVideoUrl(tabUrl)) {
      return {
        status: 'connected',
        source: {
          title: normalizeTikTokVideoTitle(title) || 'tiktok.com',
          hostname: 'tiktok.com',
          url: tabUrl,
          classification: 'TikTok',
          ...getTikTokVideoIdentity(tabUrl),
          author: null,
          metadataResolved: false,
        },
      };
    }
    if (isSpotifyEpisodeUrl(tabUrl)) {
      return {
        status: 'connected',
        source: {
          title: normalizeSpotifyEpisodeTitle(title) || 'Spotify episode',
          hostname: 'open.spotify.com',
          url: tabUrl,
          classification: 'Spotify',
          ...getSpotifyEpisodeIdentity(tabUrl),
          author: null,
          showName: null,
          metadataResolved: false,
          pageBlock: null,
        },
      };
    }
    if (isApplePodcastsUrl(tabUrl)) {
      const identity = getAudioSourceIdentity(tabUrl);
      const episodeTitle = title.replace(/\s+/g, ' ').trim();
      return {
        status: 'connected',
        source: {
          title: episodeTitle && !/^apple podcasts$/i.test(episodeTitle)
            ? episodeTitle
            : 'Apple Podcasts episode',
          hostname: identity.hostname,
          url: tabUrl,
          normalizedUrl: identity.normalizedUrl,
          canonicalUrl: identity.canonicalUrl,
          classification: 'Podcast / web audio',
          author: null,
          publisher: 'Apple Podcasts',
          showName: null,
          playerId: null,
          playerStatus: 'current-time-unavailable',
          videoDetectionResolved: true,
          videoAvailable: false,
        },
      };
    }
    return {
      status: 'connected',
      source: {
        title: title.trim() || 'Untitled page',
        hostname: url.hostname,
        url: tabUrl,
        classification: 'Web page',
        audioDetectionResolved: false,
        audioAvailable: false,
        audioIdentity: null,
        exclusivePodcast: false,
        videoDetectionResolved: false,
        videoAvailable: false,
      },
    };
  } catch {
    return { status: 'unsupported', url: tabUrl || undefined };
  }
}
