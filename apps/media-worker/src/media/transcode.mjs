function seconds(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new TypeError('Invalid media timestamp.');
  return (milliseconds / 1000).toFixed(3);
}

const commonInput = (leadInMs, inputPath, requestedDurationMs) => [
  '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
  '-i', inputPath,
  '-ss', seconds(leadInMs),
  '-t', seconds(requestedDurationMs),
  '-map_metadata', '-1', '-map_chapters', '-1',
  '-fflags', '+bitexact',
];

export function buildVideoTranscodeArguments({ inputPath, outputPath, leadInMs, requestedDurationMs, crop }) {
  const filter = [
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    "scale=w='min(426,iw)':h='min(240,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos",
    'setsar=1',
    'format=yuv420p',
  ].join(',');
  return [
    ...commonInput(leadInMs, inputPath, requestedDurationMs),
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', filter,
    '-c:v', 'libopenh264', '-profile:v', 'main', '-rc_mode', 'bitrate',
    '-b:v', '450k', '-maxrate', '600k', '-bufsize', '1200k',
    '-flags:v', '+bitexact',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2',
    '-flags:a', '+bitexact',
    '-movflags', '+faststart', '-f', 'mp4',
    outputPath,
  ];
}

export function buildAudioTranscodeArguments({ inputPath, outputPath, leadInMs, requestedDurationMs }) {
  return [
    ...commonInput(leadInMs, inputPath, requestedDurationMs),
    '-map', '0:a:0', '-vn',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2',
    '-flags:a', '+bitexact',
    '-movflags', '+faststart', '-f', 'mp4',
    outputPath,
  ];
}
