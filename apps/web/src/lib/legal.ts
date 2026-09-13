export const LEGAL_EFFECTIVE_DATE = "August 30, 2026";
export const LEGAL_LAST_UPDATED = "August 30, 2026";
export const LEGAL_CONTACT_EMAIL = "matt@cbandcoop.com";
export const LEGAL_OPERATOR_STATEMENT =
  "Annotated is operated by Matt Mahood through The CB & Cooper Limited Liability Company, a South Carolina limited liability company.";

export const LEGAL_PATHS = {
  index: "/legal",
  privacy: "/privacy",
  terms: "/terms",
} as const;

export type LegalPath = (typeof LEGAL_PATHS)[keyof typeof LEGAL_PATHS];

export function getConfiguredLegalPageUrl(path: LegalPath): string | undefined {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configuredSiteUrl) return undefined;

  try {
    const siteUrl = new URL(configuredSiteUrl);
    const isLocalHttp =
      siteUrl.protocol === "http:" &&
      (siteUrl.hostname === "localhost" || siteUrl.hostname === "127.0.0.1");

    if (
      (siteUrl.protocol !== "https:" && !isLocalHttp) ||
      siteUrl.pathname !== "/" ||
      siteUrl.search ||
      siteUrl.hash ||
      siteUrl.username ||
      siteUrl.password
    ) {
      return undefined;
    }

    return new URL(path, siteUrl.origin).href;
  } catch {
    return undefined;
  }
}
