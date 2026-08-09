import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/public-content";
import { COMMENT_BODY_LIMIT, PUBLIC_COMMENT_STATUS } from "./social-query";

async function requireUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !isUuid(data.user.id)) {
    throw new Error("Authentication is required.");
  }
  return data.user.id;
}

export async function followProfile(
  supabase: SupabaseClient,
  followedId: string,
): Promise<void> {
  if (!isUuid(followedId)) throw new Error("That profile is unavailable.");
  const followerId = await requireUserId(supabase);
  if (followerId === followedId) throw new Error("You cannot follow yourself.");
  const { error } = await supabase.from("profile_follows").insert({
    follower_id: followerId,
    followed_id: followedId,
  });
  if (error) throw new Error("The profile could not be followed.");
}

export async function unfollowProfile(
  supabase: SupabaseClient,
  followedId: string,
): Promise<void> {
  if (!isUuid(followedId)) throw new Error("That profile is unavailable.");
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc("unfollow_profile", {
    p_followed_id: followedId,
  });
  if (error || data !== true) throw new Error("The profile could not be unfollowed.");
}

export async function createComment(
  supabase: SupabaseClient,
  annotationId: string,
  body: string,
): Promise<void> {
  if (!isUuid(annotationId)) throw new Error("That annotation is unavailable.");
  if (!body.trim()) throw new Error("Write a comment before posting.");
  if (body.length > COMMENT_BODY_LIMIT) {
    throw new Error("Comments cannot exceed 1,000 characters.");
  }
  const userId = await requireUserId(supabase);
  const { error } = await supabase.from("annotation_comments").insert({
    annotation_id: annotationId,
    user_id: userId,
    body,
    status: PUBLIC_COMMENT_STATUS,
  });
  if (error) throw new Error("The comment could not be posted.");
}

export async function deleteComment(
  supabase: SupabaseClient,
  commentId: string,
): Promise<void> {
  if (!isUuid(commentId)) throw new Error("That comment is unavailable.");
  const userId = await requireUserId(supabase);
  const { error, count } = await supabase
    .from("annotation_comments")
    .delete({ count: "exact" })
    .eq("id", commentId)
    .eq("user_id", userId);
  if (error || count !== 1) throw new Error("The comment could not be deleted.");
}
