"use client";

import { useEffect, useState } from "react";
import {
  formatCommentTimestamp,
  formatViewerCommentTimestamp,
} from "@/lib/comment-time";

export function CommentTime({ dateTime }: { dateTime: string }) {
  const utcLabel = formatCommentTimestamp(dateTime);
  const [viewer, setViewer] = useState<{ dateTime: string; label: string } | null>(null);

  useEffect(() => {
    let current = true;
    const frame = requestAnimationFrame(() => {
      if (!current) return;
      setViewer({ dateTime, label: formatViewerCommentTimestamp(dateTime) });
    });
    return () => {
      current = false;
      cancelAnimationFrame(frame);
    };
  }, [dateTime]);

  const label = viewer?.dateTime === dateTime ? viewer.label : utcLabel;

  return <time dateTime={dateTime}>{label}</time>;
}
