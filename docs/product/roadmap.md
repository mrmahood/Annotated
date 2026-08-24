# Product roadmap

Status: Phase C complete and merged, 2026-08-24. Increments C1-C6, their Local
and bounded Staging validation, and their owner acceptance gates are complete.
PR #18 was squash-merged into protected `main` as
`7a6bb9042cb8295575f0c8b89b9128d499c20652` after its required validation
passed; the post-merge `main` CI run also passed. Staging migration history is
aligned through `20260824020000`, all three worker jobs use accepted immutable
digest `sha256:220c2a4e23fda65395d712ed2c81154e478ea6d0c271ce6d756ec36eb0c7fe92`,
and both schedules remain paused. Production was not accessed or deployed.
Phase D is the next active project phase.

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

## Phase C — complete

Bounded media worker, implemented as immutable non-root Cloud Run Jobs in
Staging:

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

C3 provided the exact-derivative audio capability, normalized transcript and
segment validation, and a deterministic fake with network denied. The first C4
slice provided production capture-metadata v2 and the additive local worker
claim/retry/reconciliation contract. Capture-metadata v1 is readable but always
requires recapture before worker processing. The migration is applied to Local
only; schema lint and all 229 Local pgTAP tests pass. The actual private Local
Storage lifecycle and six-boundary crash matrix also pass all 10 tests without
early publication or leftover fixture objects. C4 owner Chrome acceptance also
passed for one YouTube video and one synthetic audio range: source audio
remained audible, both captures reached authoritative `processing/queued`, and
sanitized Local inspection accepted both v2 payloads. Disposable rows, objects,
user, processes, and temporary state were then removed, and the original
environment files were restored. C4 and C5 then closed and C6 began. Git
delivery, Production access/deployment, and merge remained separately
authorized.

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

C6 selected the approved Staging boundary: Cloud Run Jobs in Google project
`annotated-504301`/`us-east4`, Supabase Staging
`nkkunkwirvfwhmpwonqz`, and OpenAI `whisper-1`. The additive least-privilege
worker role is applied to Staging, budgets and model allowlisting are recorded,
and worker/dispatcher/reconciler jobs exist with schedules paused. A bounded
synthetic spoken-audio lifecycle dispatched one media ID, reused a verified
private derivative on retry, staged an excerpt-only transcript, confirmed raw
deletion, and reached `ready/published`. The disposable rows and objects were
then removed. The initial accepted runtime digest was
`sha256:db5b20136e38284fa03f45292edeb29c398597592e6155d994b09f8fc9cffd57`.
The known-video gate has passed its automated Staging lifecycle and owner
playback acceptance: the exact nine-second derivative passed crop/no-magenta-
border, motion, clear-audio, no-crackle/click, and A/V-alignment checks with no
notes. The known-audio gate also passed its automated Staging lifecycle: an
exact nine-second private AAC derivative, bounded transcript, confirmed raw
deletion, publication, sanitized logs, and complete remote cleanup all passed.
Owner listening also passed clear speech, steady tone, no crackles, clicks,
warble, or dropouts, channel balance, and a clean ending with no notes. The
forced transient gate also passed: attempt one remained private/draft and
scheduled a bounded retry without output, while attempt two published exactly
one checksum-matched private derivative after the source object was restored.
The fixture was completely removed and the queue returned to zero. At that
checkpoint, the 90-second/codec/geometry/crackle matrices remained. The six
separate Staging crash states recovered at `probing`, `transcribing`,
`raw_cleanup`, and `finalizing` as dictated by authoritative facts; the
pre-staged object was reused without duplication, already-absent raw recovered
only after derivative/transcript staging, and every fixture was removed.
Production remains untouched.

The first exact 90-second attempt created and verified a private 90,000 ms
derivative, then retained the draft with a scheduled retry because `whisper-1`
reported its final segment at 90,400 ms. A text-free diagnostic confirmed a
valid HTTP 200 response with six nonblank, ordered segments and isolated the
failure to the validator's premature 90,020 ms absolute timestamp ceiling. The
bounded one-second provider-tail clamp accepted the observed timestamp while
still rejecting values beyond 91,000 ms. The corrected pinned non-root image
passed its in-container regression and is deployed by immutable digest to all
three Staging jobs; both schedules remain paused and no Production resource was
accessed. The exact retained fixture then recovered on attempt two, reused the
same 628,495-byte derivative and checksum, normalized six transcript segments
through exactly 90,000 ms, confirmed raw deletion, published atomically, and
cleared all retry, lease, and failure fields. Exact cleanup removed every row
and object and returned the queue to zero. The subsequent clean 90-second run
also passed on attempt one: the exact 90,000 ms private derivative, six bounded
transcript segments through 90,000 ms, raw-deletion confirmation, atomic
publication, matching artifact checksum, and newest six-event sanitized worker
sequence all passed. Its exact cleanup again returned every row, object, and
processing candidate to zero. Owner playback passed at `01:30`: all four speech
markers, the continuous quiet tone, channel balance, and clean ending passed,
with no crackle, clicks, warble, or dropouts and no notes. The codec matrix then
closed locally: the synthetic fixture contract includes VP9/Opus,
VP8/Opus, audio-only Opus, malformed bytes, wrong-container bytes, missing
audio, missing video, and unsupported Vorbis audio. Both supported video inputs
produce bounded H.264 Main/AAC derivatives, audio-only Opus produces AAC, and
all negative cases fail at the private probe boundary. The focused media-core
gate passes 24/24 and the complete worker source gate passes 65/65 with two
explicit Local-only integration skips. The bounded positive VP8/Opus Staging
lifecycle then passed on its first attempt: the private H.264/AAC derivative,
bounded `whisper-1` transcript, raw-deletion confirmation, publication,
sanitized logs, and exact remote cleanup all passed. Owner playback passed at
`00:09` with smooth motion, clear speech, steady tone, balanced channels, a
clean ending, and no crackle, clicks, warble, dropouts, or notes. Gate 5b is
closed. No migration or
replacement image was required for the codec gate.

Gate 5c is accepted. The expanded media-core matrix passes 33/33 across
landscape, portrait, letterbox, exact one-CSS-pixel edge/movement tolerance,
fullscreen and capture-track stability, six unsafe capture states, and proof
that every unsafe case creates no derivative. It reproduced an ordering defect
that rejected the allowed `-1` CSS-pixel edge before applying the documented
tolerance; the regression fix accepts exactly the tolerance while values below
`-1` remain `unsafe_geometry`. Eight static/container contract checks pass. A
pinned non-root geometry candidate was built, probed, and deployed to all three
paused Staging jobs. No database change was required.

The first Staging portrait attempt reached the exact retained derivative and
then stopped safely at `transcribing` / `transcript_invalid`. At that checkpoint,
it remained draft with one scheduled retry and no lease; letterbox and unsafe
cases had not run.
The text-free structural diagnostic passed with HTTP 200, four ordered nonblank
segments, and a final timestamp of 10,160 ms for the exact 9,000 ms derivative.
This isolated a 1,160 ms provider-only tail. A 2,000 ms final-tail correction
passes focused source and no-network container probes while rejecting any
segment that starts outside the excerpt or ends more than 2,000 ms beyond it.
Candidate
`sha256:f4b101880bbdf77784769f82fe5055261537f0fb6f868252b3891eb687d7b057`
passed its runtime probes and was deployed by immutable digest to all three
Staging jobs without execution. Exact retained-portrait recovery, letterbox,
and terminal unsafe geometry then ran with schedules paused; Production and
database state remained unchanged.

The automated continuation passed. Portrait recovered on attempt two by reusing
the exact retained derivative, then published and cleaned completely. Letterbox
passed its first-attempt derivative/transcript/raw-cleanup/publication lifecycle
and cleaned completely. Partial visibility failed closed terminally as
`unsafe_geometry`, remained draft, created no transcript or processed object,
and was then cleaned. The processing queue is zero. Owner playback of both
9-second artifacts passed crop/no-magenta-border, smooth motion, clear speech,
steady tone, channel balance, and clean ending with no crackle, clicks, warble,
dropouts, or notes. Gate 5c closed, and Gate 5d audio-crackle followed.

Gate 5d began with a network-free worker-boundary comparison: three 90-second
samples each for audio-only Opus, VP9/Opus, and VP8/Opus. All 9/9 raw-excerpt
versus final-AAC pairs passed exact duration, channel balance, discontinuity,
dropout-window, and near-zero-run checks. The owner completed all three blinded
90-second comparison pairs on two distinct output devices: both A and B passed
each pair, neither was worse, and tone, channel balance, and clean endings
passed. Device names were withheld by owner choice. The revealed mapping varied
which side contained the derivative and showed no repeatable derivative defect.
At that checkpoint, the Local browser capture causal matrix became the next
sequential gate; additional Staging work remained blocked until that Local
capture evidence passed.

A localhost-only six-variant browser harness supported this work. It preserved the exact
production manifest and recorder defaults when diagnostics are absent, captures
through the real tabCapture/offscreen/MediaRecorder path, and stores at most
three checksummed raw samples per variant without invoking hosted upload or
changing database validation. Owner source/device baseline and capture evidence
followed; no additional Staging audio-crackle invocation occurred.

Both no-capture public-source baselines passed on two anonymous output devices.
The VP9-default browser variant passed three exact live captures and three Local
worker derivatives without audible or measured degradation. Real MediaRecorder
evidence also closed two Local worker gaps—missing WebM duration metadata and a
centered `crop-and-scale` track surface—with bounded fail-closed regressions.
Loopback-off subsequently completed one retained 89,568 ms causal capture: live
playback was silent as expected, motion continued, stereo audio remained in the
raw Blob, and the 89,564 ms worker derivative passed bounded signal checks.
Production validation still rejects loopback-disabled metadata. Combined with
the three exact default-browser captures, the 9/9 worker matrix, and owner
listening on two devices, this accepts the Local causal gate. The remaining
browser repetitions are skipped unless a later defect requires them. The
existing exact 90-second Staging lifecycle already passed owner playback without
crackle, clicks, warble, or dropouts, so Gate 5d is accepted without another
provider invocation. Full regression then passed, followed by the corrective
review, protected validation, and squash merge recorded at the top of this
roadmap. Production rollout and schedule enablement remain separately
authorized.

## Phase D — next

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

Phase B's automated and owner-performed browser acceptance gates passed. C1-C6
implementation and owner acceptance are complete. The exact-duration
lower-bound correction found during Draft PR review passed its separately
authorized Staging regression. The later processed-bucket,
resumable-recapture, orphan-derivative, removed-state, and processed-only
terminal cleanup corrections passed their separately authorized additive
Staging application and exact paused-schedule reconciliation gate. Required PR
validation and post-merge `main` CI passed, and Phase C is formally closed.
Phase D is next. Production rollout and schedule enablement remain separately
blocked pending their later explicit gates.
