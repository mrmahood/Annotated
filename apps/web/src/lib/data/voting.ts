import { createServiceClient } from "@/lib/hosted-media-upload";
import { isUuid } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/server";
import {
  parseCurrentVote,
  parsePublicVoteTotals,
  parseVoteMutationResult,
  type VoteMutationResult,
  type VoteSnapshot,
  type VoteValue,
} from "@/lib/voting";

export async function getAnnotationVoteSnapshot(
  annotationId: string,
  currentUserId: string | null,
): Promise<VoteSnapshot | null> {
  if (!isUuid(annotationId) || (currentUserId !== null && !isUuid(currentUserId))) return null;
  try {
    const publicClient = await createClient();
    const { data: totalsData, error: totalsError } = await publicClient.rpc(
      "get_public_annotation_vote_totals",
      { p_annotation_ids: [annotationId] },
    );
    const totals = parsePublicVoteTotals(totalsData, annotationId);
    if (totalsError || !totals) return null;
    if (!currentUserId) return { ...totals, currentVote: null };

    const service = createServiceClient();
    const { data: currentData, error: currentError } = await service.rpc(
      "get_current_annotation_vote",
      { p_user_id: currentUserId, p_annotation_id: annotationId },
    );
    const currentVote = parseCurrentVote(currentData, annotationId);
    return currentError || currentVote === undefined
      ? null
      : { ...totals, currentVote };
  } catch {
    return null;
  }
}

export async function mutateAnnotationVote(
  userId: string,
  annotationId: string,
  value: VoteValue,
): Promise<VoteMutationResult | string> {
  if (!isUuid(userId) || !isUuid(annotationId)) return "INVALID_VOTE";
  const service = createServiceClient();
  const { data, error } = await service.rpc("mutate_annotation_vote", {
    p_user_id: userId,
    p_annotation_id: annotationId,
    p_value: value,
  });
  if (error) throw new Error("The trusted vote mutation failed.");
  const parsed = parseVoteMutationResult(data);
  if (parsed) return parsed;
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" && "result_code" in row &&
    typeof row.result_code === "string"
    ? row.result_code
    : "INVALID_RESULT";
}
