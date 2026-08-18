# Phase C C4 local orchestration checkpoint

Status: complete, 2026-08-18. The automated gate and empirical owner Chrome
acceptance both pass. This checkpoint contains local source and one additive
migration, applied to Local only. It does not select a provider, add credentials
or packages, apply a migration to Staging, provision infrastructure, deploy,
commit, or push.

## Implemented locally

- The extension emits capture-metadata v2 using start/end viewport, DPR,
  scroll, video rectangle, and fullscreen samples. Recorder start and playback
  acknowledgement use the same offscreen `performance.now()` clock.
- Video authorization fails closed with `recapture-required` when complete end
  geometry is unavailable. Audio keeps the v2 timing/track contract without
  video-only fields.
- The web upload boundary uses exact nested allow-lists and bounds for v2,
  returns `RECAPTURE_REQUIRED` for v1 authorization/completion, and resets the
  worker attempt counter only when a new recapture is authorized.
- `20260818170519_phase_c_worker_contract_v2.sql` preserves historical v1 read
  compatibility while preventing any v1 worker lease.
- The claim envelope now returns the authoritative target, deterministic final
  path, complete raw/processed facts, transcript/raw-deletion facts, and a
  resume stage derived from persisted facts.
- A lease-fenced attempt transition computes bounded backoff on the server,
  releases the lease, preserves valid artifacts, and becomes terminal at three
  claimed attempts or 72 hours.
- Service-only bounded dispatch and reconciliation candidate functions expose
  IDs and scheduling facts, not paths, transcript text, provider data, or lease
  tokens. Reconciliation handles legacy metadata, exhausted/deadline rows, and
  expired leases without publishing.
- Service-only cleanup claim/confirmation functions return only the exact
  object paths for one eligible row, fence confirmation with the observed row
  timestamp and paths, clear confirmed object references idempotently, and
  leave the annotation private.
- A new pgTAP file covers privileges, v2 validation, claim contents, duplicate
  claim denial, retry scheduling, resume, and v1 recapture.
- A dependency-free integration harness refuses non-loopback Supabase URLs,
  obtains Local credentials only in process memory, calls the actual private
  Storage HTTP API, and invokes the private worker transitions through Local
  PostgreSQL. Its generated UUID-scoped rows, objects, and temporary files are
  removed in a finalizer.
- The uninterrupted lifecycle downloads and hashes the raw object, uploads and
  re-downloads the exact derivative, extracts derivative-only transcription
  audio, uses the deterministic fake, stages the transcript, deletes and
  confirms the raw object, and only then publishes atomically.
- Six independent crash cases cover: before durable output; derivative upload
  before database staging; derivative staging; transcript staging; raw Storage
  deletion before database confirmation; and raw deletion confirmation before
  finalization. Expired leases reconcile and resume from authoritative facts.

## Evidence completed

- Extension: 93/93 tests, TypeScript compile, and production build pass.
- Generated Manifest V3 contains exactly the approved permissions, no
  `host_permissions`, and minimum Chrome 116.
- Web: 28/28 unit tests, lint, and the production build pass.
- Shared: 18/18 tests pass.
- Worker focused unit suites: 32/32 tests pass with network unavailable.
- Local Supabase schema lint reports no errors.
- The full Local pgTAP suite passes: 8 files and 229 tests. The C4 contract
  contributes 25 passing assertions, including terminal raw cleanup and the
  requirement that capture-metadata v1 rows fail closed for recapture.
- The actual private Local Storage lifecycle and crash-boundary matrix passes
  10/10 tests. It proves both buckets private, exact bucket limits and MIME
  allow-lists, anonymous/public read denial, exact downloaded checksums,
  no-upsert byte preservation, deterministic processed-object reuse, duplicate
  claim denial, bounded retry, the three-attempt ceiling, terminal cleanup, and
  no early publication at any crash boundary.
- Post-run inspection found zero C4 fixture annotations and zero objects in
  either private Local bucket. The timestamp trigger was enabled after the run.
- Worker regression: 42 passed and the opt-in C4 test skipped by default; the
  explicit C4 invocation passed separately. Shared passes 18/18, extension
  passes 93/93 plus compile/build, and web passes 28/28 plus lint/build.
- The generated production manifest remains Manifest V3 with minimum Chrome
  116, exactly the seven approved permissions, no host permissions, and no
  persistent content scripts.
- In a disposable Local-only Chrome profile, the owner accepted one YouTube
  video range (2:44-2:50, displayed length 00:05) and one synthetic audio range
  (00:00-00:03, displayed length 00:03). Source audio remained audible during
  both captures and each finished on the authoritative Processing state.
- Sanitized Local evidence accepted both emitted payloads. Each annotation
  remained `draft`; each media row was `processing/queued`, referenced a raw
  object, and carried capture-metadata v2. The video recorded audio and video
  tracks with loopback enabled, stable 637x358 start/end element geometry, and
  matching 652x794 viewports at DPR 1.25. The audio recorded one audio track,
  no video track, and no video-only geometry fields.
- The evidence validator now accepts finite fractional monotonic lead-in values
  emitted by Chrome while rejecting nonfinite values. Its focused regression
  suite passes 4/4 and also covers exact-owner cleanup ordering and already-
  revoked Local sessions.
- Acceptance cleanup removed the exact disposable annotation trees and private
  objects, revoked and deleted the generated Local Auth user, closed the
  dedicated Chrome/web/fixture processes, removed temporary state, and restored
  both pre-check environment files. Post-cleanup inspection found zero matching
  users, annotations, Storage objects, temporary listeners, or active acceptance
  state.
- The new migration compiled in an isolated temporary PostgreSQL 18 cluster.
  Behavioral smoke checks passed for v2 audio/video, missing video end sample,
  authoritative claim/path/resume, lease release/backoff, and mandatory v1
  `recapture_required`.
- `git diff --check` passed before this report update.

## Handoff

C4 is closed. The next increment is C5 container, dispatcher, and reconciler
work. C4 completion does not authorize package installation, provider or cloud
selection, infrastructure, Staging changes, deployment, commit, push, or a pull
request; those remain separate checkpoints.
