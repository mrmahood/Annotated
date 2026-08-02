export class WebAppUrlConfigurationError extends Error {
  constructor() {
    super('WXT_WEB_APP_URL must be an HTTP or HTTPS origin.');
    this.name = 'WebAppUrlConfigurationError';
  }
}

export function getWebAppOrigin(): string {
  const value = import.meta.env.WXT_WEB_APP_URL;

  if (!value) {
    throw new WebAppUrlConfigurationError();
  }

  try {
    const url = new URL(value);
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
    const isOriginOnly =
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';

    if (!isHttp || !isOriginOnly) {
      throw new WebAppUrlConfigurationError();
    }

    return url.origin;
  } catch (error) {
    if (error instanceof WebAppUrlConfigurationError) {
      throw error;
    }

    throw new WebAppUrlConfigurationError();
  }
}
