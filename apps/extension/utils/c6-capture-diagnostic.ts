export type C6CaptureDiagnostic = {
  enabled: boolean;
  collectorUrl: string | null;
  variant: string | null;
  loopbackEnabled: boolean;
  timesliceMs: number | null;
  preferredVideoCodec: 'auto' | 'vp9' | 'vp8';
  audioBitsPerSecond: number | null;
  videoBitsPerSecond: number | null;
};

type DiagnosticEnvironment = {
  webAppUrl?: string;
  collectorUrl?: string;
  variant?: string;
  loopback?: string;
  timeslice?: string;
  videoCodec?: string;
  audioBitsPerSecond?: string;
  videoBitsPerSecond?: string;
};

const PRODUCTION_CAPTURE: C6CaptureDiagnostic = {
  enabled: false,
  collectorUrl: null,
  variant: null,
  loopbackEnabled: true,
  timesliceMs: 1_000,
  preferredVideoCodec: 'auto',
  audioBitsPerSecond: null,
  videoBitsPerSecond: null,
};

function localHttpUrl(value: string, label: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`${label} must be an absolute localhost HTTP URL.`); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`${label} must be an absolute localhost HTTP URL.`);
  }
  return url;
}

function boundedInteger(value: string | undefined, label: string, minimum: number, maximum: number) {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} is outside the accepted diagnostic range.`);
  }
  return parsed;
}

export function resolveC6CaptureDiagnostic(environment: DiagnosticEnvironment): C6CaptureDiagnostic {
  if (!environment.collectorUrl) return { ...PRODUCTION_CAPTURE };
  localHttpUrl(environment.webAppUrl ?? '', 'WXT_WEB_APP_URL');
  const collector = localHttpUrl(environment.collectorUrl, 'WXT_C6_CAPTURE_COLLECTOR_URL');
  const variant = environment.variant?.trim();
  if (!variant || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(variant)) {
    throw new Error('WXT_C6_CAPTURE_VARIANT must be a bounded lowercase identifier.');
  }
  if (!['true', 'false'].includes(environment.loopback ?? '')) {
    throw new Error('WXT_C6_CAPTURE_LOOPBACK must be true or false.');
  }
  if (!['1000', 'none'].includes(environment.timeslice ?? '')) {
    throw new Error('WXT_C6_CAPTURE_TIMESLICE must be 1000 or none.');
  }
  if (!['auto', 'vp9', 'vp8'].includes(environment.videoCodec ?? '')) {
    throw new Error('WXT_C6_CAPTURE_VIDEO_CODEC must be auto, vp9, or vp8.');
  }
  return {
    enabled: true,
    collectorUrl: collector.href,
    variant,
    loopbackEnabled: environment.loopback === 'true',
    timesliceMs: environment.timeslice === 'none' ? null : 1_000,
    preferredVideoCodec: environment.videoCodec as 'auto' | 'vp9' | 'vp8',
    audioBitsPerSecond: boundedInteger(environment.audioBitsPerSecond, 'WXT_C6_CAPTURE_AUDIO_BPS', 32_000, 512_000),
    videoBitsPerSecond: boundedInteger(environment.videoBitsPerSecond, 'WXT_C6_CAPTURE_VIDEO_BPS', 250_000, 20_000_000),
  };
}

export function diagnosticMimeType(
  expectVideo: boolean,
  preferredVideoCodec: C6CaptureDiagnostic['preferredVideoCodec'],
  fallback: string | null,
  isSupported: (mime: string) => boolean,
) {
  if (!expectVideo || preferredVideoCodec === 'auto') return fallback;
  const requested = `video/webm;codecs=${preferredVideoCodec},opus`;
  return isSupported(requested) ? requested : null;
}
