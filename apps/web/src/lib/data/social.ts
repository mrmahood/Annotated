import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/public-content";
import { parseCurrentBookmarkIds } from "./bookmark";
import { parseCurrentReshareIds } from "./reshare";
import {
  queryPublicCommentCounts,
  queryPublicComments,
  type PublicCommentPage,
} from "./social-query";
import {
  WHO_TO_FOLLOW_SEED_HANDLES,
  WHO_TO_FOLLOW_SEED_PROFILE_IDS,
  collectWhoToFollowProfiles,
  selectWhoToFollowSuggestions,
  uniqueWhoToFollowHandles,
  type WhoToFollowProfile,
} from "./who-to-follow";

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

export async function getCurrentUserProfileHandle(
  userId: string | null,
): Promise<string | null> {
  if (!userId || !isUuid(userId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    const username = typeof data?.username === "string" ? data.username.trim() : "";
    return error || !username ? null : username;
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

export type WhoToFollowPage =
  | { status: "available"; suggestions: WhoToFollowProfile[] }
  | { status: "unavailable" };

export async function getWhoToFollowSuggestions(
  currentUserId: string | null,
): Promise<WhoToFollowPage> {
  try {
    const supabase = await createClient();
    const seedHandles = uniqueWhoToFollowHandles(WHO_TO_FOLLOW_SEED_HANDLES);
    const seedIds = WHO_TO_FOLLOW_SEED_PROFILE_IDS.filter((id) => isUuid(id));
    const [handleResult, idResult] = await Promise.all([
      seedHandles.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("username", seedHandles),
      seedIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", seedIds),
    ]);
    if (handleResult.error || idResult.error) return { status: "unavailable" };

    const resolved = collectWhoToFollowProfiles({
      handleRows: handleResult.data ?? [],
      idRows: idResult.data ?? [],
      seedHandles,
      seedIds,
    });
    const followedIds = new Set<string>();
    if (currentUserId) {
      const states = await Promise.all(
        resolved.map(async (profile) => [
          profile.profileId,
          await getCurrentUserFollowState(profile.profileId, currentUserId),
        ] as const),
      );
      for (const [profileId, following] of states) {
        if (following === true) followedIds.add(profileId);
      }
    }

    return {
      status: "available",
      suggestions: selectWhoToFollowSuggestions(resolved, {
        viewerId: currentUserId,
        followedIds,
      }),
    };
  } catch {
    return { status: "unavailable" };
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

export async function getCurrentUserReshareState(
  annotationId: string,
  currentUserId: string | null,
): Promise<boolean> {
  if (!currentUserId || !isUuid(annotationId)) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_current_annotation_reshares", {
      p_annotation_ids: [annotationId],
    });
    return error ? false : parseCurrentReshareIds(data).has(annotationId);
  } catch {
    return false;
  }
}

export async function getCurrentUserBookmarkState(
  annotationId: string,
  currentUserId: string | null,
): Promise<boolean> {
  if (!currentUserId || !isUuid(annotationId)) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_current_annotation_bookmarks", {
      p_annotation_ids: [annotationId],
    });
    return error ? false : parseCurrentBookmarkIds(data).has(annotationId);
  } catch {
    return false;
  }
}
