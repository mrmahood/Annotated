import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AnnotationCard } from "../annotation-card";
import { PaginationNav } from "../pagination-nav";
import { ProviderSignInActions } from "../provider-sign-in-actions";
import { SiteHeader } from "../site-header";
import { LEGAL_PATHS } from "@/lib/legal";
import { feedItemKey, getCurrentUserBookmarksPage } from "@/lib/data/public-discovery";
import { getCurrentUserId } from "@/lib/data/social";
import {
  getPageHref,
  isCanonicalPageQuery,
  parsePageQuery,
} from "@/lib/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bookmarks | Annotated",
  description: "Private bookmarks of published annotations.",
  robots: { index: false, follow: false },
};

type MePageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

export default async function MePage({ searchParams }: MePageProps) {
  const { page: pageQuery } = await searchParams;
  const page = parsePageQuery(pageQuery);
  if (!isCanonicalPageQuery(pageQuery)) redirect(getPageHref("/me", page));

  const currentUserId = await getCurrentUserId();
  const returnTo = getPageHref("/me", page);
  const bookmarks = currentUserId
    ? await getCurrentUserBookmarksPage(page)
    : null;

  return (
    <>
      <SiteHeader active="me" returnTo={returnTo} />
      <main id="main" className="discovery-main">
        <header className="discovery-intro">
          <p className="eyebrow">ME</p>
          <h1>Bookmarks</h1>
          <p className="lede">
            A private, newest-first list of published annotations you saved.
            Only you can see these. There are no folders, notes, or public save counts.
          </p>
        </header>

        {!currentUserId ? (
          <section className="discovery-state" aria-labelledby="me-sign-in-heading">
            <h2 id="me-sign-in-heading">Sign in to see your bookmarks.</h2>
            <p>Use Google or X to save published annotations privately.</p>
            <ProviderSignInActions
              returnTo={returnTo}
              googleLabel="Sign in with Google"
              xLabel="Continue with X"
              className="public-button public-button-primary"
            />
            <p className="legal-sign-in-note">
              By continuing you agree to the{" "}
              <Link href={LEGAL_PATHS.terms}>Terms of Service</Link> and{" "}
              <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>.
            </p>
          </section>
        ) : !bookmarks || bookmarks.status === "unavailable" ? (
          <section className="discovery-state discovery-error" role="alert">
            <h2>Bookmarks are temporarily unavailable.</h2>
            <p>Please try again in a little while.</p>
          </section>
        ) : bookmarks.items.length === 0 ? (
          <section className="discovery-state">
            <h2>{page === 1 ? "No bookmarks yet." : "There are no bookmarks on this page."}</h2>
            <p>
              {page === 1
                ? "Bookmark a published annotation from the feed or its detail page."
                : "Use Previous to return to an earlier page."}
            </p>
          </section>
        ) : (
          <div className="annotation-list" aria-label="Your bookmarks">
            {bookmarks.items.map((item) => (
              <AnnotationCard
                key={feedItemKey(item)}
                annotation={item.annotation}
                currentUserId={currentUserId}
                initialShared={item.viewerHasReshared}
                initialBookmarked={item.viewerHasBookmarked}
                returnTo={returnTo}
              />
            ))}
          </div>
        )}

        {currentUserId && bookmarks?.status === "available" && (
          <PaginationNav basePath="/me" page={page} hasNext={bookmarks.hasNext} />
        )}
      </main>
    </>
  );
}
