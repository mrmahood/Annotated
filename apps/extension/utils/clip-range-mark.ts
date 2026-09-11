import type { PageSource } from './connected-source.ts';
import {
  applyAudioHoverOnConnectedTab,
  clearAudioHoverOnConnectedTab,
  type AudioHoverConnection,
} from './audio-hover-link.ts';
import {
  applyPageVideoHoverOnConnectedTab,
  clearPageVideoHoverOnConnectedTab,
  type PageVideoHoverConnection,
} from './page-video-hover-link.ts';
import { normalizePageVideoHoverPageUrl } from './page-video-hover-page.ts';
import {
  applySpotifyHoverOnConnectedTab,
  clearSpotifyHoverOnConnectedTab,
  type SpotifyHoverConnection,
} from './spotify-hover-link.ts';
import {
  applyTikTokHoverOnConnectedTab,
  clearTikTokHoverOnConnectedTab,
  type TikTokHoverConnection,
} from './tiktok-hover-link.ts';
import {
  applyYouTubeHoverOnConnectedTab,
  clearYouTubeHoverOnConnectedTab,
  type YouTubeHoverConnection,
} from './youtube-hover-link.ts';
import {
  connectedAudioSource,
  connectedSpotifySource,
} from './create-mode-capabilities.ts';

export type CreateClipRangeMarkConnection = {
  tabId: number;
  tabUrl: string;
};

export async function applyCreateClipRangeMark(input: {
  source: PageSource;
  connection: CreateClipRangeMarkConnection;
  startMs: number;
  endMs: number;
  mode: 'video' | 'audio';
}): Promise<void> {
  const { source, connection, startMs, endMs, mode } = input;
  if (mode === 'video') {
    if (source.classification === 'YouTube') {
      await applyYouTubeHoverOnConnectedTab(connection as YouTubeHoverConnection, {
        videoId: source.videoId,
        strength: 'range',
        startMs,
        endMs,
        seekMs: null,
      });
      return;
    }
    if (source.classification === 'TikTok') {
      await applyTikTokHoverOnConnectedTab(connection as TikTokHoverConnection, {
        videoId: source.videoId,
        strength: 'range',
        startMs,
        endMs,
      });
      return;
    }
    if (source.classification === 'Web page') {
      let normalizedUrl = source.url;
      try { normalizedUrl = normalizePageVideoHoverPageUrl(source.url); } catch { /* Keep the page URL. */ }
      await applyPageVideoHoverOnConnectedTab(connection as PageVideoHoverConnection, {
        canonicalUrl: source.url,
        normalizedUrl,
        strength: 'range',
        startMs,
        endMs,
      });
    }
    return;
  }
  const spotify = connectedSpotifySource(source);
  if (spotify) {
    await applySpotifyHoverOnConnectedTab(connection as SpotifyHoverConnection, {
      episodeId: spotify.episodeId,
      strength: 'range',
      startMs,
      endMs,
    });
    return;
  }
  const audio = connectedAudioSource(source);
  if (audio) {
    await applyAudioHoverOnConnectedTab(connection as AudioHoverConnection, {
      canonicalUrl: audio.canonicalUrl,
      normalizedUrl: audio.normalizedUrl,
      strength: 'range',
      startMs,
      endMs,
    });
  }
}

export async function clearCreateClipRangeMark(input: {
  source: PageSource;
  connection: CreateClipRangeMarkConnection;
  mode: 'video' | 'audio';
}): Promise<void> {
  const { source, connection, mode } = input;
  if (mode === 'video') {
    if (source.classification === 'YouTube') {
      await clearYouTubeHoverOnConnectedTab(connection as YouTubeHoverConnection);
      return;
    }
    if (source.classification === 'TikTok') {
      await clearTikTokHoverOnConnectedTab(connection as TikTokHoverConnection);
      return;
    }
    if (source.classification === 'Web page') {
      await clearPageVideoHoverOnConnectedTab(connection as PageVideoHoverConnection);
    }
    return;
  }
  if (connectedSpotifySource(source)) {
    await clearSpotifyHoverOnConnectedTab(connection as SpotifyHoverConnection);
    return;
  }
  if (connectedAudioSource(source)) {
    await clearAudioHoverOnConnectedTab(connection as AudioHoverConnection);
  }
}
