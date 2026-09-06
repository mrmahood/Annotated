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

function hasPositiveDimensions(
  width: unknown,
  height: unknown,
): width is number {
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

export function hostedVideoPlayerLayout(
  input: HostedVideoLayoutInput,
): HostedVideoPlayerLayout {
  if (input.mimeType === 'audio/mp4') {
    return { orientation: 'landscape', aspectRatio: null };
  }

  if (hasPositiveDimensions(input.width, input.height)) {
    return {
      orientation: input.height > input.width ? 'portrait' : 'landscape',
      aspectRatio: `${input.width} / ${input.height}`,
    };
  }

  if (input.sourceType === 'tiktok') {
    return { orientation: 'portrait', aspectRatio: '9 / 16' };
  }

  return { orientation: 'landscape', aspectRatio: null };
}
