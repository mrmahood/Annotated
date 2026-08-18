import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixtureRoot = path.join(workerRoot, 'test', 'fixtures');
export const generatedFixtureRoot = path.join(fixtureRoot, 'generated');

function merge(base, override) {
  if (Array.isArray(override) || !override || typeof override !== 'object') return structuredClone(override);
  const result = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(override)) result[key] = merge(result[key], value);
  return result;
}

export async function loadMetadata(name) {
  const document = JSON.parse(await readFile(path.join(fixtureRoot, 'metadata', name), 'utf8'));
  if (!document.base) return document;
  const base = await loadMetadata(document.base);
  return merge(base, document.override);
}

export function ffmpegExecutables() {
  const bin = process.env.ANNOTATED_FFMPEG_BIN;
  if (!bin) return null;
  return {
    ffmpegPath: path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ffprobePath: path.join(bin, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
  };
}
