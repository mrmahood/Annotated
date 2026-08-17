# Product roadmap

Status: Phase B implementation and browser acceptance, 2026-08-16.

The hosted-media architecture is defined in
`docs/architecture/media-archive-pipeline.md`. This roadmap summarizes delivery
status; it does not replace the architecture or authorize deployment.

## Phase A — complete

Hosted-media persistence and security foundation:

- `annotation_media`, excerpt transcripts, private raw/final buckets, lifecycle
  constraints, and server/worker transition boundaries;
- authenticated hosted begin/cancel/status RPCs and publication guards;
- generated creator handles, aliases, annotation slugs, and historical read
  compatibility;
- new hosted ranges capped at 90 seconds while article publication remains
  immediate.

Phase A was squash-merged in PR #15.

## Phase B — current

Production capture and private raw upload:

- explicit 1-90 second selected range and required commentary;
- top-frame source/player validation and preparation;
- `chrome.tabCapture`, offscreen `MediaRecorder`, source-audio loopback, bounded
  capture metadata, and safe cleanup;
- server-derived exact private path, short-lived signed direct upload, object
  verification, retry, and cancellation;
- authoritative `processing/queued` confirmation before Processing UI;
- restart recovery that never claims an in-memory Blob survived;
- exact production permissions with no host permissions or persistent content
  scripts.

Phase B stops with a private draft and media in `processing/queued`. It requires
automated validation plus owner-performed Chrome acceptance before completion.
No worker, crop, transcode, transcription, or final publication belongs here.

## Phase C — future

Bounded media worker, likely a Cloud Run Job or equivalent:

- atomic lease/attempt handling and `ffprobe` validation;
- video geometry and crop validation;
- approximately 240p video or bounded audio derivative;
- checksums, size, stream, codec, and duration enforcement;
- transcription of only the captured excerpt and validated segments;
- raw deletion, retry/failure lifecycle, and final ready state.

## Phase D — future

Publication and product experience:

- publish only after media ready, raw deleted, and transcript present;
- canonical `/{creator-handle}/{annotation-slug}` route with UUID compatibility;
- hosted playback, transcript rendering, commentary, creator/source attribution,
  original link, claims/takedown, feed, and profile integration.

## Phase E — future

Hardening and bounty submission:

- browser, zoom/DPR/fullscreen/resize, and geometry test matrix;
- audio-crackle investigation and acceptance matrix;
- auth/session, retry, privacy, security, and end-to-end regression;
- Chrome Web Store packaging, onboarding, demo fixture, monitoring/runbooks, and
  polished bounty submission material.

Do not start Phase C until Phase B automated validation and owner-performed
browser acceptance both pass.
