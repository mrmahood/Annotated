# Phase C C1 worker-contract and fixture audit

Status: C1 complete, 2026-08-16. The synthetic fixture corpus was generated
with a temporary, checksum-verified FFmpeg 8.1 toolchain. This document does
not authorize a migration, worker implementation, package installation, vendor
setup, infrastructure, remote database work, or deployment.

This audit applies section 4 and increment C1 of
`docs/architecture/phase-c-media-worker-plan.md` to the merged Phase A and Phase
B implementation. The accepted architecture remains authoritative.

## 1. C1 verdict

The existing foundation correctly prevents early public hosted-media
publication and provides the core service-only state transitions, but it is not
yet a sufficient worker contract. Phase C requires one additive contract
refinement before worker/database integration and a narrow capture-metadata v2
correction before any captured video can be processed safely.

No applied migration should be edited. The required database changes should be
specified and tested in one new additive migration only after the owner
authorizes that checkpoint.

The C1 fixture inventory, deterministic generator, generated probe facts,
media checksums, and toolchain evidence are in
`apps/media-worker/test/fixtures/`. FFmpeg/ffprobe remain outside the repository
in a Windows user temporary directory and were exposed only to the generator
process.

## 2. Evidence inspected

- `supabase/migrations/20260815120000_media_archive_foundation.sql`;
- `supabase/tests/database/media_archive_foundation.test.sql`;
- `apps/web/src/lib/hosted-media-upload.ts` and the authorize/complete/cancel
  routes;
- `apps/extension/utils/media-capture.ts`;
- `apps/extension/utils/media-capture-page.ts`;
- `apps/extension/utils/media-capture-background.ts`;
- `apps/extension/entrypoints/offscreen/main.ts`;
- Phase B extension/web tests and the generated Phase B state contract;
- the current Supabase breaking-change/deprecation index relevant to Database,
  Data API, Storage, and JavaScript clients.

Platform review source: [Supabase breaking-change
changelog](https://supabase.com/changelog?types=breaking-change).

The current environment has Node.js 24 and pnpm 11.18.0. The future worker must
target a supported Node.js release of at least 22 and pin its runtime and
dependencies. No relevant current Supabase change weakens the private,
explicit-grant design; any new public-schema object still needs deliberate
grants and RLS review.

## 3. Accepted existing boundaries

These parts are suitable foundations and do not need redesign:

1. Hosted rows remain private drafts at `processing/queued` after verified raw
   upload.
2. New ranges are bounded to 1,000-90,000 ms at extension, web, and database
   boundaries while historical reads retain their separate compatibility path.
3. Raw and processed buckets are private, raw authorization uses one exact
   server-derived path with no upsert, and client requests cannot supply paths.
4. `annotation_media` and `annotation_transcripts` have no direct anonymous or
   authenticated table grants.
5. Worker transitions are in the private schema, use fixed search paths, revoke
   public/client execution, and grant only the trusted service role.
6. Deterministic final paths, MIME, duration, dimensions, byte limits, and
   lowercase SHA-256 checks are enforced during derivative staging.
7. Transcript text, language, provider metadata, and segments are bounded;
   segments must be ordered and inside final duration.
8. Raw deletion can be confirmed only after derivative and transcript staging.
9. Finalization atomically requires a ready-shaped media row, confirmed raw
   deletion, transcript presence, and a still-draft annotation before setting
   media ready and annotation published.
10. The publication trigger independently rejects hosted publication without
    final media facts, transcript, commentary, and confirmed raw deletion.
11. A staged derivative survives transcription failure and can be reused on a
    retry.
12. Owner status omits raw paths, lease tokens, provider metadata, and other
    privileged worker state.

## 4. Blocking contract refinements

### C1-B1. Capture metadata v2

Current video metadata records only the start viewport. It records start/end
video rectangles and fullscreen flags, but cannot prove that viewport size,
DPR, or scroll state remained stable. It also calculates `lead_in_ms` by
subtracting an offscreen `Date.now()` value from a page-isolated-world
`Date.now()` acknowledgement rather than measuring both points on the
offscreen document's monotonic clock.

Before video processing:

- introduce capture metadata version 2;
- record allow-listed start and end viewport width, height, DPR, and scroll
  values;
- require start and end video rectangles and fullscreen state for video;
- retain intrinsic dimensions and computed `object-fit`/`object-position` as
  validation facts;
- record captured track settings, including encoded width/height when Chrome
  supplies them;
- measure recorder start and playback acknowledgement with
  `performance.now()` in the offscreen document and persist the calculated
  monotonic `lead_in_ms`;
- retain page player start/end positions only as diagnostics;
- require complete end sampling before authorizing video upload;
- update extension, web validation, and the database metadata allow-list with
  regression tests.

The owner decision is that every capture-metadata version 1 row, video or
audio, must fail closed with a bounded `recapture_required` result. Do not
silently process version 1 rows with guessed geometry or timing. Historical
rows remain readable, but they are not worker-processable.

### C1-B2. Authoritative claim envelope

`private.claim_annotation_media_processing` currently returns the media and
annotation IDs, capture metadata, raw facts, partial staged derivative facts,
lease, and attempt count. It does not return:

- authoritative target start and end milliseconds;
- the exact server-derived processed path or the owner fact needed to derive it;
- complete staged derivative metadata and checksums;
- whether a transcript is already staged;
- `raw_deleted_at` or enough state to resume finalization;
- the durable stage that should be resumed after an expired lease.

The worker should not compensate with broad direct table reads. Refine the
claim RPC to return an allow-listed job envelope containing the authoritative
target range, exact expected processed path, complete staged derivative facts,
transcript-present flag, raw-deletion fact, current resume stage, new lease, and
attempt count.

Resume stage must be derived from persisted facts:

- no derivative: `probing`;
- derivative but no transcript: `transcribing`;
- derivative and transcript but raw not confirmed deleted: `raw_cleanup`;
- derivative, transcript, and confirmed raw deletion: `finalizing`.

### C1-B3. Retry and terminal-attempt transition

The current failure function immediately sets `processing_status = failed` and
clears `next_attempt_at`; the retry function then queues the row immediately.
There is no atomic service-only transition that records a retryable attempt,
sets bounded backoff, releases the lease, and leaves the job eligible for the
reconciler. A row that exhausts claim attempts can also remain `processing`
unless trusted code performs a separate terminal transition.

Add a lease-fenced transition that:

- accepts only sanitized stage/code and a server-calculated retry time;
- keeps a retryable row in `processing/queued` with `next_attempt_at` set;
- releases the lease without discarding valid staged work;
- becomes terminal `failed` at the third claimed attempt or the 72-hour ceiling;
- retains raw and valid processed objects for the documented cleanup/retry
  window;
- leaves deliberate retry as a separate trusted operation.

Backoff policy belongs to trusted code, never client input. Initial planning
target: bounded exponential delays with jitter, capped by the processing
ceiling.

### C1-B4. Dispatcher and reconciler candidate contract

There is no narrow function that returns due media IDs for dispatch or the rows
that require expired-lease and retention reconciliation. Add service-only,
bounded candidate functions that expose IDs and scheduling facts only. They
must not return raw/final paths, transcript text, provider data, or lease tokens.

Candidate selection must cover:

- `processing/queued` rows whose `next_attempt_at` is due;
- expired leases still below attempt/time limits;
- exhausted or over-ceiling rows needing terminal failure;
- abandoned `capture_pending`/`uploading` rows needing 24-hour cleanup;
- terminal rows whose raw-retention window expired;
- finalizing rows that can complete without repeating transcode/transcription.

### C1-B5. Retention and object reconciliation

The schema carries the necessary timestamps and paths, but no complete cleanup
transition currently records deletion/reconciliation for abandoned or terminal
raw objects. Specify service-only cleanup operations that lock the row, return
the exact object action to trusted code, and record confirmed absence without
publishing.

The reconciler must handle:

- database path with missing object;
- object whose database row is removed or no longer references it;
- staged database path with missing or mismatched processed object;
- processed object uploaded by an execution that loses its lease;
- raw deletion that succeeded before the database confirmation call;
- idempotent repeated cleanup.

Object listings are reconciliation inputs only. The database relationship and
derived exact path remain authoritative.

## 5. Lease and stale-writer decision

Use a 600-second hard worker timeout and a 900-second database lease. The
existing claim function already accepts 60-3,600 seconds, so this decision does
not itself require a migration. No lease renewal is planned for the one-item,
10-minute MVP task.

The host must terminate an execution before its lease can expire. The worker
rechecks lease ownership immediately before and after processed upload and
before every state transition. Processed upload uses the deterministic exact
path and must not blindly overwrite an existing object.

If lease ownership is lost, the stale worker stops. It must not delete a
deterministic processed object that may belong to a newer lease. Reconciliation
compares authoritative staged checksum/metadata with the object and decides
whether it is reusable or orphaned.

## 6. Crash-recovery matrix

| Crash boundary | Persisted facts on retry | Required resume behavior |
| --- | --- | --- |
| Before processed upload | Raw only | Re-probe and transcode. |
| After processed upload, before derivative stage | Raw plus possible orphan final object | Verify lease and object; stage only if exact output is authoritative, otherwise reconcile without publishing. |
| After derivative stage | Valid derivative metadata, raw retained | Resume at transcription and verify the deterministic object. |
| After transcript stage | Derivative plus transcript, raw retained | Resume at raw cleanup without calling the provider again. |
| After raw Storage deletion, before confirmation | Derivative plus transcript, DB raw path, raw object absent | Treat absence as successful only for this safe staged state, then confirm deletion. |
| After raw-deletion confirmation | Derivative plus transcript, raw path null, `raw_deleted_at` present | Resume at finalization. |
| After finalization response is lost | Ready media and published annotation | Return idempotent success; never create another object or transcript. |
| After cancellation/removal | Lease invalid or row removed | Stop; never stage or publish. Reconcile any unreferenced processed object. |

## 7. Additive migration test specification

If the owner authorizes the database refinement, create a migration with the
Supabase CLI rather than inventing or editing a migration filename. Required
pgTAP coverage:

1. all new functions revoke `PUBLIC`, `anon`, and `authenticated` execution and
   grant only the intended trusted role;
2. claim returns authoritative target/path and correct resume stage;
3. duplicate claim cannot acquire a second live lease;
4. 600-second task/900-second lease values are accepted;
5. expired lease can be reclaimed, live lease cannot;
6. retryable failure schedules future work and preserves staged facts;
7. third attempt and 72-hour ceiling become terminal;
8. terminal rows cannot be claimed without deliberate retry;
9. cleanup candidates and transitions do not publish or expose paths publicly;
10. v2 metadata accepts complete bounded video/audio facts and rejects missing
    end geometry, nonfinite numbers, unsupported keys, oversized JSON, and
    version confusion;
11. v1 compatibility follows the explicit owner decision and fails closed for
    unsafe video;
12. raw deletion remains mandatory before finalization;
13. finalization is idempotently observable and article publication remains
    immediate;
14. public/owner projections still omit worker-private fields.

## 8. Fixture gate

All media fixtures are synthetic and generated from FFmpeg `lavfi` sources;
they contain no downloaded source media, personal data, or third-party speech.
The manifest records generation role and expected facts. Capture-metadata JSON
fixtures describe safe and unsafe geometry independently of browser sites.

Required generated media coverage:

- landscape video with audio;
- portrait video with audio;
- letterboxed video with audio;
- audio-only WebM;
- video with missing audio;
- malformed WebM bytes;
- wrong-container bytes under a `.webm` name;
- 89,999 ms, 90,000 ms, and 90,001 ms audio boundaries;
- 92,001 ms raw-duration overshoot rejection.

Required metadata coverage:

- safe landscape geometry;
- safe audio timing;
- version 1 metadata requiring recapture;
- partial visibility;
- encoded-frame/viewport aspect mismatch;
- moved end rectangle;
- resized end viewport;
- changed end DPR;
- missing end sample.

The generator must fail if FFmpeg/ffprobe is missing, use fixed arguments, avoid
network access, overwrite only its exact generated-output directory, probe every
successful media file, and write SHA-256 evidence.

## 9. C1 exit status

Completed:

- contract, security, state, lease, retry, crash, Storage, and capture metadata
  audit;
- required additive-refinement specification;
- lease/timeout and stale-writer recommendation;
- synthetic fixture provenance, inventory, metadata cases, and deterministic
  generator source;
- checksum-verified temporary FFmpeg/ffprobe acquisition and generator run;
- generated probe, duration, stream, container, and SHA-256 verification;
- owner decision that all capture-metadata version 1 rows require recapture.

C1 is closed. C2 media-core implementation still requires separate owner
authorization and must not include vendor, database, or deployment work.

## 10. Validation executed

The following local checks pass on `codex/phase-c-worker`:

- pgTAP database suite: 204/204;
- shared package tests: 18/18;
- extension tests: 92/92;
- web unit tests: 28/28;
- fixture manifest/JSON reference validator;
- generated probe/stream/container/duration contract verification;
- recomputation of all 12 recorded SHA-256 entries;
- PowerShell parser check for `generate.ps1`;
- `git diff --check`.

The web unit run retains its existing Node module-type warnings. No new warning
was introduced by C1.

The fixture run used immutable BtbN release
`autobuild-2026-08-16-13-00`, asset
`ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1.zip`. The locally recomputed
archive SHA-256 was
`907a6bbc7aa100f5392309c5be4f527d12241121eda1c46db1c62b0054019db1`,
matching both the GitHub release asset digest and the published checksum file.
The checksum file itself matched its published SHA-256
`95fe376838bf67e4c47827f044215798f3f26eb1abae5085ba0778391687a489`.
FFmpeg and ffprobe both reported `n8.1.2-44-g7c533d0f86-20260816`.

Probe evidence contains 11 media rows: ten intended successes and one intended
malformed failure. The 89,999, 90,000, 90,001, and 92,001 ms requested fixtures
probe at 90,007, 90,008, 90,009, and 92,009 ms respectively, all within the
declared 20 ms container/codec tolerance. The generated evidence records 12
SHA-256 values covering every media file and `probes.json`.
