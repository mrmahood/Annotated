# Product roadmap

Status: Phase C execution, 2026-08-18. Increments C1-C5 are complete locally.
The C5 pinned image build, inspection, probes, and hardened one-media Local
container acceptance pass. C6 is the next separately authorized increment.

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

## Phase C — current

Bounded media worker, likely a Cloud Run Job or equivalent:

- atomic lease/attempt handling and `ffprobe` validation;
- video geometry and crop validation;
- approximately 240p video or bounded audio derivative;
- checksums, size, stream, codec, and duration enforcement;
- transcription of only the captured excerpt and validated segments;
- raw deletion, retry/failure lifecycle, and final ready state;
- release-blocking audio-quality and crackle investigation for the worker output.

The detailed execution plan is
`docs/architecture/phase-c-media-worker-plan.md`. C1 closed the worker-contract
and fixture audit; C2 delivered the deterministic local probe, geometry,
trim/crop/scale, output-validation, size, and checksum core. The focused C2
gate passes 22/22 tests and records bounded H.264/AAC video and AAC-LC audio
derivatives, including an exact 90,000 ms audio boundary.

C3 provides the exact-derivative audio capability, normalized transcript and
segment validation, and a deterministic fake with network denied. The first C4
slice now provides production capture-metadata v2 and the additive local worker
claim/retry/reconciliation contract. Capture-metadata v1 is readable but always
requires recapture before worker processing. The migration is applied to Local
only; schema lint and all 229 Local pgTAP tests pass. The actual private Local
Storage lifecycle and six-boundary crash matrix also pass all 10 tests without
early publication or leftover fixture objects. C4 owner Chrome acceptance also
passed for one YouTube video and one synthetic audio range: source audio
remained audible, both captures reached authoritative `processing/queued`, and
sanitized Local inspection accepted both v2 payloads. Disposable rows, objects,
user, processes, and temporary state were then removed, and the original
environment files were restored. C4 is closed and C5 is active. A
real transcription provider, package installation, infrastructure, remote
access, deployment, and Git delivery remain separately authorized.

C5 provides the dependency-free one-ID worker entrypoint, authenticated
bounded dispatcher, database-owned retry scheduling, expired-lease reconciler,
retention cleanup, allow-listed logs, and a pinned non-root container definition.
The focused C5 source gate passes 11/11 and its actual loopback-only Local
Supabase lifecycle passes 5/5. The owner-approved local image digest is
`sha256:b1fab7ac1ac48dc1609ad22915740a509806f6b7bed26f300b5df314ba7ea977`.
Its non-root tool probes and one authenticated worker run passed with a
read-only root, bounded `/tmp`, CPU, memory, and PIDs, no capabilities, and
no-new-privileges. The job reached `ready/published`; raw deletion, private
derivative access, transcript presence, sanitized logs, and exact cleanup all
passed. The image remains local and was neither pushed nor deployed. C5 is
closed.

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
C1-C4 are local-only and do not resolve the host, transcription-provider, cost,
remote privacy terms, or rollout gates.
