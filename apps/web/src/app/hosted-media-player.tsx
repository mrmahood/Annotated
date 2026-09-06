"use client";

import { useState, type CSSProperties, type SyntheticEvent } from "react";
import { formatMediaTime } from "@annotated/shared/media-time";
import { hostedVideoPlayerLayout } from "@annotated/shared/hosted-video-layout";
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
  sourceType?: string | null;
};

function hostedVideoShellStyle(aspectRatio: string | null): CSSProperties | undefined {
  return aspectRatio
    ? { "--hosted-video-aspect": aspectRatio } as CSSProperties
    : undefined;
}

export function HostedMediaPlayer({
  annotationId,
  media,
  compact = false,
  sourceType = null,
}: HostedMediaPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const playbackPath = getMediaPlaybackPath(annotationId, attempt);
  const layout = hostedVideoPlayerLayout({
    mimeType: media.mimeType,
    width: media.width ?? measured?.width ?? null,
    height: media.height ?? measured?.height ?? null,
    sourceType,
  });
  const onError = () => {
    if (attempt === 0) setAttempt(1);
    else setUnavailable(true);
  };
  const onLoadedMetadata = (event: SyntheticEvent<HTMLMediaElement>) => {
    setUnavailable(false);
    const element = event.currentTarget;
    if (
      media.width == null &&
      media.height == null &&
      element instanceof HTMLVideoElement &&
      element.videoWidth > 0 &&
      element.videoHeight > 0
    ) {
      setMeasured({ width: element.videoWidth, height: element.videoHeight });
    }
  };
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
      <div
        className="card-hosted-media"
        data-orientation={layout.orientation}
        style={hostedVideoShellStyle(layout.aspectRatio)}
      >
        {player}
        {unavailableMessage}
      </div>
    );
  }

  return (
    <section
      className="hosted-media-section"
      aria-labelledby={headingId}
      data-orientation={layout.orientation}
      style={hostedVideoShellStyle(layout.aspectRatio)}
    >
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
