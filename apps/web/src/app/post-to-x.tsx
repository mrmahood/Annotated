import { headers } from "next/headers";
import { buildXPostIntentUrl } from "@annotated/shared/x-intent";

function headerValue(value: string | null): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function originFromRequestHeaders(headerList: { get(name: string): string | null }): string | undefined {
  const host = headerValue(headerList.get("x-forwarded-host")) || headerValue(headerList.get("host"));
  if (!host || /[\s/@\\]/.test(host)) return undefined;
  const forwardedProto = headerValue(headerList.get("x-forwarded-proto"));
  const proto = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      ? "http"
      : "https";
  return `${proto}://${host}`;
}

export async function PostToXButton({ pageUrl, text }: { pageUrl: string; text: string }) {
  let permalink = pageUrl;
  if (!/^https?:\/\//i.test(pageUrl)) {
    const origin = originFromRequestHeaders(await headers());
    if (origin) permalink = new URL(pageUrl, `${origin}/`).href;
  }
  const href = buildXPostIntentUrl({ take: text, permalink });
  if (!href) return null;

  return (
    <a className="public-button post-to-x" href={href} target="_blank" rel="noopener noreferrer">
      Post to X
    </a>
  );
}
