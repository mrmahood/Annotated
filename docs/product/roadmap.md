# Product roadmap

Status: Phase C planning, 2026-08-16.

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

## Phase B — complete

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

Phase B stops with a private draft and media in `processing/queued`. It was
squash-merged in PR #16 after automated validation and owner-performed Chrome
acceptance. The recorded automated results were pgTAP 204/204, shared 18/18,
extension 92/92, and web 28/28, with extension compile/build, web lint/build,
diff checks, and the generated production manifest also passing. Owner Chrome
acceptance covered video and audio-only capture/upload, authoritative queued
state, same-session retry, cancellation and raw cleanup, restart recovery,
source navigation and tab closure, audible source-audio loopback, and the
article-publication regression gate.

## Phase C — current (planning only)

Bounded media worker, likely a Cloud Run Job or equivalent:

- atomic lease/attempt handling and `ffprobe` validation;
- video geometry and crop validation;
- approximately 240p video or bounded audio derivative;
- checksums, size, stream, codec, and duration enforcement;
- transcription of only the captured excerpt and validated segments;
- raw deletion, retry/failure lifecycle, and final ready state;
- release-blocking audio-quality and crackle investigation for the worker output.

The detailed execution plan is
`docs/architecture/phase-c-media-worker-plan.md`. Planning is active; worker
implementation, vendor selection or setup, infrastructure creation, database
changes, and deployment each remain subject to explicit owner authorization.

## Phase D — future

Publication and product experience:

- publish only after media ready, raw deleted, and transcript present;
- canonical `/{creator-handle}/{annotation-slug}` route with UUID compatibility;
- hosted playback, transcript rendering, commentary, creator/source attribution,
  original link, claims/takedown, feed, and profile integration.

## Phase E — future

Hardening and bounty submission:

- browser, zoom/DPR/fullscreen/resize, and geometry test matrix;
- expanded browser/device audio compatibility regression matrix;
- auth/session, retry, privacy, security, and end-to-end regression;
- Chrome Web Store packaging, onboarding, demo fixture, monitoring/runbooks, and
  polished bounty submission material.

Phase B's automated and owner-performed browser acceptance gates have passed.
Do not begin Phase C implementation until the detailed plan and its unresolved
host, transcription, cost, privacy, and rollout decisions are explicitly
approved.
