const DEFAULT_NEXT_PATH = "/";

export function getSafeNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_NEXT_PATH,
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const baseUrl = new URL("http://annotated.local");
    const resolvedUrl = new URL(value, baseUrl);

    if (resolvedUrl.origin !== baseUrl.origin) {
      return fallback;
    }

    return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
  } catch {
    return fallback;
  }
}
