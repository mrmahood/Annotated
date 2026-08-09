"use client";

import { useState } from "react";
import { formatAudioDuration } from "@/lib/audio-commentary";

export function PublishedAudioPlayer({
  publicUrl,
  durationMs,
}: {
  publicUrl: string;
  durationMs: number;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="audio-commentary-section" aria-labelledby="audio-commentary-heading">
      <p className="section-label">Supplemental commentary</p>
      <div className="audio-commentary-heading-row">
        <h2 id="audio-commentary-heading">Audio commentary</h2>
        <span>{formatAudioDuration(durationMs)}</span>
      </div>
      <audio
        controls
        preload="metadata"
        src={publicUrl}
        aria-label="Published audio commentary"
        onError={() => setError("Audio commentary could not be played. Check your connection and try again.")}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
