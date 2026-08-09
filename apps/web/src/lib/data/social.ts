import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/public-content";
import {
  queryPublicCommentCounts,
  queryPublicComments,
  type PublicCommentPage,
} from "./social-query";

export type ProfileSocialCounts = {
  followerCount: number;
  followingCount: number;
};

function getCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    return error || !data.user || !isUuid(data.user.id) ? null : data.user.id;
  } catch {
    return null;
  }
}

export async function getProfileSocialCounts(
  profileId: string,
): Promise<ProfileSocialCounts | null> {
  if (!isUuid(profileId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("get_profile_social_counts", { p_profile_id: profileId })
      .maybeSingle();
    const row = typeof data === "object" && data !== null
      ? data as Record<string, unknown>
      : null;
    const followerCount = getCount(row?.follower_count);
    const followingCount = getCount(row?.following_count);
    return error || followerCount === null || followingCount === null
      ? null
      : { followerCount, followingCount };
  } catch {
    return null;
  }
}

export async function getCurrentUserFollowState(
  followedId: string,
  currentUserId: string | null,
): Promise<boolean | null> {
  if (!currentUserId) return false;
  if (!isUuid(followedId) || currentUserId === followedId) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("is_following_profile", {
      p_followed_id: followedId,
    });
    return error || typeof data !== "boolean" ? null : data;
  } catch {
    return null;
  }
}

export async function getPublicAnnotationComments(
  annotationId: string,
): Promise<{ status: "available"; page: PublicCommentPage } | { status: "unavailable" }> {
  try {
    const supabase = await createClient();
    return {
      status: "available",
      page: await queryPublicComments(supabase, annotationId),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getPublicCommentCounts(
  annotationIds: string[],
): Promise<Map<string, number> | null> {
  try {
    const supabase = await createClient();
    return await queryPublicCommentCounts(supabase, annotationIds);
  } catch {
    return null;
  }
}
