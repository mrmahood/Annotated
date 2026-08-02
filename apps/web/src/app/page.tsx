import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnnotationCard } from "./annotation-card";
import { PaginationNav } from "./pagination-nav";
import { SiteHeader } from "./site-header";
import { getPublicFeedPage } from "@/lib/data/public-discovery";
import {
  getPageHref,
  isCanonicalPageQuery,
  parsePageQuery,
} from "@/lib/public-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public annotation feed | Annotated",
  description: "Discover source-linked annotations published by Annotated readers.",
};

type HomePageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const { page: pageQuery } = await searchParams;
  const page = parsePageQuery(pageQuery);

  if (!isCanonicalPageQuery(pageQuery)) {
    redirect(getPageHref("/", page));
  }

  const feed = await getPublicFeedPage(page);
  const returnTo = getPageHref("/", page);

  return (
    <>
      <SiteHeader active="feed" returnTo={returnTo} />
      <main className="discovery-main">
        <header className="discovery-intro">
          <p className="eyebrow">PUBLIC ANNOTATIONS</p>
          <h1>Reading, connected to its sources.</h1>
          <p className="lede">
            Explore passages readers found worth keeping, alongside their commentary
            and the original work in context.
          </p>
        </header>

        {feed.status === "unavailable" ? (
          <section className="discovery-state discovery-error" role="alert">
            <h2>The public feed is temporarily unavailable.</h2>
            <p>Please try again in a little while.</p>
          </section>
        ) : feed.annotations.length === 0 ? (
          <section className="discovery-state">
            <h2>{page === 1 ? "No annotations have been published yet." : "There are no annotations on this page."}</h2>
            <p>{page === 1 ? "Published annotations will appear here." : "Use Previous to return to an earlier page."}</p>
          </section>
        ) : (
          <div className="annotation-list" aria-label="Published annotations">
            {feed.annotations.map((annotation) => (
              <AnnotationCard key={annotation.id} annotation={annotation} />
            ))}
          </div>
        )}

        {feed.status === "available" && (
          <PaginationNav basePath="/" page={page} hasNext={feed.hasNext} />
        )}
      </main>
    </>
  );
}
