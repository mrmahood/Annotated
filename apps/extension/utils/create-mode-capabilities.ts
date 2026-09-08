import { getAudioSourceIdentity } from '@annotated/shared/audio-source';
import type { AudioPageSource } from './audio-page.ts';
import type { ModeCapabilities, ModeCapability } from './create-mode.ts';
import {
  isHostedWatchSource,
  isWebpageVideoCapableSource,
  type PageSource,
  type SourceState,
  type SpotifyPageSource,
} from './connected-source.ts';

export type WatchPageAudioIdentity = {
  url: string;
  canonicalUrl: string;
  normalizedUrl: string;
  title: string;
  author: string | null;
  publisher: string | null;
  showName: string | null;
};

export type CreateAudioIdentity = AudioPageSource | SpotifyPageSource | WatchPageAudioIdentity;

function createUnavailableCapabilities(reason: string): ModeCapabilities {
  return {
    text: { status: 'unavailable', reason },
    video: { status: 'unavailable', reason },
    audio: { status: 'unavailable', reason },
  };
}

export function connectedAudioSource(source: PageSource): AudioPageSource | null {
  if (source.classification === 'Podcast / web audio') return source;
  if (source.classification === 'Web page' && source.audioAvailable && source.audioIdentity) {
    return source.audioIdentity;
  }
  return null;
}

export function connectedSpotifySource(source: PageSource): SpotifyPageSource | null {
  return source.classification === 'Spotify' ? source : null;
}

export function audioUsesWatchPlayer(source: PageSource): boolean {
  if (isHostedWatchSource(source)) return true;
  return isWebpageVideoCapableSource(source) && source.videoAvailable && !connectedAudioSource(source);
}

export function watchPageAudioIdentity(source: PageSource): WatchPageAudioIdentity | null {
  if (source.classification === 'YouTube') {
    const identity = getAudioSourceIdentity(source.normalizedUrl);
    return {
      url: source.url,
      canonicalUrl: identity.canonicalUrl,
      normalizedUrl: identity.normalizedUrl,
      title: source.title,
      author: source.channelName,
      publisher: 'YouTube',
      showName: null,
    };
  }
  if (source.classification === 'TikTok') {
    const identity = getAudioSourceIdentity(source.normalizedUrl);
    return {
      url: source.url,
      canonicalUrl: identity.canonicalUrl,
      normalizedUrl: identity.normalizedUrl,
      title: source.title,
      author: source.author,
      publisher: 'TikTok',
      showName: null,
    };
  }
  if (audioUsesWatchPlayer(source) && isWebpageVideoCapableSource(source)) {
    const identity = getAudioSourceIdentity(source.url);
    return {
      url: source.url,
      canonicalUrl: identity.canonicalUrl,
      normalizedUrl: identity.normalizedUrl,
      title: source.title,
      author: null,
      publisher: source.hostname,
      showName: null,
    };
  }
  return null;
}

export function createAudioIdentity(source: PageSource): CreateAudioIdentity | null {
  return connectedSpotifySource(source) ?? connectedAudioSource(source) ?? watchPageAudioIdentity(source);
}

function audioCapabilityForConnectedSource(
  sourceState: Extract<SourceState, { status: 'connected' }>,
): ModeCapability {
  if (connectedAudioSource(sourceState.source)) {
    return { status: 'available' };
  }
  if (sourceState.source.classification === 'Web page') {
    if (sourceState.source.videoAvailable) return { status: 'available' };
    if (!sourceState.source.audioDetectionResolved || !sourceState.source.videoDetectionResolved) {
      return { status: 'checking' };
    }
    return { status: 'unavailable', reason: 'No supported top-level page audio or video was found.' };
  }
  if (sourceState.source.classification === 'Podcast / web audio') {
    return { status: 'available' };
  }
  return { status: 'unavailable', reason: 'No supported top-level page audio was found.' };
}

export function getModeCapabilities(sourceState: SourceState): ModeCapabilities {
  if (
    sourceState.status === 'loading' ||
    sourceState.status === 'refreshing'
  ) {
    return {
      text: { status: 'checking' },
      video: { status: 'checking' },
      audio: { status: 'checking' },
    };
  }
  if (sourceState.status !== 'connected') {
    const reason = sourceState.status === 'different-tab'
      ? 'Return to the connected tab or connect this tab.'
      : sourceState.status === 'reconnect-required'
        ? 'Reconnect Annotated to this page.'
        : 'Connect a supported HTTP(S) page first.';
    return createUnavailableCapabilities(reason);
  }
  if (sourceState.source.classification === 'YouTube') {
    return {
      text: { status: 'available' },
      video: { status: 'available' },
      audio: { status: 'available' },
    };
  }
  if (sourceState.source.classification === 'TikTok') {
    return {
      text: { status: 'available' },
      video: { status: 'available' },
      audio: { status: 'available' },
    };
  }
  if (sourceState.source.classification === 'Spotify') {
    return {
      text: { status: 'available' },
      video: { status: 'unavailable', reason: 'Video mode supports watch pages, not Spotify episodes.' },
      audio: sourceState.source.pageBlock === 'login'
        ? { status: 'unavailable', reason: 'This Spotify tab is not playing an episode. Start the preview, or sign in if it is gated.' }
        : { status: 'available' },
    };
  }
  if (sourceState.source.classification === 'Podcast / web audio') {
    return {
      text: { status: 'available' },
      video: sourceState.source.videoDetectionResolved
        ? sourceState.source.videoAvailable
          ? { status: 'available' }
          : { status: 'unavailable', reason: 'No safe readable webpage video was found.' }
        : { status: 'checking' },
      audio: audioCapabilityForConnectedSource(sourceState),
    };
  }
  return {
    text: { status: 'available' },
    video: sourceState.source.videoDetectionResolved
      ? sourceState.source.videoAvailable
        ? { status: 'available' }
        : { status: 'unavailable', reason: 'No safe readable webpage video was found.' }
      : { status: 'checking' },
    audio: audioCapabilityForConnectedSource(sourceState),
  };
}
