export function postToXIntentHref(pageUrl: string, text: string): string {
  const intent = new URL("https://twitter.com/intent/tweet");
  const lead = text.replace(/\s+/g, " ").trim().slice(0, 200);
  intent.searchParams.set("text", lead || "Annotated");
  if (/^https?:\/\//.test(pageUrl)) {
    intent.searchParams.set("url", pageUrl);
  }
  return intent.href;
}

export function PostToXButton({ pageUrl, text }: { pageUrl: string; text: string }) {
  return (
    <a className="public-button post-to-x" href={postToXIntentHref(pageUrl, text)} target="_blank" rel="noopener noreferrer">
      Post to X
    </a>
  );
}
