"use client";

import { useState } from "react";
import { formatAudioDuration } from "@/lib/audio-commentary";

export function PublishedAudioPlayer({
  publicUrl,
  durationMs,
  compact = false,
}: {
  publicUrl: string;
  durationMs: number;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={compact ? "card-commentary-audio" : "audio-commentary-player"}>
      {!compact && (
        <span className="audio-commentary-duration">{formatAudioDuration(durationMs)}</span>
      )}
      <audio
        controls
        preload="metadata"
        src={publicUrl}
        aria-label="Published audio commentary"
        onError={() => setError("Audio commentary could not be played. Check your connection and try again.")}
      />
      {error && <p className={compact ? "card-commentary-audio-error" : "form-error"} role="alert">{error}</p>}
    </div>
  );
}
