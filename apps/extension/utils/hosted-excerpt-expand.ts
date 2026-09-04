import { isHostedExcerptReady, type HostedExcerpt } from './hosted-playback.ts';

export type HostedExcerptCardStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Identity of a Feed expand hosted-excerpt load.
 * Status is intentionally omitted so idle → loading cannot cancel the request.
 */
export function hostedExcerptExpandSessionKey(input: {
  expanded: boolean;
  annotationId: string;
  kind: 'article' | 'youtube' | 'audio';
}): string | null {
  if (!input.expanded || input.kind === 'article') return null;
  return `${input.annotationId}:${input.kind}`;
}

export function hostedExcerptStatusAfterLoad(
  result: HostedExcerpt | null,
): Extract<HostedExcerptCardStatus, 'ready' | 'unavailable'> {
  return isHostedExcerptReady(result) ? 'ready' : 'unavailable';
}
