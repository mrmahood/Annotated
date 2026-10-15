import { PROD_WEB_APP_ORIGIN } from "./extension-install.ts";

export const SHARE_IMAGE_PATH = "/annotated-share.png";
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
export const SHARE_IMAGE_ALT = "Annotated. The fact-check layer for the web";

export const SITE_SHARE_IMAGE = {
  url: `${PROD_WEB_APP_ORIGIN}${SHARE_IMAGE_PATH}`,
  width: SHARE_IMAGE_WIDTH,
  height: SHARE_IMAGE_HEIGHT,
  alt: SHARE_IMAGE_ALT,
} as const;

function isXAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const onTwimg = host === "pbs.twimg.com" || host.endsWith(".twimg.com");
    return onTwimg && (
      url.pathname.includes("/profile_images/") ||
      url.pathname.includes("/profile_banners/")
    );
  } catch {
    return false;
  }
}

/**
 * Annotation pages may use an article image. An X profile photo is never the
 * share image; the site card is the fallback.
 */
export function shareImagesForAnnotation(articleImageUrl: string | null | undefined) {
  if (articleImageUrl && !isXAvatarUrl(articleImageUrl)) {
    try {
      const url = new URL(articleImageUrl);
      if (url.protocol === "https:" && !url.username && !url.password) {
        return [{ url: url.href }];
      }
    } catch {
      // Fall through to the site card.
    }
  }
  return [SITE_SHARE_IMAGE];
}
