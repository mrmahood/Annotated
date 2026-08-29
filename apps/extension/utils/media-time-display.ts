export type MediaRangeDisplay = {
  start: string;
  end: string;
  length: string;
};

const EMPTY_TIME = '--:--';

function toTenths(milliseconds: number): number | null {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return null;
  return Math.round(milliseconds / 100);
}

function formatTenths(totalTenths: number): string {
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pair = (value: number) => String(value).padStart(2, '0');
  const clock = hours > 0
    ? `${hours}:${pair(minutes)}:${pair(seconds)}`
    : `${pair(minutes)}:${pair(seconds)}`;
  return `${clock}.${tenths}`;
}

export function formatMediaTimeTenths(milliseconds: number): string {
  const tenths = toTenths(milliseconds);
  return tenths === null ? '00:00.0' : formatTenths(tenths);
}

export function getMediaRangeDisplay(startMs: number | null, endMs: number | null): MediaRangeDisplay {
  const startTenths = startMs === null ? null : toTenths(startMs);
  const endTenths = endMs === null ? null : toTenths(endMs);
  return {
    start: startTenths === null ? EMPTY_TIME : formatTenths(startTenths),
    end: endTenths === null ? EMPTY_TIME : formatTenths(endTenths),
    length: startTenths === null || endTenths === null || endTenths <= startTenths
      ? EMPTY_TIME
      : formatTenths(endTenths - startTenths),
  };
}
