import { buildXPostIntentUrl } from "@annotated/shared/x-intent";

export function PostToXButton({ pageUrl, text }: { pageUrl: string; text: string }) {
  const href = buildXPostIntentUrl({ take: text, permalink: pageUrl });
  if (!href) return null;

  return (
    <a className="public-button post-to-x" href={href} target="_blank" rel="noopener noreferrer">
      Post to X
    </a>
  );
}
