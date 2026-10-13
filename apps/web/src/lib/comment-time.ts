export const COMMENT_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
  timeZone: "UTC",
};

const RELATIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function formatCommentTimestamp(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", COMMENT_TIMESTAMP_FORMAT).format(new Date(createdAt));
}

export function formatRelativeCommentAge(deltaMs: number): string {
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

/** Local clock time, or a relative label when the comment is under a day old. */
export function formatLocalCommentTimestamp(
  createdAt: string,
  now: number,
  timeZone: string,
): string {
  const created = new Date(createdAt).getTime();
  const delta = now - created;
  if (Number.isFinite(created) && Number.isFinite(delta) && delta >= 0 && delta < RELATIVE_WINDOW_MS) {
    return formatRelativeCommentAge(delta);
  }
  return new Intl.DateTimeFormat("en-US", {
    ...COMMENT_TIMESTAMP_FORMAT,
    timeZone,
  }).format(new Date(createdAt));
}

export function formatViewerCommentTimestamp(createdAt: string, now = Date.now()): string {
  return formatLocalCommentTimestamp(
    createdAt,
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}
