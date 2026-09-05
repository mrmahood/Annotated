"use client";

import { useState } from "react";
import { formatMediaTime } from "@annotated/shared/media-time";
import { getMediaPlaybackPath } from "@/lib/media-playback";

type HostedMediaPlayerProps = {
  annotationId: string;
  media: {
    mimeType: "video/mp4" | "audio/mp4";
    durationMs: number;
    width: number | null;
    height: number | null;
  };
  compact?: boolean;
};

export function HostedMediaPlayer({
  annotationId,
  media,
  compact = false,
}: HostedMediaPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const playbackPath = getMediaPlaybackPath(annotationId, attempt);
  const onError = () => {
    if (attempt === 0) setAttempt(1);
    else setUnavailable(true);
  };
  const onLoadedMetadata = () => setUnavailable(false);
  const headingId = `hosted-media-heading-${annotationId}`;
  const player = media.mimeType === "video/mp4" ? (
    <video
      key={playbackPath}
      controls
      controlsList="nodownload"
      disablePictureInPicture={false}
      preload="metadata"
      src={playbackPath}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      onError={onError}
      onLoadedMetadata={onLoadedMetadata}
      aria-label="Archived source video excerpt"
    >
      Your browser cannot play this video excerpt.
    </video>
  ) : (
    <audio
      key={playbackPath}
      controls
      controlsList="nodownload"
      preload="metadata"
      src={playbackPath}
      onError={onError}
      onLoadedMetadata={onLoadedMetadata}
      aria-label="Archived source audio excerpt"
    >
      Your browser cannot play this audio excerpt.
    </audio>
  );
  const unavailableMessage = unavailable && (
    <p className="form-error hosted-media-error" role="status">
      The archived excerpt is temporarily unavailable. The original source remains linked above.
    </p>
  );

  if (compact) {
    return (
      <div className="card-hosted-media">
        {player}
        {unavailableMessage}
      </div>
    );
  }

  return (
    <section className="hosted-media-section" aria-labelledby={headingId}>
      <div className="hosted-media-heading-row">
        <div>
          <p className="section-label">Archived excerpt</p>
          <h2 id={headingId}>
            {media.mimeType === "video/mp4" ? "Video excerpt" : "Audio excerpt"}
          </h2>
        </div>
        <span>{formatMediaTime(media.durationMs)}</span>
      </div>
      {player}
      {unavailableMessage}
    </section>
  );
}
