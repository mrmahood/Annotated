import type { Metadata } from "next";
import { SiteHeader } from "../site-header";
import { WhoToFollowList } from "../who-to-follow-rail";
import { getCurrentUserId, getWhoToFollowSuggestions } from "@/lib/data/social";
import { WHO_TO_FOLLOW_PATH } from "@/lib/data/who-to-follow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Who to Follow | Annotated",
  description: "Curated Annotated accounts you may want to follow.",
};

export default async function WhoToFollowPage() {
  const currentUserId = await getCurrentUserId();
  const suggestions = await getWhoToFollowSuggestions(currentUserId);
  const returnTo = WHO_TO_FOLLOW_PATH;

  return (
    <>
      <SiteHeader active="who-to-follow" returnTo={returnTo} />
      <main id="main" className="discovery-main">
        <header className="discovery-intro">
          <p className="eyebrow">WHO TO FOLLOW</p>
          <h1>Accounts worth following.</h1>
          <p className="lede">
            A curated set of public Annotated profiles. Signed-out visitors
            still see suggestions; Follow asks you to continue with Google or X.
            Accounts you already follow are hidden.
          </p>
        </header>

        {suggestions.status === "unavailable" ? (
          <section className="discovery-state discovery-error" role="alert">
            <h2>Who to Follow is temporarily unavailable.</h2>
            <p>Please try again in a little while.</p>
          </section>
        ) : suggestions.suggestions.length === 0 ? (
          <section className="discovery-state">
            <h2>No suggestions right now.</h2>
            <p>
              Curated accounts appear here when those public profiles exist
              and you are not already following them.
            </p>
          </section>
        ) : (
          <section className="who-to-follow-page-list" aria-label="Suggested accounts">
            <WhoToFollowList
              suggestions={suggestions.suggestions}
              currentUserId={currentUserId}
              returnTo={returnTo}
            />
          </section>
        )}
      </main>
    </>
  );
}
