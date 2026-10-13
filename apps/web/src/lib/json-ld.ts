/** Serialize JSON-LD for a script tag. `<` is escaped so a passage cannot close the tag. */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
