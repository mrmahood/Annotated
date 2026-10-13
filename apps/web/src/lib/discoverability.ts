import {
  claimReviewRatingEntries,
  CLAIM_REVIEW_BEST_RATING,
  CLAIM_REVIEW_WORST_RATING,
} from "./claim-review-jsonld.ts";
import { WHO_TO_FOLLOW_PATH } from "./data/who-to-follow.ts";
import { EXTENSION_DOWNLOAD_PATH } from "./extension-install.ts";
import { WHATS_NEW_HEADING, WHATS_NEW_LEDE, WHATS_NEW_PATH } from "./extension-release.ts";
import { LEGAL_OPERATOR, LEGAL_PATHS } from "./legal.ts";
import { getConfiguredSiteOrigin } from "./public-routes.ts";

export const FEED_PATH = "/";
export const TRENDING_PATH = "/trending";
export const DEMO_PATH = "/demo";
export const AGENTS_PATH = "/agents";
export const LLMS_TXT_PATH = "/llms.txt";
export const ANNOTATED_REPOSITORY_URL = "https://github.com/mrmahood/Annotated";

export const AGENTS_HEADING = "Agents";
export const AGENTS_LEDE =
  "How to read Annotated, the fact-check layer for the web: public URLs, verdicts, sources, consensus, and ClaimReview markup.";

export const PLANNED_API_AND_MCP =
  "An API and an MCP server are planned. No release date is set.";

export const CONSENSUS_GUIDE =
  "Consensus is the count of agree and disagree votes on the annotation, plus helpful ratings on the source links. It is reader reaction. It is not a second verdict.";

export const SOURCES_GUIDE =
  "Sources are the links the author attached to the note. A reader can mark a source helpful.";

export const FEED_LEDE = "The fact-check layer for the web.";

export const TRENDING_HEADING = "This week’s most active annotations.";
export const TRENDING_LEDE =
  "Ranked over the last 7 days from comments, unique commenters, follows on the author, reshares, and recency. One card per author. There is no view count in this ranking.";

export const WHO_TO_FOLLOW_HEADING = "Accounts worth following.";
export const WHO_TO_FOLLOW_LEDE =
  "A curated set of public Annotated profiles. Signed-out visitors still see suggestions; Follow asks you to continue with Google or X. Accounts you already follow are hidden.";

export const LEGAL_HEADING = "Policies for Annotated";
export const LEGAL_LEDE =
  "These policies apply to the Annotated public web application and the Chrome side-panel extension.";

export const PRIVACY_HEADING = "Privacy Policy";
export const PRIVACY_LEDE =
  "This policy explains what information Annotated collects, why we collect it, how it is used and shared, how long it is kept, and the choices and rights you have.";

export const TERMS_HEADING = "Terms of Service";
export const TERMS_LEDE =
  "These Terms are the agreement between you and the operator of Annotated. They explain what the service does, what you may and may not do with it, and how responsibility is allocated between us.";

export const INDEXABLE_PUBLIC_PATHS = [
  FEED_PATH,
  TRENDING_PATH,
  WHO_TO_FOLLOW_PATH,
  WHATS_NEW_PATH,
  AGENTS_PATH,
  LEGAL_PATHS.center,
  LEGAL_PATHS.privacy,
  LEGAL_PATHS.terms,
] as const;

export type IndexablePublicPath = (typeof INDEXABLE_PUBLIC_PATHS)[number];

const PRIVATE_ROBOTS_PREFIXES = ["/api/", "/auth/", "/me", "/ops"];

type JsonLd = Record<string, unknown>;

type PublicPageCopy = {
  name: string;
  description: string;
  includeOperator: boolean;
};

const PUBLIC_PAGE_COPY: Record<IndexablePublicPath, PublicPageCopy> = {
  [FEED_PATH]: {
    name: "Annotated",
    description: FEED_LEDE,
    includeOperator: false,
  },
  [TRENDING_PATH]: {
    name: TRENDING_HEADING,
    description: TRENDING_LEDE,
    includeOperator: false,
  },
  [WHO_TO_FOLLOW_PATH]: {
    name: WHO_TO_FOLLOW_HEADING,
    description: WHO_TO_FOLLOW_LEDE,
    includeOperator: false,
  },
  [WHATS_NEW_PATH]: {
    name: WHATS_NEW_HEADING,
    description: WHATS_NEW_LEDE,
    includeOperator: false,
  },
  [AGENTS_PATH]: {
    name: AGENTS_HEADING,
    description: AGENTS_LEDE,
    includeOperator: false,
  },
  [LEGAL_PATHS.center]: {
    name: LEGAL_HEADING,
    description: LEGAL_LEDE,
    includeOperator: true,
  },
  [LEGAL_PATHS.privacy]: {
    name: PRIVACY_HEADING,
    description: PRIVACY_LEDE,
    includeOperator: true,
  },
  [LEGAL_PATHS.terms]: {
    name: TERMS_HEADING,
    description: TERMS_LEDE,
    includeOperator: true,
  },
};

export function absolutePublicUrl(path: string): string | undefined {
  const origin = getConfiguredSiteOrigin();
  if (!origin) return undefined;
  return new URL(path, origin).href;
}

function publishedPostalAddress(): JsonLd {
  const locality = /^(.+), ([A-Z]{2}) (\d{5})$/.exec(LEGAL_OPERATOR.locality);
  return {
    "@type": "PostalAddress",
    streetAddress: LEGAL_OPERATOR.street,
    ...(locality
      ? {
          addressLocality: locality[1],
          addressRegion: locality[2],
          postalCode: locality[3],
        }
      : {}),
    addressCountry: LEGAL_OPERATOR.country,
  };
}

function organizationNode(includeAddress: boolean): JsonLd {
  return {
    "@type": "Organization",
    name: LEGAL_OPERATOR.company,
    email: LEGAL_OPERATOR.email,
    ...(includeAddress ? { address: publishedPostalAddress() } : {}),
  };
}

export function getPublicPageStructuredData(path: IndexablePublicPath): JsonLd | null {
  const origin = getConfiguredSiteOrigin();
  if (!origin) return null;

  const page = PUBLIC_PAGE_COPY[path];
  const siteUrl = new URL("/", origin).href;
  const website = {
    "@type": "WebSite",
    name: "Annotated",
    url: siteUrl,
  };
  const publisher = organizationNode(page.includeOperator);

  if (path === FEED_PATH) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          ...website,
          description: page.description,
          publisher,
        },
      ],
    };
  }

  const graph: JsonLd[] = [
    {
      "@type": "WebPage",
      name: page.name,
      description: page.description,
      url: new URL(path, origin).href,
      isPartOf: website,
      publisher,
    },
  ];

  if (page.includeOperator) {
    graph.push({
      "@type": "Person",
      name: LEGAL_OPERATOR.person,
      email: LEGAL_OPERATOR.email,
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export function getRobotsDocument(): {
  rules: { userAgent: string; allow: string; disallow: string[] };
  sitemap?: string;
} {
  const sitemap = absolutePublicUrl("/sitemap.xml");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_ROBOTS_PREFIXES,
    },
    ...(sitemap ? { sitemap } : {}),
  };
}

export function getSitemapEntries(): { url: string }[] {
  return [...INDEXABLE_PUBLIC_PATHS, LLMS_TXT_PATH].flatMap((path) => {
    const url = absolutePublicUrl(path);
    return url ? [{ url }] : [];
  });
}

function ratingScaleSentence(): string {
  const labels = claimReviewRatingEntries()
    .map((entry) => `${entry.alternateName} (${entry.ratingValue})`)
    .join(", ");
  return `Verdicts, from the claim holding least to most: ${labels}. True means the claim is accurate. worstRating is ${CLAIM_REVIEW_WORST_RATING} and bestRating is ${CLAIM_REVIEW_BEST_RATING}.`;
}

export function getLlmsTxt(): string {
  const url = (path: string) => absolutePublicUrl(path) ?? path;
  const operator =
    `Annotated is operated by ${LEGAL_OPERATOR.person} through ${LEGAL_OPERATOR.company}, ${LEGAL_OPERATOR.jurisdiction}.`;

  return `# Annotated

> ${FEED_LEDE}

Annotated is the fact-check layer for the web. It is a public web application and Chrome side-panel extension for an attributed annotation of a selected article passage or a selected audio or video range, with commentary. A fact-check names a verdict and links the sources it used.

Annotated preserves source attribution and original-source links. Selected hosted media ranges are between 1 and 90 seconds. Raw captured source media is not offered as a download. Annotated does not authorize DRM circumvention or paywall bypass.

Annotated is currently offered worldwide as a free beta. You must be at least 18 years old to use it. ${operator}

## Read a fact-check

- ${ratingScaleSentence()}
- ${SOURCES_GUIDE}
- ${CONSENSUS_GUIDE}
- A fact-check with a verdict and a quoted passage includes schema.org ClaimReview JSON-LD. claimReviewed is the quoted passage, trimmed. reviewRating.alternateName is the verdict label shown on the page. The author is a Person or an Organization, with the public profile URL. itemReviewed is a Claim whose appearance points at the source URL. citation is the source links. Other annotations use a Comment, or no structured data when a canonical URL is unavailable.

## URL patterns

- \`/{handle}/{slug}\` is a public annotation, including \`/factdesk/...\` and \`/matt-mahood-85fdb29c/...\`.
- \`/a/{uuid}\` is a historical annotation address. It redirects to the handle path when one exists.
- \`/p/{profileId}\` is a public profile.
- [Feed](${url(FEED_PATH)}), [Demo](${url(DEMO_PATH)}), [Agents](${url(AGENTS_PATH)}), and [llms.txt](${url(LLMS_TXT_PATH)}) are public. robots.txt allows them.

## Pages

- [Feed](${url(FEED_PATH)}): ${FEED_LEDE}
- [Demo](${url(DEMO_PATH)}): A sample article with fact-checks, verdicts, sources, and read-only consensus. No install and no sign-in.
- [Agents](${url(AGENTS_PATH)}): ${AGENTS_LEDE}
- [Trending](${url(TRENDING_PATH)}): ${TRENDING_HEADING} ${TRENDING_LEDE}
- [Who to Follow](${url(WHO_TO_FOLLOW_PATH)}): ${WHO_TO_FOLLOW_HEADING} A curated set of public Annotated profiles.
- [What's new](${url(WHATS_NEW_PATH)}): ${WHATS_NEW_HEADING}. ${WHATS_NEW_LEDE}
- [Extension download](${url(EXTENSION_DOWNLOAD_PATH)}): The Chrome side-panel extension as a zip. Load it unpacked. It is not on the Chrome Web Store yet.
- [GitHub](${ANNOTATED_REPOSITORY_URL}): The Annotated source repository.
- [Legal](${url(LEGAL_PATHS.center)}): ${LEGAL_HEADING}. ${LEGAL_LEDE}
- [Privacy Policy](${url(LEGAL_PATHS.privacy)}): ${PRIVACY_LEDE}
- [Terms of Service](${url(LEGAL_PATHS.terms)}): ${TERMS_LEDE}

## Planned

- ${PLANNED_API_AND_MCP}

## Contact

- Email: ${LEGAL_OPERATOR.email}
- Mail: ${LEGAL_OPERATOR.person}, ${LEGAL_OPERATOR.company}, ${LEGAL_OPERATOR.street}, ${LEGAL_OPERATOR.locality}, ${LEGAL_OPERATOR.country}

## Optional

- [Sitemap](${url("/sitemap.xml")}): Machine-readable list of public site URLs, including ${AGENTS_PATH} and ${LLMS_TXT_PATH}.
`;
}
