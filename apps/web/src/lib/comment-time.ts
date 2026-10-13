export const COMMENT_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
  timeZone: "UTC",
};

export function formatCommentTimestamp(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", COMMENT_TIMESTAMP_FORMAT).format(new Date(createdAt));
}
