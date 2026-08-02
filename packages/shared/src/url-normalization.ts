const ARTICLE_TRACKING_PARAMETERS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

export class ArticleUrlNormalizationError extends Error {
  constructor() {
    super('Article URLs must use HTTP or HTTPS.');
    this.name = 'ArticleUrlNormalizationError';
  }
}

export function normalizeArticleUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ArticleUrlNormalizationError();
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ArticleUrlNormalizationError();
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  for (const parameter of [...url.searchParams.keys()]) {
    if (ARTICLE_TRACKING_PARAMETERS.has(parameter.toLowerCase())) {
      url.searchParams.delete(parameter);
    }
  }

  url.searchParams.sort();

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.href;
}
