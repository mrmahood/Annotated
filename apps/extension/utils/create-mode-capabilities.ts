import type { AudioPageSource } from './audio-page.ts';
import type { ModeCapabilities, ModeCapability } from './create-mode.ts';
import {
  type PageSource,
  type SourceState,
  type SpotifyPageSource,
} from './connected-source.ts';

export type CreateAudioIdentity = AudioPageSource | SpotifyPageSource;

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

export function createAudioIdentity(source: PageSource): CreateAudioIdentity | null {
  return connectedSpotifySource(source) ?? connectedAudioSource(source);
}

function audioCapabilityForConnectedSource(
  sourceState: Extract<SourceState, { status: 'connected' }>,
): ModeCapability {
  if (connectedAudioSource(sourceState.source)) {
    return { status: 'available' };
  }
  if (sourceState.source.classification === 'Web page') {
    return sourceState.source.audioDetectionResolved
      ? { status: 'unavailable', reason: 'No supported top-level page audio was found.' }
      : { status: 'checking' };
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
      audio: { status: 'unavailable', reason: 'Audio mode supports top-level page audio, not YouTube video.' },
    };
  }
  if (sourceState.source.classification === 'TikTok') {
    return {
      text: { status: 'available' },
      video: { status: 'available' },
      audio: { status: 'unavailable', reason: 'Audio mode supports top-level page audio, not TikTok video.' },
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
