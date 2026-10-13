export const X_POST_INTENT_ORIGIN = 'https://x.com/intent/post';
export const X_INTENT_TAKE_LIMIT = 240;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const MARKDOWN_MARKS = /[*_~`>#|[\]!]+/g;

function stripIntentMarkup(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, ' ')
    .replaceAll('|*', ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, ' $1 ')
    .replace(MARKDOWN_MARKS, ' ');
}

function collapseTake(value: string): string {
  return stripIntentMarkup(value).replace(/\s+/g, ' ').trim().slice(0, X_INTENT_TAKE_LIMIT).trim();
}

export function buildXPostIntentUrl(input: {
  take: string;
  permalink: string;
}): string | null {
  let permalink: URL;
  try {
    permalink = new URL(input.permalink.trim());
  } catch {
    return null;
  }
  if (permalink.protocol !== 'http:' && permalink.protocol !== 'https:') return null;
  if (permalink.username || permalink.password) return null;

  const intent = new URL(X_POST_INTENT_ORIGIN);
  const take = collapseTake(input.take ?? '');
  if (take) intent.searchParams.set('text', take);
  intent.searchParams.set('url', permalink.href);
  return intent.href;
}
