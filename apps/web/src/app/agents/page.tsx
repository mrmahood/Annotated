import type { Metadata } from "next";
import Link from "next/link";
import {
  claimReviewRatingEntries,
  CLAIM_REVIEW_BEST_RATING,
  CLAIM_REVIEW_WORST_RATING,
} from "@/lib/claim-review-jsonld";
import {
  AGENTS_HEADING,
  AGENTS_LEDE,
  AGENTS_PATH,
  ANNOTATED_REPOSITORY_URL,
  CONSENSUS_GUIDE,
  DEMO_PATH,
  FEED_LEDE,
  FEED_PATH,
  getPublicPageStructuredData,
  LLMS_TXT_PATH,
  PLANNED_API_AND_MCP,
  SOURCES_GUIDE,
  TRENDING_PATH,
} from "@/lib/discoverability";
import { EXTENSION_DOWNLOAD_PATH } from "@/lib/extension-install";
import { WHATS_NEW_PATH } from "@/lib/extension-release";
import { LEGAL_PATHS } from "@/lib/legal";
import { WHO_TO_FOLLOW_PATH } from "@/lib/data/who-to-follow";
import { JsonLd } from "../json-ld";
import { SiteHeader } from "../site-header";

export const metadata: Metadata = {
  title: "Agents | Annotated",
  description: AGENTS_LEDE,
  alternates: { canonical: AGENTS_PATH },
};

const RATINGS = claimReviewRatingEntries();

export default function AgentsPage() {
  return (
    <>
      <JsonLd data={getPublicPageStructuredData(AGENTS_PATH)} />
      <a className="skip-link" href="#agents-content">Skip to main content</a>
      <SiteHeader returnTo={AGENTS_PATH} />
      <main className="legal-main" id="agents-content">
        <header className="legal-intro">
          <p className="eyebrow">FOR AGENTS</p>
          <h1>{AGENTS_HEADING}</h1>
          <p className="lede">{AGENTS_LEDE}</p>
        </header>

        <div className="legal-body">
          <section className="legal-section" aria-labelledby="agents-what">
            <h2 id="agents-what">What Annotated is</h2>
            <p>
              Annotated is the fact-check layer for the web. {FEED_LEDE} It is a
              public web application and a Chrome side-panel extension. A note
              is an attributed annotation of a selected article passage, or of
              a selected audio or video range, with commentary.
            </p>
            <p>
              A fact-check names a verdict and links the sources it used.
              Receipts, context, a steelman, and a hot take are other note
              types. They are not fact-checks.
            </p>
          </section>

          <section className="legal-section" aria-labelledby="agents-urls">
            <h2 id="agents-urls">Public URL patterns</h2>
            <ul>
              <li>
                <Link href={FEED_PATH}>Feed</Link> at <code>/</code> lists published annotations.
              </li>
              <li>
                <code>{"/{handle}/{slug}"}</code> is a public annotation.{" "}
                <a href="https://annotated.cbandcoop.com/factdesk/the-island-where-locals-say-data-centres-are-taking-their-water-99ceece3">
                  /factdesk/the-island-where-locals-say-data-centres-are-taking-their-water-99ceece3
                </a>{" "}
                and{" "}
                <a href="https://annotated.cbandcoop.com/matt-mahood-85fdb29c/the-island-where-locals-say-data-centres-are-taking-their-water-f4ea2383">
                  /matt-mahood-85fdb29c/the-island-where-locals-say-data-centres-are-taking-their-water-f4ea2383
                </a>{" "}
                are that pattern.
              </li>
              <li>
                <code>/a/{"{uuid}"}</code> is a historical annotation address. It
                redirects to the handle path when one exists.
              </li>
              <li>
                <code>/p/{"{profileId}"}</code> is a public profile.
              </li>
              <li>
                <Link href={DEMO_PATH}>Demo</Link>,{" "}
                <Link href={TRENDING_PATH}>Trending</Link>,{" "}
                <Link href={WHO_TO_FOLLOW_PATH}>Who to Follow</Link>,{" "}
                <Link href={WHATS_NEW_PATH}>{"What's new"}</Link>,{" "}
                <Link href={LEGAL_PATHS.center}>Legal</Link>,{" "}
                <Link href={LEGAL_PATHS.privacy}>Privacy</Link>, and{" "}
                <Link href={LEGAL_PATHS.terms}>Terms</Link> are public pages.
              </li>
              <li>
                <Link href={LLMS_TXT_PATH}>/llms.txt</Link> is the short reading
                file for this site. This page is <Link href={AGENTS_PATH}>/agents</Link>.
                Both are listed in the sitemap. robots.txt allows them.
              </li>
            </ul>
          </section>

          <section className="legal-section" aria-labelledby="agents-read">
            <h2 id="agents-read">How to read a fact-check</h2>
            <p>
              The quoted passage is the claim. The verdict is the author&apos;s
              assessment of that claim. The label on the page is the label in
              the structured data.
            </p>
            <ul>
              {RATINGS.map((rating) => (
                <li key={rating.verdict}>
                  <strong>{rating.alternateName}</strong> is {rating.ratingValue}. {rating.meaning}
                </li>
              ))}
            </ul>
            <p>
              worstRating is {CLAIM_REVIEW_WORST_RATING} and bestRating is {CLAIM_REVIEW_BEST_RATING}.
              A higher number means the claim holds more completely. The number
              is not a score of the annotation. True means the claim is accurate.
            </p>
            <p>{SOURCES_GUIDE}</p>
            <p>{CONSENSUS_GUIDE}</p>
          </section>

          <section className="legal-section" aria-labelledby="agents-jsonld">
            <h2 id="agents-jsonld">ClaimReview JSON-LD</h2>
            <p>
              A fact-check that has a verdict and a quoted passage includes one
              schema.org ClaimReview document in a <code>application/ld+json</code> script.
              claimReviewed is the quoted passage, shortened to about 75
              characters on a word boundary with an ellipsis. The full quote
              stays in the passage on the page.
              url is the canonical annotation URL. datePublished is when the
              annotation was published. The author is a Person, or an
              Organization when the profile name names a desk, newsroom,
              foundation, institute, association, collective, news outlet,
              media, press, or project. The author URL is the public profile.
            </p>
            <p>
              itemReviewed is a Claim. Its appearance is a CreativeWork for the
              source URL, with headline and publisher when those are known.
              reviewRating is a Rating. alternateName is the verdict label.
              ratingValue uses the scale above. citation is the source links.
            </p>
            <p>
              Any other annotation uses a Comment, which is a CreativeWork.
              When the site origin is not configured, or the note has neither
              a passage nor commentary, the page includes no structured data.
            </p>
          </section>

          <section className="legal-section" aria-labelledby="agents-more">
            <h2 id="agents-more">Feed, demo, extension, and source</h2>
            <ul>
              <li>
                The <Link href={FEED_PATH}>feed</Link> is the public list of published annotations.
              </li>
              <li>
                The <Link href={DEMO_PATH}>demo</Link> opens fact-checks on a sample article with no install and no sign-in.
              </li>
              <li>
                The extension is a Chrome side panel.{" "}
                <a href={EXTENSION_DOWNLOAD_PATH} download="extension.zip">Download the zip</a>{" "}
                and load it unpacked. It is not on the Chrome Web Store yet.{" "}
                <Link href={WHATS_NEW_PATH}>{"What's new"}</Link> describes the current package.
              </li>
              <li>
                The source repository is{" "}
                <a href={ANNOTATED_REPOSITORY_URL}>{ANNOTATED_REPOSITORY_URL}</a>.
              </li>
            </ul>
            <p>{PLANNED_API_AND_MCP}</p>
          </section>
        </div>
      </main>
    </>
  );
}
