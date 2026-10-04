# Phase C media worker plan

Status: complete and merged, 2026-08-24. Phase C increments C1-C6, the bounded
C6 Staging gates, and owner acceptance are complete. The exact-duration and
retention corrections passed their Local and exact paused-schedule Staging
regressions. Staging history is aligned through `20260824020000`, all jobs use
immutable digest
`sha256:220c2a4e23fda65395d712ed2c81154e478ea6d0c271ce6d756ec36eb0c7fe92`,
and every disposable fixture was removed. PR #18 was squash-merged into
protected `main` as `7a6bb9042cb8295575f0c8b89b9128d499c20652`; its required validation and
the post-merge `main` CI run passed. Production was not accessed or deployed,
both schedules remain paused, and Phase D is the next active phase.

This plan narrows Phase C of `docs/architecture/media-archive-pipeline.md` into
reviewable engineering and acceptance gates. The accepted architecture remains
authoritative if this plan is ambiguous.

## 1. Outcome and phase boundary

Phase C delivers the path that turns one authoritative private
`processing/queued` media row into one bounded processed derivative, deletes
and confirms deletion of the raw object, then marks the media `ready` and the
annotation `published`. The excerpt transcript is produced from that derivative
and attached when it is ready. It does not gate publication.

Phase C includes:

- a bounded TypeScript media-worker workspace with pinned FFmpeg/ffprobe;
- atomic lease acquisition and attempt limits;
- raw-object download, hashing, probing, and validation;
- video geometry validation, crop, trim, and low-resolution encoding;
- bounded audio trim and encoding;
- transcription of audio derived from the exact processed excerpt;
- transcript and segment validation;
- deterministic processed-object upload and metadata staging;
- raw-object deletion confirmation before publication;
- retry, terminal failure, expired-lease, and abandoned-object reconciliation;
- container packaging, dispatch/reconciliation design, automated tests, and
  sequential owner acceptance;
- the release-blocking audio-quality investigation defined by the accepted
  architecture.

Phase C does not include:

- canonical creator/slug routes, public player pages, or feed/profile changes;
- signed public playback delivery or transcript presentation;
- claim moderation UI or the complete removal lifecycle;
- changes to the extension capture architecture or Blob ownership;
- full-source download or transcription;
- DRM, paywall, authentication, or source-media URL bypass;
- a general-purpose job platform or multiple derivative formats;
- production rollout, unless separately authorized after staging acceptance.

Article annotations must continue to publish immediately through their existing
validated RPC throughout Phase C.

## 2. Delivered prerequisites

Phases A and B already provide:

- private `annotation-media-raw` and `annotation-media` buckets;
- draft-first `annotation_media` and `annotation_transcripts` records;
- the 1,000-90,000 ms hosted-range boundary and historical read compatibility;
- server-derived raw paths and short-lived, no-upsert direct upload;
- verified transition to authoritative `processing/queued`;
- client denial for direct worker/media/transcript mutations;
- service-only worker RPCs and publication guards;
- offscreen-owned video/audio capture and direct upload;
- safe capture metadata, cancellation, retry, and restart reconciliation.

The current service-only worker database contract is:

| Operation | Existing function | Required use |
| --- | --- | --- |
| Claim | `private.claim_annotation_media_processing` | Acquire a random lease, increment the bounded attempt count, and return only the allocated job data. |
| Stage derivative | `private.stage_annotation_media_derivative` | Validate the lease, deterministic final path, checksums, MIME, dimensions, duration, and size. |
| Stage transcript | `private.stage_annotation_media_transcript` | Store excerpt-only text and bounded relative segments under the same lease. |
| Mark failure | `private.mark_annotation_media_processing_failed` | Persist only sanitized stage and error identifiers. |
| Retry | `private.retry_annotation_media_processing` | Return an eligible failed row to `processing/queued`. |
| Confirm raw deletion | `private.confirm_annotation_media_raw_deleted` | Clear the raw path after the derivative exists. A transcript is not required. |
| Publish playable excerpt | `private.publish_annotation_media_playable` | Set media ready and publish the annotation once raw deletion is confirmed. Keep the lease for transcription. |
| Finalize | `private.finalize_annotation_media_ready` | Clear the lease after the excerpt transcript is staged. Publication has already happened. |

The worker must not write domain tables directly when an existing RPC owns the
transition. It may use trusted Storage operations and the narrowly scoped
service-only contract. No worker credential, secret key, signed URL,
transcription secret, or provider response may enter extension code or public
output.

## 3. Decisions required before implementation

Each decision is an explicit gate. Planning can compare options, but setup or
spend requires separate owner approval.

### 3.1 Worker host

Recommendation: one Cloud Run Job execution per media UUID, with one item per
task, a 10-minute task timeout, two platform retries, bounded CPU/memory/disk,
and a dedicated runtime identity. An equivalent bounded container host is
acceptable if it supplies the same timeout, identity, secret, retry, and log
controls.

Approval must identify the cloud account/project, region, billing owner,
container registry, runtime identity, secret manager, estimated cost ceiling,
and who can deploy or invoke the job. No account or infrastructure should be
created merely to complete planning.

### 3.2 Dispatcher and reconciler

The dispatcher must accept only a media UUID and start one bounded worker task.
The reconciler must periodically find queued rows, eligible retry rows, expired
leases, and retention cleanup work so a lost notification cannot strand media.

The implementation decision must select the trusted scheduler/invocation
surface and document authentication, duplicate dispatch behavior, maximum
concurrency, rate limits, and failure alerts. FFmpeg must never run in a Next.js
request or Supabase Edge Function.

### 3.3 Transcription provider

Select a provider only after a recorded comparison of:

- 90-second latency and cost for expected video/audio volume;
- segment timestamp quality and supported languages;
- retention, training, deletion, data residency, and subprocessors;
- timeout, retry, rate-limit, and idempotency behavior;
- contractual handling of excerpt audio and transcript data.

The code boundary will be a small `Transcriber` interface. Tests and the first
local vertical slice use a deterministic fake adapter. A real provider adapter,
credentials, network calls, and spend are separately authorized.

### 3.4 FFmpeg build and output profile

The selected container must pin supported Node.js and FFmpeg/ffprobe versions,
package versions and lockfile, and the final image digest. Record the media
build's source, license review, and supported codecs. Representative tests must
approve H.264/AAC MP4 for video and AAC-LC M4A for audio before these profiles
are frozen. WebM remains a considered fallback, not an automatic change to the
accepted output contract.

### 3.5 Supabase and secret boundary

Before implementation, re-check the current Supabase changelog and official
Storage/database client documentation for relevant breaking changes. Confirm
the exact staging project ref `nkkunkwirvfwhmpwonqz` before any remote action.

The worker runtime receives only server-side configuration through the selected
secret manager. Logs must use annotation/media IDs, stages, timings, byte sizes,
exit codes, and stable failure codes; they must omit credentials, signed URLs,
source URLs when unnecessary, transcript text, and provider payloads.

## 4. Contract audit before worker code

The first implementation task, once authorized, is a local read-only audit of
the delivered migration and Phase B upload contract. It must resolve these
questions before changing schema or creating the worker:

1. Lease duration: use a task timeout of 600 seconds and a longer database lease
   (initial recommendation: 900 seconds) so platform shutdown precedes lease
   expiry. Confirm whether lease renewal is unnecessary under that bound.
2. Automatic retry: verify how retryable attempt failures receive bounded
   backoff without immediately becoming terminal `failed`. The current
   service-only functions may need a narrow additive refinement; do not assume a
   migration is required until the gap is reproduced in tests.
3. Duplicate dispatch: prove that two executions for the same media UUID cannot
   both hold a valid lease or publish competing results.
4. Staged retry: prove a row with a valid deterministic derivative can resume at
   transcription without downloading or transcoding raw input again.
5. Crash boundaries: define recovery after processed upload, derivative staging,
   transcript staging, raw deletion, raw-deletion confirmation, and finalization.
6. Object reconciliation: define handling for missing raw objects, orphaned raw
   objects, orphaned processed objects, checksum mismatches, and expired rows.
7. Retention: assign responsibility for 24-hour abandoned/terminal cleanup and
   the 72-hour processing ceiling without weakening the publication guard.
8. Failure privacy: ensure owner status receives only bounded codes and never a
   Storage path, lease token, provider response, or operational secret.

If the audit identifies a database gap, the change must use a new additive
migration and new pgTAP coverage. Applied migration history remains immutable.
No remote database operation belongs to the audit.

## 5. Proposed worker structure

The planned workspace is `apps/media-worker/` with responsibilities separated
so media logic can be tested without cloud services:

- `src/config`: bounded environment parsing with no secret logging;
- `src/domain`: job inputs, probe facts, crop result, derivative metadata,
  transcript result, and stable failure types;
- `src/db`: service-only RPC adapter and lease-aware transition calls;
- `src/storage`: exact-path download/upload/delete operations;
- `src/media/probe`: structured ffprobe execution and allow-list validation;
- `src/media/geometry`: pure crop calculation and unsafe-geometry rejection;
- `src/media/transcode`: fixed argument construction without shell-concatenated
  client strings;
- `src/transcription`: provider-neutral interface, deterministic fake, and
  separately authorized provider adapter;
- `src/pipeline`: idempotent orchestration and crash-boundary handling;
- `src/entrypoint`: one media UUID per process and bounded exit behavior;
- synthetic/licensed fixtures and unit/integration tests;
- a pinned container definition and local invocation instructions.

Temporary raw, derivative, and transcription-audio files live only inside the
bounded job filesystem and are removed on success or failure. The worker never
accepts a caller-supplied Storage path or arbitrary FFmpeg option.

## 6. Processing algorithm

For each media UUID:

1. Validate the UUID input and claim the row with a fresh lease.
2. If no row is claimable, exit successfully as duplicate, premature, terminal,
   or already-owned work without revealing row details.
3. When no staged derivative exists, download exactly the authoritative raw
   path, enforce a local byte cap, stream-hash it, and run ffprobe.
4. Validate container, required streams, codecs, dimensions, duration, and the
   recorder lead-in/overshoot bounds. The probe is authoritative over filename
   and client MIME.
5. For video, validate start/end geometry and calculate the crop from encoded
   frame size divided by CSS viewport size. Reject partial visibility, material
   start/end movement, nonfinite values, or an aspect mismatch beyond the
   accepted tolerance. Never guess offsets or fall back to a full-page encode.
6. Trim the measured lead-in, emit no more than the requested range, crop video
   first, and scale without upscaling to approximately 426x240 with even output
   dimensions. Produce the approved bounded video or audio profile.
7. Probe and hash the derivative. Enforce its streams, MIME, duration,
   dimensions, codec, and byte limit before deterministic private upload.
8. Reconfirm lease ownership and stage derivative metadata through the worker
   RPC. A lost lease prevents all later domain transitions.
9. Delete the exact raw object and verify absence. Treat an already-absent raw
   object as recoverable when the staged derivative proves a prior attempt
   crossed that boundary.
10. Confirm raw deletion, then publish. Media becomes `ready` and the annotation
    becomes `published` while the lease is kept for transcription.
11. Extract ephemeral transcription audio from the exact trimmed derivative,
    transcribe only that audio, normalize text, and validate ordered relative
    segments against final duration.
12. Stage the transcript under the same lease. Provider metadata is bounded and
    private; transcript text is never logged. Clear the lease. A transcription
    failure leaves the published excerpt in place and schedules a retry.
13. Delete local temporary files and emit a sanitized completion record.

The pipeline must be idempotent. A retry reuses valid staged work and never
publishes before the derivative exists and raw deletion is confirmed. The
excerpt transcript is attached after publication and does not gate it.

## 7. Media validation rules

### Video

- Input must probe as supported, unencrypted WebM with audio and video streams.
- Raw duration may exceed the requested range only by the bounded recorder
  lead-in and proposed maximum two-second overshoot.
- The selected video element must be fully visible within the accepted 1-CSS-
  pixel tolerance at both samples.
- A probed frame that matches neither the CSS viewport aspect nor, when
  `resizeMode` is `crop-and-scale`, the reported capture-track aspect is
  `unsafe_geometry`. A device-pixel frame that shares the CSS viewport aspect
  is a direct scale even when the reported track aspect differs.
- A player outside the viewport, or start/end viewport, rectangle, or
  fullscreen movement beyond rounding tolerance, is `unsafe_geometry` and is
  not retried.
- Crop coordinates are clamped and converted to codec-compatible even values.
- Final output is no more than 90,000 ms, no larger than the selected range, no
  more than 16 MiB, and approximately 240p without upscaling.

### Audio

- Input must probe as supported WebM/Opus with an audio stream and no required
  video stream.
- Final output is the exact bounded excerpt where source duration permits, no
  more than 90,000 ms, and no more than 8 MiB.
- Initial encoding candidate is AAC-LC, 96 kbps, 48 kHz, at most stereo; it is
  not frozen until quality acceptance passes.
- No denoising, interpolation, loudness normalization, or other DSP may hide an
  unexplained capture defect.

### Transcript

- Input comes from the final excerpt, never the original source or a full-source
  transcript.
- Text is nonblank and within the existing database bound.
- Segments are optional, nonempty when present, ordered, nonoverlapping within a
  documented rounding tolerance, relative to excerpt zero, and bounded by the
  final media duration.
- A missing transcript does not block publication. An invalid transcript is
  not stored. Transcription retries while the playable excerpt stays public.

## 8. Stable failure model

Persist only lowercase sanitized identifiers. Exact codes may be refined by
tests, but the initial taxonomy is:

| Stage | Representative codes | Default disposition |
| --- | --- | --- |
| `probing` | `raw_missing`, `raw_too_large`, `invalid_container`, `unsupported_codec`, `missing_audio`, `missing_video`, `duration_out_of_bounds` | Terminal unless absence is a proven crash-recovery case. |
| `transcoding` | `unsafe_geometry`, `transcode_timeout`, `transcode_failed`, `output_invalid`, `output_too_large` | Geometry/output validation terminal; transient execution failures retryable. |
| `transcribing` | `provider_timeout`, `provider_rate_limited`, `transcription_failed`, `transcript_invalid` | Provider/transient failures retryable; invalid deterministic output terminal after bounded attempts. |
| `raw_cleanup` | `raw_delete_failed`, `raw_delete_unconfirmed` | Retryable; never publish. |
| `finalizing` | `lease_lost`, `state_conflict`, `publication_failed` | Reconcile authoritative state before retry. |

Retryability belongs to trusted worker/reconciler logic, not client input. Use
bounded exponential backoff with jitter, no more than three claimed attempts
over the 72-hour processing ceiling, followed by terminal failure and the
documented cleanup window. Raw provider/FFmpeg errors stay in restricted logs.

## 9. Delivery increments

Implementation should proceed one important behavior at a time after explicit
authorization:

### C1. Contract and fixture gate

- Complete the contract audit in section 4.
- Create small synthetic or explicitly licensed fixtures: landscape video,
  portrait video, letterboxed video, audio-only, malformed input, missing
  stream, unsafe geometry, and duration boundaries.
- Record approved decisions or open blockers. No cloud dependency is needed.

Exit: fixture provenance is documented and the existing database contract is
either accepted or an additive correction is specified with tests.

C1 findings and fixture evidence are recorded in
`docs/architecture/phase-c-c1-contract-audit.md`. The audit specifies an
additive contract correction; no migration or worker implementation is
authorized by that finding. C1 closed on 2026-08-16 with a checksum-verified
synthetic corpus and the owner decision that every capture-metadata version 1
row requires recapture.

### C2. Local media core

- Implement pure probe, geometry, trim/crop/scale, output-probe, checksum, and
  size-validation modules.
- Run them locally against fixtures with deterministic commands and outputs.

Exit: one video and one audio fixture produce bounded derivatives; unsafe input
fails closed; no network, database, or vendor is involved.

C2 closed on 2026-08-16. The dependency-free local core, focused tests, five
recorded derivatives, probe facts, and deterministic SHA-256 evidence are
documented in `docs/architecture/phase-c-c2-local-media-core.md`. The 22-test
C2 gate passes, including the 89,999/90,000/90,001 ms boundary and mandatory
version 1 recapture behavior. No package, database, vendor, network, or cloud
dependency was added.

### C3. Transcription boundary

- Implement transcript normalization and segment validation with the fake
  adapter.
- After provider approval, add one real adapter and contract tests with network
  calls disabled by default.

Exit: only the exact derivative audio can enter the adapter, and invalid
transcripts cannot advance state.

C3 closed on 2026-08-16. The exact-derivative audio capability, normalization
and segment contract, deterministic fake, network-denied tests, and text-free
evidence are documented in
`docs/architecture/phase-c-c3-transcription-boundary.md`. The focused C3 gate
passes 20/20 tests. No provider, credential, network request, package, database,
production capture, or cloud dependency was added.

### C4. Local Supabase and Storage orchestration

- Exercise claim, staged derivative, staged transcript, raw deletion,
  finalization, retry, duplicate dispatch, and every crash boundary against a
  local database and local Storage.
- Add pgTAP only if an additive database refinement is required.

Exit: the article regression remains green and a hosted row cannot become
public early under any tested path.

C4 closed on 2026-08-18. The production extension and web upload
boundary now emit and strictly validate capture-metadata v2, measure lead-in on
the offscreen monotonic clock, require complete video end geometry, reset the
attempt counter on recapture, and return bounded `RECAPTURE_REQUIRED` for v1.
The additive migration and pgTAP contract cover the authoritative claim
envelope, fact-derived resume stage, lease-fenced server backoff, terminal
attempts, narrow dispatch/reconciliation candidates, and mandatory v1
recapture. The SQL definitions and representative transitions compile and pass
against an isolated temporary PostgreSQL 18 cluster. The migration is also
applied to Local Supabase, Local schema lint reports no errors, and the full
Local pgTAP gate passes all 229 tests across eight files.

The actual private Local Storage lifecycle and crash-boundary matrix now pass
10/10 tests. They cover private access denial, exact checksums and paths,
no-upsert preservation, duplicate claim denial, deterministic staged reuse,
all six crash boundaries and their authoritative resume stages, bounded
backoff, the three-attempt ceiling,
terminal cleanup, atomic publication, and cleanup of every Local fixture. The
article regression remains green and no tested crash publishes early or
strands raw data. Owner Chrome acceptance also passed for one YouTube video and
one synthetic audio range, with audible source audio, authoritative queued
terminal state, and accepted sanitized v2 metadata for both media types. The
disposable Local user, rows, private objects, processes, temporary state, and
environment overrides were removed after evidence capture. C4's automated and
owner exit gates are closed. No migration was applied remotely. See
`docs/architecture/phase-c-c4-local-orchestration.md`.

### C5. Container, dispatcher, and reconciler

- Package the already-tested pipeline in the pinned container.
- Implement authenticated one-ID dispatch, bounded concurrency, expired-lease
  reconciliation, retry scheduling, retention cleanup, and sanitized logs.
- Validate locally with fake external services before any provisioning.

Exit: container execution is deterministic and local crash/retry tests pass.

C5 completed locally on 2026-08-18. The
dependency-free runtime uses the existing C4 functions with no migration,
authenticates and starts one worker process per media UUID, keeps retry timing in
PostgreSQL, reconciles expired leases, performs claim-fenced retention cleanup,
and emits exact allow-listed logs. The focused source/static gate passes 11/11;
the actual loopback-only Local Supabase lifecycle passes 5/5 with non-loopback
network denied. The non-root Linux/amd64 container definition pins Node 24.14.1,
PostgreSQL client 17.6, and the checksum-verified LGPL FFmpeg 8.1 build. The
owner-approved build produced local digest
`sha256:b1fab7ac1ac48dc1609ad22915740a509806f6b7bed26f300b5df314ba7ea977`.
Inspection and non-root executable probes pass. One authenticated container job
then reached `ready/published` under a read-only root and bounded `/tmp`, CPU,
memory, PID, capability, and privilege constraints; raw deletion, private
derivative access, transcript presence, log redaction, and exact cleanup all
passed. Evidence is recorded in
`docs/architecture/phase-c-c5-local-runtime.md`. The image was not pushed or
deployed.

### C6. Staging and owner acceptance

This increment required separate approval for selected services, costs,
credentials, Staging database access, and deployment. The Staging ref was
verified before every remote database action.

C6 implementation and acceptance are complete. The approved
Cloud Run/Supabase/OpenAI boundary is
provisioned in Staging, the provider permission gate returns HTTP 200, and one
bounded synthetic spoken-audio worker lifecycle passes through dispatch,
derivative reuse, `whisper-1`, transcript staging, confirmed raw deletion, and
atomic `ready/published`. A real-provider timestamp incompatibility reproduced
in that gate is covered by a regression test and a bounded final-segment clamp.
At that checkpoint, all three jobs used immutable digest
`sha256:db5b20136e38284fa03f45292edeb29c398597592e6155d994b09f8fc9cffd57`;
the dispatcher has `roles/run.jobsExecutorWithOverrides` on the worker job only.
The disposable fixture is removed, the queue is empty, and schedules remain
paused. Evidence is in `docs/architecture/phase-c-c6-staging-runtime.md`.

That infrastructure smoke test did not substitute for owner-performed browser
and media-quality acceptance. The numbered gates below then ran in order.
Gate 1 produced and verified a private 9,000 ms, 426x240 H.264/AAC derivative
and cleaned its remote fixture. Owner playback acceptance passed on 2026-08-18:
crop/no magenta border, motion, clear audio, no crackle or clicks, and A/V
alignment all passed with no notes. Gate 2 produced and verified a private exact
9,000 ms, 48 kHz stereo AAC derivative, confirmed raw deletion, publication,
bounded transcript, sanitized logs, and complete remote cleanup. Owner listening
acceptance passed on 2026-08-18: exact duration, clear speech, steady tone, no
crackles, clicks, warble, or dropouts, channel balance, and a clean ending all
passed with no notes. Gate 3 then passed on Staging: attempt one scheduled a
bounded retry while remaining draft with no derivative or transcript; attempt
two produced exactly one checksum-matched private derivative and reached
`ready/published`. Complete fixture cleanup returned the queue to zero. Gate 4,
the separate persistence-boundary crash tests, then passed all six Staging
scenarios. Recovery resumed exactly at `probing`, `transcribing`, `raw_cleanup`,
or `finalizing`; deterministic processed-object reuse prevented duplication,
and no scenario published before raw deletion confirmation. Gate 5 comprised
the 90-second, codec, geometry, and audio-crackle matrices. Gate 5a, the exact
90-second automated and owner playback behavior, passed on 2026-08-23; the codec
and geometry matrices followed, and audio-crackle investigation was the final
acceptance slice. The Local codec slice passes
24/24 focused media-core checks across supported VP9/Opus, VP8/Opus, and
audio-only Opus inputs plus real malformed, wrong-container, missing-stream,
and unsupported-Vorbis failures. The full worker source gate passes 65/65 with
two explicit Local-only integration skips. The positive VP8/Opus Staging
lifecycle and exact cleanup passed on the first attempt, and owner playback
passed at `00:09` with smooth motion, clear speech, steady tone, balanced
channels, clean ending, and no crackle, clicks, warble, dropouts, or notes.
Gate 5b is closed without a database migration or image change.

The Local Gate 5c geometry matrix passes 33/33 media-core checks and eight
static/container checks. It covers the three accepted crop families, exact
one-CSS-pixel visibility and movement tolerance, stable fullscreen and track
aspect, all six unsafe metadata fixtures, and verifies that unsafe input creates
no derivative. The matrix reproduced an ordering defect that rejected an edge
at exactly `-1` CSS pixel before applying the documented tolerance. The fix is
covered in source and in-container while values below `-1` remain rejected. A
geometry candidate was deployed to the three paused Staging jobs. Portrait then
retained its exact 9,000 ms derivative after a structurally valid Whisper
response ended at 10,160 ms. The text-free diagnostic passed and no retry was
dispatched. A bounded 2,000 ms final-tail correction passes focused source and
no-network container regressions in image
`sha256:f4b101880bbdf77784769f82fe5055261537f0fb6f868252b3891eb687d7b057`,
which was deployed by immutable digest to all three paused Staging jobs. Portrait
reused the exact retained derivative on attempt two and cleaned completely;
letterbox completed its first-attempt lifecycle and cleaned completely; terminal
unsafe geometry remained draft with no transcript or derivative before
controlled raw cleanup. No database migration was required. Owner playback of
both 9-second artifacts passed every crop, motion, speech, tone, channel, and
ending check with no crackle, clicks, warble, or dropouts. Gate 5c is closed.

Gate 5d started at the worker boundary. A dependency-free Local harness ran
three 90-second samples for each of audio-only Opus, VP9/Opus, and VP8/Opus and
compared raw decoded excerpts with their final AAC derivatives. All 9/9 passed
exact duration, channel balance, discontinuity, dropout-window, and near-zero-run
checks with no large steps. Three blinded raw-versus-derivative listening pairs
were completed by the owner on two distinct output devices. Both sides of every
pair passed, neither side was worse, and tone, channel balance, and clean endings
passed. Device names were withheld by owner choice. The revealed mapping placed
the derivative on B for pairs one and three and on A for pair two, providing no
evidence of repeatable worker-derivative degradation. At that checkpoint, the
Local browser capture causal matrix became the next sequential step, and any
additional Gate 5d Staging lifecycle remained blocked until Local capture
acceptance passed.

The Local-only collector and six-variant build harness are implemented. They
retain the production manifest permissions, accept only localhost diagnostic
origins, cap each variant at three samples, checksum each raw Blob, and bypass
hosted authorize/upload/complete rather than falsifying loopback-off metadata.
Owner baseline and capture listening were the next evidence step.

Both public-source/no-capture baselines passed on both anonymous devices. The
VP9-default variant then passed 3/3 exact live captures and 3/3 Local worker
derivatives. Real Chrome evidence required bounded packet-timestamp duration
recovery for live WebM and a fail-closed `crop-and-scale` centered viewport
mapping; their focused regression suite passes 46/46. The representative blind
pair is sealed.

Loopback-off completed one 89,568 ms causal capture. It is retained as a
near-limit calibration rather than counted as a fourth exact-duration sample:
live playback was silent as expected, motion continued, the raw Blob retained
stereo audio, and its 89,564 ms derivative passed bounded signal analysis.
Normal worker metadata validation remains fail-closed for loopback off; only an
explicit Local analysis copy was used to exercise media processing. With three
exact default-browser samples, 9/9 worker-boundary samples, two-device owner
listening, and no reproduced defect, the Local causal gate is accepted under a
risk-based stop rule. The existing exact 90-second Staging lifecycle and owner
playback supply the remote quality evidence, so another provider invocation is
not required. Remaining browser variants are reserved for diagnosis only;
routine repetition stops here. Gate 5d is accepted.

The owner ran the acceptance sequence below, stopping on any unexpected result:

1. A short known video excerpt: verify crop, requested content, duration, A/V
   sync, transcript scope, raw deletion, and ready/publication transition.
   Passed 2026-08-18.
2. A short audio-only excerpt: verify duration, transcript scope, audible
   quality, raw deletion, and publication transition.
   Passed 2026-08-18.
3. One forced transient failure: verify bounded retry without duplicate output
   or premature publication.
   Passed 2026-08-18.
4. One crash at each persistence boundary, performed as separate tests: verify
   deterministic recovery and no stranded public/raw state.
   Passed 2026-08-18.
5. The accepted 90-second, codec, geometry, and audio-crackle matrices, one
   behavior at a time.
   Exact 90-second behavior and the complete codec and geometry matrices passed
   2026-08-23. Audio-crackle Local automation passes 9/9, blinded listening
   passed all three pairs on two distinct owner-selected devices, and the Local
   browser default/loopback causal evidence passed. The existing exact
   90-second Staging lifecycle and owner playback provide the remote evidence.
   Gate 5d is accepted.

Each manual instruction must name what to open, what to click or run, the
expected result, evidence to record, and when to stop. Only the owner can report
browser acceptance as passed.

## 10. Automated validation

Phase C adds focused worker checks to the repository validation in `AGENTS.md`:

- unit tests for bounded config, stable errors, hashing, probe parsing, crop
  math, fixed FFmpeg arguments, transcript normalization, and segment bounds;
- fixture integration tests for landscape, portrait, letterbox, audio-only,
  missing streams, malformed media, overshoot, 89,999/90,000/90,001 ms, and
  unsafe geometry;
- orchestration tests for duplicate claims, expired leases, retry limits,
  deterministic paths, staged reuse, and every crash boundary;
- Storage tests for exact paths, no-upsert behavior where applicable, byte caps,
  checksums, raw deletion confirmation, and orphan reconciliation;
- database tests for grants, direct-mutation denial, publication guards,
  transcript bounds, and any additive RPC change;
- security checks proving no secret or signed URL enters the extension bundle,
  public responses, fixtures, snapshots, or logs;
- container tests that verify the pinned FFmpeg/ffprobe versions and run as a
  non-root bounded process when supported by the selected host;
- the complete existing shared, extension, web, database, manifest, and article
  regression suite.

Unexpected validation failures stop the phase. Every reproduced defect receives
a regression test before its fix is considered complete.

## 11. Phase C exit criteria

Phase C is complete only when all of the following are true:

- the approved host, provider, codec profile, privacy terms, cost ceiling, and
  operational ownership are recorded;
- one media UUID is processed per bounded, idempotent worker execution;
- video and audio derivatives satisfy probe, duration, stream, codec, checksum,
  path, and byte constraints;
- unsafe geometry fails closed without producing a public annotation;
- transcription covers only the exact processed excerpt and passes segment
  validation;
- raw deletion is confirmed before media ready and annotation publication;
- duplicate, retry, lease-expiry, crash, and cleanup behavior pass automated and
  staging tests;
- article publication remains immediate and passes its regression suite;
- private paths, leases, secrets, provider payloads, and transcript text are not
  exposed through logs or public/client APIs;
- the audio-crackle acceptance gate passes without unexplained degradation;
- all repository validation passes;
- owner-performed staging acceptance passes and is recorded;
- commit, push, Draft PR, CI/review, and merge occur only after their separate
  authorizations.

Public playback and canonical route work remain Phase D even after the worker
can atomically publish ready records.

## 12. Rollback and operational stop

The first response to a Phase C incident is to stop new dispatch and disable new
hosted-media intake through the approved feature control. Do not loosen
publication guards or expose queued drafts.

Queued rows remain private and retryable. Active jobs may finish only when their
lease and outputs remain authoritative; otherwise they exit and reconciliation
handles them. Retention cleanup removes abandoned raw objects according to the
accepted windows. Rollback uses forward fixes and service disablement, never an
edit to applied migrations, `supabase db reset --linked`, or restoration of
partially processed public state.

## 13. Authorization checkpoints

The owner must separately authorize:

1. Phase C implementation and creation of a feature branch;
2. any package installation or lockfile change;
3. any additive database migration;
4. the worker host, cloud account, region, budget, and infrastructure creation;
5. the transcription provider, terms, credentials, and paid usage;
6. access to Local versus Staging and every remote database operation;
7. deployment and staging invocation;
8. commit, push, Draft PR, and merge.

Authorization for one checkpoint does not imply authorization for another.
