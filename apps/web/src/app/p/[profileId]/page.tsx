import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { AnnotationCard } from "../../annotation-card";
import { AppearanceControl } from "../../appearance-control";
import { FollowButton } from "../../follow-button";
import { PaginationNav } from "../../pagination-nav";
import { SiteHeader } from "../../site-header";
import {
  feedItemKey,
  getPublicAnnotationCount,
  getPublicProfile,
  getPublicProfileAnnotations,
} from "@/lib/data/public-discovery";
import {
  getCurrentUserFollowState,
  getCurrentUserId,
  getProfileSocialCounts,
} from "@/lib/data/social";
import {
  getInitial,
  getPageHref,
  isCanonicalPageQuery,
  isUuid,
  parsePageQuery,
} from "@/lib/public-content";

export const dynamic = "force-dynamic";
const loadPublicProfile = cache(getPublicProfile);

type ProfilePageProps = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { profileId } = await params;
  const profile = isUuid(profileId) ? await loadPublicProfile(profileId) : null;

  if (!profile) {
    return {
      title: "Profile not found | Annotated",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${profile.displayName} | Annotated`,
    description: `Published source-linked annotations from ${profile.displayName}.`,
  };
}

export default async function ProfilePage({ params, searchParams }: ProfilePageProps) {
  const [{ profileId }, { page: pageQuery }] = await Promise.all([params, searchParams]);
  if (!isUuid(profileId)) notFound();

  const basePath = `/p/${profileId}`;
  const page = parsePageQuery(pageQuery);
  if (!isCanonicalPageQuery(pageQuery)) redirect(getPageHref(basePath, page));

  const profile = await loadPublicProfile(profileId);
  if (!profile) notFound();

  const currentUserId = await getCurrentUserId();
  const [annotations, annotationCount, socialCounts, isFollowing] = await Promise.all([
    getPublicProfileAnnotations(profileId, page),
    getPublicAnnotationCount(profileId),
    getProfileSocialCounts(profileId),
    getCurrentUserFollowState(profileId, currentUserId),
  ]);
  const joinedDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(profile.createdAt));

  return (
    <>
      <SiteHeader returnTo={getPageHref(basePath, page)} />
      <main className="discovery-main profile-main">
        <Link className="back-link" href="/">← Back to public feed</Link>
        <header className="profile-header">
          {profile.avatarUrl ? (
            // External avatar hosts vary, and URLs are restricted to HTTP(S).
            // eslint-disable-next-line @next/next/no-img-element
            <img className="profile-avatar" src={profile.avatarUrl} alt="" width="104" height="104" referrerPolicy="no-referrer" />
          ) : (
            <span className="profile-avatar public-avatar-fallback" aria-hidden="true">
              {getInitial(profile.displayName)}
            </span>
          )}
          <div>
            <p className="eyebrow">CREATOR PROFILE</p>
            <h1>{profile.displayName}</h1>
            <div className="profile-facts">
              <p>Joined <time dateTime={profile.createdAt}>{joinedDate}</time></p>
              <p>
                {annotationCount === null
                  ? "Published annotation count unavailable"
                  : `${annotationCount.toLocaleString()} published ${annotationCount === 1 ? "annotation" : "annotations"}`}
              </p>
              <p>
                {socialCounts === null
                  ? "Following count unavailable"
                  : `${socialCounts.followingCount.toLocaleString()} following`}
              </p>
            </div>
            <FollowButton
              key={`${currentUserId ?? "signed-out"}:${String(isFollowing)}:${socialCounts?.followerCount ?? "unavailable"}`}
              profileId={profile.id}
              currentUserId={currentUserId}
              initialFollowing={isFollowing}
              initialFollowerCount={socialCounts?.followerCount ?? null}
              returnTo={getPageHref(basePath, page)}
            />
            {currentUserId === profile.id && <AppearanceControl />}
          </div>
        </header>

        <section className="profile-annotations" aria-labelledby="profile-annotations-heading">
          <h2 id="profile-annotations-heading">Published annotations</h2>
          {annotations.status === "unavailable" || annotationCount === null ? (
            <div className="discovery-state discovery-error" role="alert">
              <h3>Annotations are temporarily unavailable.</h3>
              <p>Please try again in a little while.</p>
            </div>
          ) : annotations.items.length === 0 ? (
            <div className="discovery-state">
              <h3>{page === 1 ? "No published annotations yet." : "There are no annotations on this page."}</h3>
              <p>{page === 1 ? "This creator’s published annotations will appear here." : "Use Previous to return to an earlier page."}</p>
            </div>
          ) : (
            <div className="annotation-list">
              {annotations.items.map((item) => (
                <AnnotationCard
                  key={feedItemKey(item)}
                  annotation={item.annotation}
                  reshare={item.reshare}
                  showCreator={item.reshare ? true : false}
                  currentUserId={currentUserId}
                  initialShared={item.viewerHasReshared}
                  initialBookmarked={item.viewerHasBookmarked}
                  returnTo={getPageHref(basePath, page)}
                />
              ))}
            </div>
          )}
        </section>

        {annotations.status === "available" && annotationCount !== null && (
          <PaginationNav basePath={basePath} page={page} hasNext={annotations.hasNext} />
        )}
      </main>
    </>
  );
}
