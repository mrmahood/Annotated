export type HostedVideoLayoutInput = {
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  sourceType?: string | null;
};

export type HostedVideoOrientation = 'portrait' | 'landscape';

export type HostedVideoPlayerLayout = {
  orientation: HostedVideoOrientation;
  aspectRatio: string | null;
};

function readPositiveDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function hostedVideoPlayerLayout(
  input: HostedVideoLayoutInput,
): HostedVideoPlayerLayout {
  if (input.mimeType === 'audio/mp4') {
    return { orientation: 'landscape', aspectRatio: null };
  }

  const width = readPositiveDimension(input.width);
  const height = readPositiveDimension(input.height);
  if (width !== null && height !== null) {
    return {
      orientation: height > width ? 'portrait' : 'landscape',
      aspectRatio: `${width} / ${height}`,
    };
  }

  if (input.sourceType === 'tiktok') {
    return { orientation: 'portrait', aspectRatio: '9 / 16' };
  }

  return { orientation: 'landscape', aspectRatio: null };
}
