import { WHO_TO_FOLLOW_PATH } from "./data/who-to-follow.ts";
import { LEGAL_OPERATOR, LEGAL_PATHS } from "./legal.ts";
import { getConfiguredSiteOrigin } from "./public-routes.ts";

export const FEED_PATH = "/";
export const TRENDING_PATH = "/trending";

export const FEED_LEDE =
  "Your media notations across video, podcasts & text shared with the world.";

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
  return INDEXABLE_PUBLIC_PATHS.flatMap((path) => {
    const url = absolutePublicUrl(path);
    return url ? [{ url }] : [];
  });
}

export function getLlmsTxt(): string {
  const url = (path: string) => absolutePublicUrl(path) ?? path;
  const operator =
    `Annotated is operated by ${LEGAL_OPERATOR.person} through ${LEGAL_OPERATOR.company}, ${LEGAL_OPERATOR.jurisdiction}.`;

  return `# Annotated

> Annotated is a public web application and Chrome side-panel extension for attributed annotations of selected article passages or selected audio or video ranges, with your own commentary.

Annotated preserves source attribution and original-source links. Selected hosted media ranges are between 1 and 90 seconds. Raw captured source media is not offered as a download. Annotated does not authorize DRM circumvention or paywall bypass.

Annotated is currently offered worldwide as a free beta. You must be at least 18 years old to use it. ${operator}

## Pages

- [Feed](${url(FEED_PATH)}): ${FEED_LEDE}
- [Trending](${url(TRENDING_PATH)}): ${TRENDING_HEADING} ${TRENDING_LEDE}
- [Who to Follow](${url(WHO_TO_FOLLOW_PATH)}): ${WHO_TO_FOLLOW_HEADING} A curated set of public Annotated profiles.
- [Legal](${url(LEGAL_PATHS.center)}): ${LEGAL_HEADING}. ${LEGAL_LEDE}
- [Privacy Policy](${url(LEGAL_PATHS.privacy)}): ${PRIVACY_LEDE}
- [Terms of Service](${url(LEGAL_PATHS.terms)}): ${TERMS_LEDE}

## Contact

- Email: ${LEGAL_OPERATOR.email}
- Mail: ${LEGAL_OPERATOR.person}, ${LEGAL_OPERATOR.company}, ${LEGAL_OPERATOR.street}, ${LEGAL_OPERATOR.locality}, ${LEGAL_OPERATOR.country}

## Optional

- [Sitemap](${url("/sitemap.xml")}): Machine-readable list of public site URLs.
`;
}
