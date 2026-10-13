export const X_POST_INTENT_ORIGIN = 'https://x.com/intent/post';
export const X_INTENT_TAKE_LIMIT = 240;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const LEADING_BLOCK_MARK = /^(?:\s*(?:#{1,6}|>)\s+)+/;

function stripIntentMarkup(value: string): string {
  const withoutShortcode = value.replace(/^\s*\|\*\s*/, '');
  const withoutBlocks = withoutShortcode
    .split('\n')
    .map((line) => line.replace(LEADING_BLOCK_MARK, ''))
    .join('\n');
  return withoutBlocks
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, ' $1 ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?;:]|$)/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|[.,!?;:]|$)/g, '$1$2')
    .replace(CONTROL_CHARACTERS, ' ');
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
