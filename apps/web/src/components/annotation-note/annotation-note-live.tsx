"use client";

import { useEffect, useState } from "react";
import {
  helpfulSourceCount,
  parseHelpfulRatingResult,
  type AnnotationConsensusSource,
  type AnnotationNoteType,
  type AnnotationVerdict,
} from "@annotated/shared/annotation-note";
import { createClient } from "@/lib/supabase/client";
import { AnnotationTypeLabel } from "./annotation-type-label";
import { ConsensusMeter } from "./consensus-meter";
import { SourceLinks } from "./source-links";
import { VerdictPill } from "./verdict-pill";

type VoteDetail = {
  annotationId?: string;
  upvoteCount?: number;
  downvoteCount?: number;
};

export function AnnotationNoteLive({
  annotationId,
  creatorId,
  currentUserId,
  noteType,
  verdict,
  agreeCount,
  disagreeCount,
  countsAvailable,
  sources,
}: {
  annotationId: string;
  creatorId: string;
  currentUserId: string | null;
  noteType: AnnotationNoteType | null;
  verdict: AnnotationVerdict | null;
  agreeCount: number;
  disagreeCount: number;
  countsAvailable: boolean;
  sources: AnnotationConsensusSource[];
}) {
  const [counts, setCounts] = useState({ agreeCount, disagreeCount });
  const [sourceRows, setSourceRows] = useState(sources);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canRate = Boolean(currentUserId) && currentUserId !== creatorId;

  useEffect(() => {
    const onVote = (event: Event) => {
      const detail = (event as CustomEvent<VoteDetail>).detail;
      if (
        detail?.annotationId !== annotationId ||
        typeof detail.upvoteCount !== "number" ||
        typeof detail.downvoteCount !== "number"
      ) return;
      setCounts({ agreeCount: detail.upvoteCount, disagreeCount: detail.downvoteCount });
    };
    window.addEventListener("annotated-annotation-vote", onVote);
    return () => window.removeEventListener("annotated-annotation-vote", onVote);
  }, [annotationId]);

  const toggleHelpful = async (sourceId: string) => {
    if (!canRate || pendingSourceId) return;
    setPendingSourceId(sourceId);
    setMessage(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("rate_annotation_source_helpful", {
        p_source_id: sourceId,
      });
      const result = error ? null : parseHelpfulRatingResult(data);
      if (!result) {
        setMessage("That helpful rating was not saved.");
      } else if (result.resultCode === "RATE_LIMITED") {
        setMessage(result.retryAfterSeconds
          ? `Too many ratings. Try again in ${result.retryAfterSeconds} seconds.`
          : "Too many ratings. Try again later.");
      } else if (result.resultCode === "SELF_RATE_FORBIDDEN") {
        setMessage("Creators cannot rate their own sources.");
      } else if (result.resultCode === "AUTH_REQUIRED") {
        setMessage("Sign in to mark a source helpful.");
      } else if (result.resultCode === "SOURCE_UNAVAILABLE") {
        setMessage("That source is not available.");
      } else {
        setSourceRows((current) => current.map((source) => source.id === sourceId
          ? { ...source, helpfulCount: result.helpfulCount, viewerMarkedHelpful: result.viewerMarkedHelpful }
          : source));
        setMessage(result.viewerMarkedHelpful ? "Marked helpful." : "Helpful rating removed.");
      }
    } catch {
      setMessage("That helpful rating was not saved.");
    } finally {
      setPendingSourceId(null);
    }
  };

  if (!noteType && !verdict && sourceRows.length === 0 && !countsAvailable) return null;

  return (
    <div className="note-block">
      {(noteType || verdict) && (
        <p className="note-pills">
          {noteType && <AnnotationTypeLabel noteType={noteType} />}
          {verdict && <VerdictPill verdict={verdict} />}
        </p>
      )}
      <SourceLinks
        sources={sourceRows}
        onToggleHelpful={canRate ? (sourceId) => void toggleHelpful(sourceId) : undefined}
        pendingSourceId={pendingSourceId}
      />
      {!canRate && sourceRows.length > 0 && (
        <p className="note-source-help">
          {currentUserId ? "Creators cannot rate their own sources." : "Sign in to mark a source helpful."}
        </p>
      )}
      <ConsensusMeter
        agreeCount={counts.agreeCount}
        disagreeCount={counts.disagreeCount}
        helpfulSourceCount={helpfulSourceCount(sourceRows)}
        countsAvailable={countsAvailable}
      />
      {message && <p className="note-source-message" role="status">{message}</p>}
    </div>
  );
}
