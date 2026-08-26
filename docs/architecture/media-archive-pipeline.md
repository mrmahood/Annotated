# Hosted media archive pipeline

Status: accepted architecture, updated 2026-08-25. Phases A-B and Phase C
increments C1-C6 are implemented and accepted. C6's least-privilege worker
migrations, immutable non-root Cloud Run jobs, `whisper-1` adapter, and bounded
lifecycle, crash, codec, geometry, exact-duration, transcript, retention, and
audio-quality gates passed in Staging with both schedules paused. Staging
migration history is aligned through `20260824020000`, all three jobs use
accepted immutable digest
`sha256:220c2a4e23fda65395d712ed2c81154e478ea6d0c271ce6d756ec36eb0c7fe92`,
and the disposable fixtures were removed. PR #18 was squash-merged into
protected `main` as `7a6bb9042cb8295575f0c8b89b9128d499c20652` after required validation;
post-merge `main` CI also passed. Phase D is complete: D1 and D2 passed Local,
owner Chrome, required CI, bounded Staging regression, exact cleanup, protected
squash merge, and post-merge `main` CI. PR #20 merged D1 as
`50a3f9c38683d46f23991fbbd3ee49d807528a00`; PR #21 merged D2 as
`6f0f1c59acb52d5fb53dcc11dfd446b455ac5f2b`. Staging migration history is
aligned through `20260825120300`. Production was not accessed or deployed,
schedules remain paused. Phase E planning is defined. E1a implementation and
deterministic Local validation are complete. PR #23 passed required CI run
`32922199032`, was squash-merged into protected `main` as
`c902c2b8688c8d547cfd471f5ebe325833d22948`, and passed post-merge `main` CI run
`32922631250`. E1b and later work remain separately authorized.

The bounded Phase C execution plan is
`docs/architecture/phase-c-media-worker-plan.md`.
The bounded Phase D execution plan is
`docs/architecture/phase-d-public-experience-plan.md`.
The bounded Phase E planning contract is
`docs/architecture/phase-e-create-auth-plan.md`.

## Decision summary

- Preserve `annotations`, `annotation_targets`, `sources`, claims, comments, and
  creator profiles as the product's authoritative records.
- Create a `draft` annotation only when the user presses Publish and the server
  accepts the publication intent. Do not create server rows while the user is
  merely editing.
- Give hosted source media its own lifecycle in `annotation_media`; do not add
  capture/processing states to `annotations.status`.
- Keep both raw and processed Storage buckets private. Upload raw media directly
  to a short-lived, server-authorized path; serve ready derivatives through
  short-lived signed URLs.
- Publish a media annotation only after a worker has produced a <=90-second
  derivative and excerpt-only transcript and has deleted the raw object.
- Use the proven `tabCapture -> stream ID -> offscreen -> MediaRecorder` path.
  The offscreen document, not the side panel, owns the Blob and upload.
- Crop the visible video-element rectangle, including any captions or controls
  rendered inside it. Do not attempt semantic content-area extraction in the
  MVP.
- Run FFmpeg and transcription in a bounded container job, not in a Supabase
  Edge Function.
- Use `profiles.username` as the current creator handle, reserve old handles,
  and store an immutable annotation slug. The UUID remains authoritative.

## 1. Baseline architecture findings

This section records the pre-implementation audit that informed Phases A-D.
The Phase D closeout state supersedes its historical migration and route counts:
the repository now has 21 additive migrations, Staging is aligned through
`20260825120300`, canonical creator/slug routes and compatibility redirects are
active, and the private voting domain is present. The remaining architectural
findings continue to explain why those boundaries were chosen.

### Data model and publication

At the Phase D planning baseline, the branch had sixteen additive migrations in
`supabase/migrations/`. The first twelve were merged and Staging was aligned
through `20260824020000`; the initial D1 migrations were then Local-only. The
closeout state is recorded above; the bullets below preserve the baseline audit:

- `profiles` contains a nullable `username` with lowercase-format validation and
  a case-insensitive unique index. New-user provisioning deliberately leaves it
  null. Current public profile routes use the profile UUID, not `username`.
- `sources` deduplicates all source kinds on `normalized_url`. Its allowed types
  are `article`, `youtube`, and `podcast`. Source metadata is public.
- `annotations` owns creator, source, required product type, commentary, public
  lifecycle, and publication time. Its states are `draft`, `published`,
  `claim_pending`, `hidden`, and `removed`.
- `annotation_targets` is one-to-one with an annotation and is either a selected
  text target or millisecond time range. The initial migration capped time
  ranges at 90 seconds; the YouTube migration replaced that with a 1-second to
  5-minute constraint.
- `annotation_audio` is optional creator-recorded commentary, not source media.
  It is a one-to-one public metadata row backed by the public
  `annotation-audio` bucket. The current publishing and landing-page code only
  exposes it for article annotations.
- `claims` is write-only to public clients. Claimant details have no public read
  grant or policy. `annotation_comments` is a flat public/removed comment model;
  follow edges remain private and are exposed only through aggregate/state
  functions.

Article, YouTube, and podcast publication use separate authenticated RPCs.
They are `SECURITY INVOKER`, derive ownership from `auth.uid()`, normalize or
validate source identity, require text commentary, create/reuse the source, and
insert annotation and target atomically. All three currently create an
immediately `published` annotation. YouTube identity is a canonical watch URL;
podcast identity strips fragments, tracking parameters, and recognized playback
position parameters; article normalization similarly strips common tracking.

The current grant/RLS model permits owners to insert and update their own
`annotations` and `annotation_targets` directly. That was acceptable for the
time-code MVP, but a hosted-media publication transition must become
server-controlled: a client must not be able to set a new media annotation to
`published` without a ready derivative.

### Public and extension surfaces

The Next.js route `apps/web/src/app/a/[annotationId]/page.tsx` loads a published
annotation with separate target, source, and profile reads. It renders selected
article text or a source time range, required commentary, optional article audio
commentary, source attribution, follow state, comments, and the private claim
form. YouTube links point to the original timestamp. It does not host source
media or transcripts.

The public feed and UUID profile pages also query only `published` annotations.
Their mapping code calls the shared 5-minute input validator when reading stored
time ranges. That validation/read coupling must be split before lowering the new
publication limit, or grandfathered records over 90 seconds would disappear.

The extension keeps auth in `chrome.storage.local`, drafts in
`chrome.storage.session`, and calls Supabase directly with the publishable key
and user JWT. It currently uses one-shot top-frame scripts to read or control the
connected player. E1e may additionally enumerate readable same-origin child
frames without adding host permissions; inaccessible cross-origin frames remain
unsupported. Current media publishing records only source timestamps; no bytes
are captured or uploaded.

### Storage and security conventions

The only current bucket, `annotation-audio`, is public, limited to 6 MiB WebM,
and accepts direct owner uploads below `{user_id}/{uuid}.webm`. A privileged
helper verifies the Storage object's owner, MIME metadata, path, and size before
attaching it. Failed database publication attempts compensating object cleanup.

Hosted source excerpts should not copy this bucket's public-delivery decision.
Private buckets are subject to access control and support time-limited signed
delivery, whereas a public bucket bypasses retrieval controls. See the
[Supabase private-bucket documentation](https://supabase.com/docs/guides/storage/buckets/fundamentals).

### Capture spike findings

Commit `305f4d9` on `spike/media-clip-capture` adds `tabCapture` and `offscreen`
permissions, validates the explicitly connected source in the background,
prepares/seeks the top-level media element, requests a stream ID, and records in
an offscreen document. The offscreen document:

- requests tab audio and, for video, tab video;
- requires the expected tracks;
- selects VP9/Opus, then VP8/Opus, then generic WebM for video, or Opus WebM for
  audio;
- connects the captured audio stream to an `AudioContext` destination so source
  audio remains audible;
- records 1-second chunks, stops on the requested timer with a 92-second
  failsafe, measures the result, retains a Blob URL for preview, and stops every
  track during cleanup;
- records viewport, DPR, video-element rectangle, intrinsic video dimensions,
  `object-fit`, `object-position`, fullscreen state, and scroll offsets.

The spike already has a hard 90-second validator and robust cancellation for
tab closure, navigation, source changes, stale messages, and recorder failures.
Its representative public YouTube run produced a roughly 3.86 MiB, 15-second
`video/webm;codecs=vp9,opus` Blob with one audio and one video track. Recorder
elapsed time was 15,008 ms for a 15,000 ms request, A/V sync was acceptable, and
AudioContext loopback kept the source audible. The captured pixels excluded the
Annotated side panel and browser tab/address chrome but included webpage and
YouTube player UI around the media. One run contained audible crackle in both
live playback and the recorded WebM. The optional `captureStream()` diagnostic
also exposed live tracks on the tested source, but it remains a diagnostic;
`tabCapture` is the production architecture.

The spike's geometry was a useful start but was not a crop proof across zoom,
DPR, resize, fullscreen, or partial visibility. Production therefore carries
geometry as validated processing input and fails closed when it cannot establish
a safe transform.

Its diagnostic panel, fixed 15-second controls, protocol logging, and
`captureStream()` probe are not production features. Its recorded Blob lives in
the offscreen document, so production upload must be owned there or explicitly
chunked from there; routing a 20-50 MiB Blob through the side panel is fragile.

## 2. Proposed state machine

Keep `annotations.status` for product visibility/moderation. Add a separate
`annotation_media.processing_status` for the source-media artifact.

| Media status | Meaning | Annotation status |
| --- | --- | --- |
| `capture_pending` | Publication intent exists; capture has not completed. | `draft` |
| `uploading` | Capture metadata is accepted and a short-lived raw upload is active/retryable. | `draft` |
| `processing` | Raw object is verified; transcode, transcription, or raw cleanup is queued/running. | `draft` |
| `ready` | Final derivative and transcript are committed and raw is confirmed deleted. | atomically becomes `published` |
| `failed` | A terminal capture/upload/processing attempt failed; commentary and target remain. | `draft` |
| `removed` | Hosted media was withdrawn or the draft was abandoned. | `published`, `hidden`, or `removed`, depending on moderation scope |

`processing_stage` supplies owner-facing detail without multiplying durable
states: `queued`, `probing`, `transcoding`, `transcribing`, `raw_cleanup`, and
`finalizing`. Capturing and byte-level upload percentage are live extension
states; `uploading` is the durable recovery boundary.

Allowed transitions are:

```text
capture_pending -> uploading -> processing -> ready
        |              |            |
        +--------------+------------+-> failed
failed -> capture_pending             (recapture)
failed -> processing                  (server retry while raw remains)
capture_pending/uploading/processing/ready/failed -> removed
```

The annotation/source/target/media rows are created atomically when an
authenticated user presses Publish and the server validates source identity,
range, commentary, ownership, and creator handle. This is late enough to avoid
server drafts while editing and early enough to preserve commentary across
capture, upload, and worker failures.

Nothing is publicly readable until the final transaction sets media `ready`
and annotation `published`. Capture failure keeps the draft and commentary and
offers Recapture. Upload failure keeps the local Blob while Chrome remains open
and offers Retry upload; abandoned uploads become `failed` and any raw object is
cleaned. Processing retries automatically with a lease and bounded backoff. The
extension shows “Processing clip” plus the sanitized stage, restores state by
annotation ID, and opens the shareable page only at `ready`.

Use three automatic worker attempts over no more than 72 hours. After that,
mark the job `failed`; retain an existing raw object for 24 additional hours for
a deliberate retry, then delete it and require recapture. Delete raw objects for
abandoned `capture_pending`/`uploading` rows after 24 hours. Successful jobs do
not wait for retention: raw deletion is a precondition of publication.

If hosted media is removed later, default to keeping the annotation published:
commentary, source link, creator, comments, and claim action remain, while media
and transcript are unavailable. A moderator can separately set the annotation
to `hidden` or `removed` when the whole record must disappear.

## 3. Proposed schema

Use two additive domain tables and small routing additions. Do not repurpose
`annotation_audio`, which describes the annotator's own commentary.

### `public.annotation_media`

One row per hosted video/audio annotation:

| Column | Purpose |
| --- | --- |
| `id uuid primary key` | Worker/upload identity. |
| `annotation_id uuid unique not null` | One-to-one parent, cascading only for never-published cleanup. |
| `media_type text` | `video` or `audio`; constrained against parent annotation type by server transition logic. |
| `processing_status text` | State machine above. |
| `processing_stage text null` | Sanitized progress stage. |
| `capture_metadata jsonb` | Versioned, bounded geometry and capture facts; never an arbitrary client dump. |
| `raw_storage_path text unique null` | Server-generated private raw path. Cleared only after confirmed deletion. |
| `raw_mime_type text null` | Claimed then probed input container/codec type. |
| `raw_byte_size bigint null` | Verified Storage size. |
| `raw_checksum_sha256 text null` | Worker-calculated integrity/idempotency value. |
| `processed_storage_path text unique null` | Worker-generated private final path. |
| `processed_mime_type text null` | Final playback MIME. |
| `duration_ms integer null` | Authoritative probed final duration, constrained to 1,000-90,000. |
| `width integer null`, `height integer null` | Required for ready video; null for audio. |
| `byte_size bigint null` | Final object size. |
| `checksum_sha256 text null` | Final integrity/idempotency value. |
| `attempt_count smallint` | Bounded worker attempts. |
| `next_attempt_at timestamptz null` | Retry scheduling. |
| `lease_token uuid null`, `lease_expires_at timestamptz null` | Prevent duplicate workers and recover crashed jobs. |
| `failure_stage text null`, `failure_code text null` | Stable, sanitized support/UX codes. Raw provider output belongs in restricted logs. |
| `uploaded_at`, `processed_at`, `raw_deleted_at`, `removed_at` | Lifecycle timestamps. |
| `removal_claim_id uuid null` | Optional confidential link to the claim that caused removal; never returned publicly. |
| `created_at`, `updated_at` | Audit timestamps. |

State-shape checks require raw fields while processing, all processed fields and
`raw_deleted_at` at `ready`, video dimensions only for video, and removal time at
`removed`. `capture_metadata` has a version, an object-type/size bound, finite
positive dimensions, and an allow-list for `object-fit`; worker code still
performs full validation.

Enable RLS, but grant no direct `anon` or `authenticated` table access. Expose a
sanitized owner-status RPC and a public-ready RPC/view that omits raw paths,
leases, failure details, provider metadata, and removal claim IDs. The service
role and narrowly scoped worker functions get explicit privileges.

### `public.annotation_transcripts`

Keep one transcript row per annotation:

- `annotation_id uuid primary key`;
- `transcript_text text not null` with a practical size bound;
- `language text null`;
- `segments jsonb null`, a bounded array of `{start_ms,end_ms,text}` relative to
  zero at the archived excerpt, ordered and within `annotation_media.duration_ms`;
- `provider text`, `model text`, and optional `provider_metadata jsonb` for audit
  and migration, not public rendering;
- `created_at` and `updated_at`.

Do not add word/token tables. Timestamped segments are sufficient for a
90-second landing page. Public visibility requires parent annotation
`published` and media `ready`; removal immediately suppresses the transcript.

### Routing additions

- Add immutable `annotations.slug`, lowercase and unique per `user_id`.
- Add `profile_handle_aliases(handle primary key, profile_id, created_at)` to
  reserve old handles permanently.
- Keep `profiles.username` as the current handle. Remove direct client update of
  that column and change it only through a locked, audited RPC that checks both
  current usernames and aliases.

No general-purpose job table is required for the MVP; the media row contains the
single job's lease and retry fields. If the pipeline later fans out into several
independent derivatives, split jobs then.

## 4. Storage architecture

Create two private buckets:

| Bucket | Write authority | Read authority | Limits and retention |
| --- | --- | --- | --- |
| `annotation-media-raw` | Short-lived signed upload for one server-generated path; worker/service role thereafter. | Worker only. Never public or owner-downloadable. | WebM only; 50 MiB bucket maximum. Per-kind validation may use 50 MiB video and 16 MiB audio. Delete before publish, after 24 hours abandoned/terminal, or after a 72-hour processing ceiling. |
| `annotation-media` | Worker only. | Landing-page signing endpoint only after DB readiness. | MP4 video or M4A audio; suggested application limits 16 MiB video and 8 MiB audio. Removed independently of annotation text. |

Raw paths are generated by the server, for example
`{user_id}/{annotation_id}/{media_id}/{upload_nonce}.webm`. Upload uses a
short-lived signed upload token, `upsert: false`, and the extension sends bytes
directly to Supabase rather than proxying them through Next.js. A completion
endpoint verifies JWT identity, row ownership/state/path, object owner/size/MIME,
and capture metadata before moving the row to `processing`. FFprobe, not the
client MIME, is authoritative.

The worker alone derives final paths, for example
`{user_id}/{annotation_id}/{media_id}/excerpt.mp4`; clients never supply them.
Paths and outputs are deterministic so retries are idempotent.

The web app exposes a same-origin playback endpoint that rechecks annotation
`published`, media `ready`, and `removed_at is null`, then redirects to a
60-300-second signed URL with `Cache-Control: no-store`. Supabase notes that a
signed URL itself remains usable until expiry, so short TTLs plus immediate
object deletion are the revocation boundary; see
[Serving assets from Storage](https://supabase.com/docs/guides/storage/serving/downloads).
Do not show a derivative download button. `controlsList="nodownload"` is a UX
hint, not DRM and not a security guarantee.

## 5. Worker/runtime recommendation

Add a single `apps/media-worker` TypeScript workspace packaged as a container
with a pinned FFmpeg/ffprobe version. Deploy it first as one bounded Cloud Run
Job definition. A server-side dispatcher starts one execution with only the
media UUID; a periodic reconciler dispatches queued rows and expired leases so a
lost notification cannot strand work. Cloud Run Jobs provide per-task timeout
and retry controls; see the official
[Cloud Run Jobs documentation](https://cloud.google.com/run/docs/create-jobs).

This adds a container registry, job identity, and secret configuration, but no
always-on queue or server. It is more reproducible than relying on a host's
system FFmpeg and safer than CPU-heavy work inside request handlers. If the team
already has a supported background-worker host, the same polling/lease protocol
can run there with no database redesign.

Do not run FFmpeg in Supabase Edge Functions. They are appropriate for small
authorization/dispatch calls, but their isolate resource limits explicitly push
CPU-intensive work to background infrastructure; see Supabase's
[Edge Function CPU guidance](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits).
Vercel/Next routes likewise authorize and dispatch but do not transcode.

The worker receives no browser or user credentials. It uses a worker service
identity and server-only Supabase credential, downloads exactly the allocated
private object, writes only its deterministic final path, and calls narrowly
scoped claim/complete/fail RPCs. Configure a 10-minute attempt timeout, two
platform retries (three attempts total), one media item per task, bounded local
disk/memory, and log correlation by media UUID without source URLs or transcript
text.

Processing is idempotent:

1. claim the row with a lease;
2. download and hash raw input;
3. ffprobe streams, dimensions, duration, and container;
4. calculate/validate crop;
5. transcode to deterministic temporary/final output;
6. derive transcription audio from that exact clipped output;
7. transcribe and validate segment bounds;
8. transactionally stage final metadata and transcript while annotation remains
   private;
9. delete and confirm the raw object;
10. transactionally clear the raw path, set media `ready`, and set annotation
    `published`/`published_at`.

A crash after raw deletion is recoverable because final metadata and transcript
were staged first; the next attempt confirms raw absence and performs the final
transition.

## 6. Video cropping and transcoding

### Capture metadata

Send a versioned, allow-listed capture structure with:

- CSS viewport width/height, DPR, and scroll offsets;
- video `getBoundingClientRect()` values;
- intrinsic `videoWidth`/`videoHeight`;
- computed `object-fit` and `object-position`;
- fullscreen state;
- capture track settings including recorded width/height/frame rate;
- requested source start/end, recorder elapsed duration, and the measured delay
  between recorder start and the page's successful `media.play()` acknowledgement;
- the same viewport and element rectangle sampled again at capture end.

The worker independently obtains encoded frame dimensions and duration from
ffprobe. `boundingClientRect` is already viewport-relative, so scroll offsets are
diagnostic and must not be added to it. DPR is also diagnostic: the authoritative
scale is encoded pixels divided by CSS viewport dimensions, which accounts for
DPR and any browser capture scaling without assuming either.

For a fully visible rectangle and matching viewport/frame aspect ratios:

```text
sx = encoded_width  / css_viewport_width
sy = encoded_height / css_viewport_height
crop_x = round(rect.left   * sx)
crop_y = round(rect.top    * sy)
crop_w = round(rect.width  * sx)
crop_h = round(rect.height * sy)
```

Clamp to the encoded frame and adjust to codec-compatible even coordinates.
Allow only a small aspect-ratio/rounding tolerance (proposed 1%). A material
viewport/frame aspect mismatch means the browser may have introduced padding or
another transform for which no API supplies an authoritative content rectangle.
Do not guess at offsets or pixel-scan site content: fail with `unsafe_geometry`
and ask the user to retry after making the player fully visible or fullscreen.

Likewise, detect partial visibility by intersecting the element rectangle with
`[0, viewport_width] x [0, viewport_height]`. For the MVP, block capture when the
video element is not fully visible within a 1-CSS-pixel rounding tolerance. This
accounts for partial elements without silently archiving an unexpected slice.
Also reject processing if the start/end viewport or element rectangle changed
beyond rounding tolerance. This makes scrolling, zooming, resizing, or entering
fullscreen during a capture an explicit retry instead of applying stale crop
coordinates.

For E1e generic webpage video, a readable same-origin child-frame player may be
mapped into top-frame viewport coordinates by accumulating each frame element's
`getBoundingClientRect()` offset. Record and revalidate the frame path, origin,
viewport, borders, and final mapped player rectangle at start and end. Reject
cross-origin traversal, CSS transforms, clipping, partial visibility, frame
navigation/reorder, or any mapping that cannot be reproduced within the existing
rounding tolerance. Do not estimate inaccessible frame geometry or treat the
outer iframe box as the video content rectangle.

Choose option A: crop the exact visible video-element box. Preserve any
source-rendered letterboxing, captions, watermarks, and player controls visible
inside that rectangle. `object-fit` and intrinsic dimensions are validation and
diagnostic inputs only. Do not attempt to infer the underlying content area,
remove overlays, or crop the YouTube player container semantically.

### Final encodes

Recorder setup necessarily precedes page playback, so raw video can contain a
short lead-in. In production, the offscreen timer starts its requested-duration
countdown only when background sends the successful page-play acknowledgement;
the recorder itself keeps running during that handshake. Store the lead-in
measured on the offscreen clock. The worker removes it, then emits exactly the
requested duration (or the smaller verified remainder at source end). This keeps
the archived content aligned with `annotation_targets.start_ms/end_ms` instead
of silently shortening the selected source interval.

For video, trim to the requested range, crop first, then scale without
upscaling to fit approximately 426x240, preserve aspect ratio, and force even
dimensions. Encode H.264 in an MP4 container with `yuv420p`, AAC-LC audio, and
fast-start metadata for broad browser playback. Pin codec profile, CRF/bitrate,
audio rate, and FFmpeg version after representative quality/size tests. Reject
missing audio, missing video, unsupported/encrypted input, unsafe geometry, or a
final probe over 90,000 ms. Recorder timer overshoot is tolerated only in raw
input (proposed requested duration plus at most 2 seconds); the final output is
trimmed to <=90,000 ms.

For audio, accept probed WebM/Opus input, trim to the requested range, and encode
an M4A/AAC-LC derivative at a speech-appropriate tested rate (initial candidate:
96 kbps, 48 kHz, no more than stereo). Do not loudness-normalize or add DSP in the
first milestone; “normalize” here means a stable container/codec/sample format.

## 7. Transcript design

Transcription runs server-side in the worker behind a small `Transcriber`
interface. Provider, model, language hint, and feature flags are configuration;
the database records which implementation produced the result but the domain
model does not hard-code one vendor. Provider API secrets live only in the
worker's secret manager.

Generate transcription input from audio extracted from the exact, already
trimmed derivative. An ephemeral mono PCM/FLAC file may be used inside the job
and is deleted with the job filesystem. Never request or store a full source
transcript, including when YouTube or a podcast exposes one.

Store normalized plain text, detected language when available, and optional
segment timestamps relative to the excerpt. Validate that segments are ordered,
non-overlapping within a small provider rounding tolerance, nonempty, and do not
exceed final media duration. A transcription failure is a processing failure:
the annotation remains private, the transcode is reused on retry, and publication
waits for a valid transcript. The landing page may show “Transcript unavailable”
only after later media removal, not as a successful initial publication state.

## 8. Extension capture and upload design

Productionize the spike into focused modules rather than merging its diagnostic
panel:

1. User selects a 1-90-second range, supplies required commentary, and presses
   Publish.
2. Extension calls a media-begin endpoint/RPC with its bearer token. The
   user-context RPC normalizes source identity and atomically creates source,
   draft annotation, target, slug, and `capture_pending` media row.
3. Background revalidates the connected top-level tab and range, samples start
   geometry, seeks/pauses the player, creates the offscreen document, obtains the
   tab-capture stream ID, and starts the recorder.
4. Background starts page playback and acknowledges it to offscreen. Offscreen
   measures the recorder lead-in on its own clock, runs the requested-duration
   timer from that acknowledgement, records with audible loopback, and owns the
   Blob. Background samples end geometry and final player time before cleanup.
5. Offscreen requests a short-lived signed raw upload for its media ID, sends the
   Blob directly to the private bucket with upload progress, and calls upload
   completion. The server validates the actual object before queuing work.
6. Background/offscreen release tracks, AudioContext, timers, and Blob URLs.
   Side panel watches sanitized status and opens the annotation when `ready`.

Add only `tabCapture` and `offscreen` to current extension permissions and raise
the Chrome minimum to the spike-tested requirement. Retain `activeTab` and
top-frame one-shot scripting; do not add broad host permissions or persistent
content scripts.

Capture progress is elapsed/requested time. Upload progress is bytes sent/Blob
size using an upload transport that exposes progress; if the chosen Supabase SDK
path cannot, use the signed URL with `XMLHttpRequest` from offscreen rather than
proxying through the app server. Never place `service_role`, worker, database, or
transcription secrets in WXT environment variables.

Panel closure does not cancel committed work: background and offscreen continue
capture/upload, and reopening restores status from session plus the server row.
Explicit Cancel stops tracks, revokes the Blob URL, marks/removes the draft
through a cleanup workflow, and preserves commentary until the user confirms
discard. A source navigation or tab closure cancels capture safely.

If connectivity drops after capture, keep the Blob in the offscreen document,
show “Waiting to upload—keep Chrome open,” and retry with bounded backoff. The MVP
does not promise raw-Blob recovery across a full browser restart: the server
draft/commentary survives, the stale upload becomes failed, and the user must
recapture. Persisting captured media in extension IndexedDB is deferred because
it introduces a second sensitive raw-media retention system. Do not clear the
commentary/draft on any failure; clear it only after `ready` or explicit discard.

Remove the spike's fixed-duration button, capture-stream diagnostic, protocol
dump, unconditional development controls, and verbose URL/track logs. Keep its
message validation, source matching, stale-event protection, hard timeout, and
cleanup tests.

## 9. Slug and URL design

The canonical public route is
`https://annotated.cbandcoop.com/{creator-handle}/{annotation-slug}`.
Annotation slugs are creator-scoped, so the handle remains required. The
annotation UUID remains the
database identity and all mutations, comments, claims, media, worker, and vote
calls use it.

On rollout, give every profile without `username` a deterministic valid handle
seeded from display name plus a short UUID suffix; users need not invent one to
publish. Handle changes go through one RPC under a transaction/advisory lock.
The RPC permanently inserts the old lowercase handle into
`profile_handle_aliases`, prevents any current/alias collision, and updates
`profiles.username`. Old-handle routes resolve the same creator and 308 redirect
to the current handle. Direct `username` updates are revoked.

Generate annotation slugs server-side from source title, falling back to source
host and annotation kind. Normalize to lowercase ASCII words, collapse separators,
bound the readable base, and append a deterministic UUID fragment, for example
`why-this-matters-a1b2c3d4`. If the unique `(user_id, slug)` constraint detects
the extremely rare short-fragment collision, deterministically extend to 12
hex characters, then the full UUID. Store the slug once; later source-title
changes do not alter it.

The new route resolves a current or permanently reserved alias handle, slug, and
published annotation, then renders by UUID. Alias-handle requests issue a 308 to
the current handle. `/a/{UUID}` remains a compatibility route and issues a 308
to `/{current-handle}/{slug}` only when safe public resolution succeeds.
Backfill slugs and generated handles before enabling redirects; until an old
published row has both, its UUID page remains available. Draft, `claim_pending`,
hidden, and removed annotations return the same public not-found result and do
not reveal a canonical destination. Canonical metadata and every share action
use the current-handle canonical route.

## 10. Landing-page data model

Create one server-side loader keyed by UUID or canonical route and return a
discriminated model:

- common: annotation UUID/slug, required commentary, publication time, creator
  handle/display/avatar, source title/author/publisher/show/host/original URL,
  creator audio commentary when valid, claim capability, comment page/count,
  and social metadata;
- article: existing selected passage and anchors;
- video: signed MP4 playback URL/expiry, dimensions/duration, source range, and
  transcript text/segments/language;
- audio: signed M4A playback URL/expiry, duration, source range, and transcript;
- removed media: no path or transcript, stable removal presentation, while the
  common annotation can remain public.

The safe media loader returns only ready public fields. The signing endpoint
performs a fresh authorization/readiness check instead of accepting a storage
path from the client. Render source attribution and original link prominently,
then hosted excerpt, transcript, commentary, optional creator commentary, social
features, and claim action. Keep existing article behavior and public discovery
queries functional throughout the rollout.

## 11. Claim and removal lifecycle

Claim submission remains confidential and does not automatically change
annotation status or media availability; otherwise anonymous claim spam could
take content down. Tighten claim insertion so the target annotation must be
public at submission, and add server-side rate limiting/captcha when abuse
appears without weakening existing privacy.

Add a service-only moderation RPC, not a console in this milestone. For a
media-only action it:

1. locks annotation/media/claim and records `removed_at`, a stable reason code,
   optional confidential claim link, and status `removed` on media;
2. commits before issuing any new URL can pass the readiness check;
3. deletes raw and processed objects and records confirmed cleanup (with a
   retryable cleanup error if Storage is temporarily unavailable);
4. suppresses transcript public access immediately and either deletes it or
   retains it only in restricted audit storage according to the moderation
   policy;
5. resolves/updates the private claim separately.

Deleting the processed object invalidates playback even for most already-issued
signed URLs; the short TTL bounds any storage/CDN race. No future signed URL is
created once media is removed. Preserve hashes, dimensions, duration, removal
actor/time/reason, and claim linkage as the audit trail, but not the copyrighted
binary. A full-record action additionally sets annotation `hidden` during review
or `removed` when final. Existing comments follow annotation visibility; they do
not need to be destroyed for a media-only removal.

## 12. Audio-quality investigation

Make the observed crackle a release-blocking implementation test, before adding
DSP. Use the same known-clean speech/music passages and capture at least three
90-second samples per relevant variant:

- normal playback with no capture (source/device baseline);
- tab capture and MediaRecorder with AudioContext loopback enabled;
- the same capture with loopback disconnected (file-only diagnostic);
- `recorder.start()` without a timeslice versus the spike's 1-second timeslice;
- supported VP9/Opus and VP8/Opus choices, with default versus explicit tested
  audio/video bitrates;
- at least two output devices and two ordinary public sources;
- raw capture versus final transcode, to determine which stage introduces a
  defect.

Record Chrome/OS version, track settings, codec, bitrates, timeslice, CPU load,
and whether the artifact is audible live, present in raw WebM, and present after
transcode. Inspect waveforms/spectrograms around reported clicks, but make a
blind human comparison part of acceptance.

Acceptance: ordinary speech/audio has no repeatable, materially audible clicks,
crackle, dropouts, or distortion introduced by Annotated across the test matrix;
the archived file is not audibly worse than the source baseline. Preserve
acceptable A/V sync and duration accuracy. If loopback is causal, correct the
graph/lifecycle; if timeslicing or encoding is causal, change that setting. Do
not mask an unknown capture bug with filters, denoisers, or interpolation.

## 13. Security and RLS model

- Browser: publishable key and user session only. Never expose `service_role`,
  database passwords, worker credentials, Cloud credentials, or transcription
  secrets.
- Begin RPC: derive `user_id` from `auth.uid()`, require nonblank <=2,000-character
  commentary, verify normalized source/type/range, and ensure a handle/slug.
- Publication: add a database guard so every newly published `video_clip` or
  `audio_clip` has one `ready` media row. Replace/revoke the old immediate media
  publish RPCs. Existing published time-code rows are grandfathered.
- Writes: clients cannot insert/update/delete media/transcript rows, set final
  paths, acquire leases, mark ready, or remove hosted media. Owner RPCs expose
  only begin, cancel, retry, and sanitized status transitions.
- Annotation status: revoke broad owner updates to status/publication fields;
  use RPCs and column-level grants for allowed profile/commentary editing. Keep
  article publishing behavior through its validated RPC.
- Raw upload: path and one-use/short-lived authorization are server-generated;
  `upsert` is false. Completion verifies authenticated owner, annotation/media
  relationship, exact path, Storage object metadata, <=50 MiB size, allowed
  WebM MIME, and expected state.
- Worker: claim with `FOR UPDATE SKIP LOCKED` or an equivalent atomic RPC,
  lease/attempt bounds, and a random lease token on every complete/fail call.
  Probe actual streams/container/duration; never trust extensions or client MIME.
- Geometry: finite, positive, bounded numbers only; fixed schema version and JSON
  size cap. FFmpeg arguments are constructed from validated numeric values and
  fixed codec options, never shell-concatenated client strings.
- Delivery: final path is looked up by authoritative annotation UUID; no endpoint
  accepts a caller-supplied Storage path. Signing checks current ready/public/not
  removed state on every request.
- Claims: retain current no-read grants/policies. Moderation uses server role and
  never returns claimant fields with public annotation data.
- Observability: log IDs, stages, durations, sizes, exit codes, and stable error
  codes; redact auth tokens, signed URLs, source URLs when unnecessary,
  transcript text, and provider payloads.

The 90-second restriction, commentary requirement, low-resolution derivative,
attribution, original link, claim action, absence of a download button, and raw
deletion are product controls. They are not a legal fair-use determination or
DRM. Do not capture protected/DRM media, bypass paywalls/auth controls, fetch
underlying media URLs, or retain high-quality originals.

## 14. Exact phased implementation order

Each phase should be a separate reviewable change and staging gate. Migration
names below are scopes, not files created by this design.

### A. Database, routing, and storage foundation

- Likely files: new additive migrations under `supabase/migrations/`, new pgTAP
  tests under `supabase/tests/database/`, `packages/shared/src/media-time.ts` and
  tests, Supabase config/docs.
- Migration: add `annotation_media`, transcripts, slug, handle aliases, private
  buckets/policies, state guards/RPCs, indexes, and timestamps. Keep the existing
  time-range target constraint at its historical 5-minute read/legacy-workflow
  ceiling during Phase A. Enforce 90,000 ms independently in the new hosted begin
  RPCs, ready-media constraints, worker staging, and publication guard. This lets
  existing >90-second rows remain readable and permits the explicitly temporary
  legacy time-code RPCs without weakening the new hosted path. After Phase B
  retires legacy creation, audit production and use a later additive migration
  to tighten the target constraint if product no longer needs that compatibility.
- Compatibility: split shared “new publication” validation (90 seconds) from
  “read grandfathered stored target” validation (up to the historical 5 minutes)
  before changing callers. Replace immediate media publish RPCs with begin-draft
  paths; leave article RPC behavior unchanged.
- Tests: constraints, grants, every RLS role, direct-publish bypass attempts,
  source/type mismatch, state transitions, leases, old-row compatibility,
  handle/slug collision and alias resolution, claim privacy, and bucket policies.
- Manual staging: reset from all migrations, inspect grants/policies, create all
  three annotation kinds, prove media drafts are owner-only and article publish
  remains public.
- Rollback: before traffic uses new rows, drop new RPCs/tables/buckets with a
  forward migration. After use, disable begin endpoints and retain data; do not
  roll back by editing applied migrations.

### B. Production capture and direct upload

- Likely files: `apps/extension/wxt.config.ts`, background entrypoint, new
  production capture protocol/page/offscreen modules derived selectively from
  commit `305f4d9`, side-panel orchestration/styles, publishing modules/tests,
  and authenticated upload-init/complete routes in `apps/web/src/app/api/`.
- Migration: only narrow RPC/grant corrections discovered by integration; no
  worker/public-page dependency.
- Tests: message validators, source identity, 90-second limit at every boundary,
  geometry serialization, stale/cancel events, panel close, signed path binding,
  MIME/size rejection, progress/retry, and cleanup.
- Manual staging: YouTube plus representative top-level podcast capture; confirm
  audio remains audible, panel/browser chrome is absent, page pixels are present,
  50 MiB rejection, auth expiry behavior, offline retry, tab navigation/closure,
  and no secret in extension bundle.
- Rollback: feature flag the hosted-media Publish action off. Draft rows and raw
  objects remain private for scheduled cleanup; article publishing is unaffected.

### C. Worker, transcode, transcription, and audio acceptance

Status: complete and merged. C1-C6 implementation, bounded Staging validation,
and owner acceptance are complete. The lower-duration invariant and its
corrective worker passed exact Staging validation. Forward-only cleanup
migrations, the reconciler actions, pgTAP coverage, actual Local private
Storage regressions, and the exact paused-schedule Staging reconciliation gates
closed the processed-bucket, resumable-recapture, orphan-derivative,
removed-state, and processed-only terminal retention gaps. Staging migration
history is aligned through `20260824020000`; all three jobs use immutable
digest `sha256:220c2a4e23fda65395d712ed2c81154e478ea6d0c271ce6d756ec36eb0c7fe92`,
both schedules remain paused, and the disposable fixtures were removed. PR #18
and post-merge `main` CI passed. The work breakdown, decision gates, validation
sequence, and exit criteria are recorded in
`docs/architecture/phase-c-media-worker-plan.md`. That plan narrows execution
of this accepted architecture; it does not expand the phase or authorize later
checkpoints.

- Implementation record: `apps/media-worker/`, its pinned non-root container,
  transcriber adapter, processing fixtures/tests, dispatcher/reconciler entry
  points, additive worker-contract migrations, and deployment evidence.
- Automated evidence: fixture-based ffprobe validation; safe/unsafe geometry;
  exact crop; portrait/landscape/letterboxed source; exact 90-second trim;
  required audio/video; deterministic retry; lease expiry; transcript segment
  validation; provider timeout; raw deletion before publication; and terminal
  cleanup.
- Owner/Staging evidence: accepted short video/audio, exact 90-second, codec,
  geometry, audio-quality, retry, and separate persistence-boundary recovery
  gates. Broader browser compatibility remains later-phase work.
- Rollback: stop dispatcher/job and keep feature flag off. Queued rows stay
  private and retryable; janitor handles retention. Do not publish partial output.

### D. Public annotation delivery and social experience

The exact contract audit, security boundaries, D1/D2 increments, validation,
owner checks, rollback, and authorization sequence are recorded in
`docs/architecture/phase-d-public-experience-plan.md`.

Status: complete and merged. D1 and D2 passed complete Local automation, owner
Chrome acceptance, required CI, bounded sequential Staging regression, exact
cleanup, protected squash merge, and post-merge `main` CI. Staging is aligned
through `20260825120300`; both schedules remain paused and Production was not
accessed or deployed. D1's bounded hosted acceptance cost approximately $0.0016
for `whisper-1`; D2 cost $0.

- D1 adds `apps/web/src/app/[creatorHandle]/[annotationSlug]/page.tsx`, a
  trusted canonical resolver/loader, permanent UUID and alias compatibility
  redirects, article parity, ready hosted playback, excerpt-only transcripts,
  attribution, metadata, comments, claims entry, and canonical feed/profile
  links.
- D1 adds only a same-origin trusted signing route for the private processed
  object. It revalidates published/ready/not-removed state and derives the path
  server-side; raw objects, private paths, provider metadata, and signed URLs
  remain absent from public database projections and logs.
- D2 adds one mutable or clearable `+1`/`-1` vote per authenticated user and
  published annotation, separate public totals, RLS, bounded trusted mutation
  and aggregate boundaries, rate limits, and abuse regressions. Votes have no
  initial feed, publication, moderation, claim, hiding, or removal effect.
- Rollback keeps `/a/{UUID}` able to render, disables canonical links/redirects
  and playback signing independently, and hides the voting UI/API without
  weakening database invariants. Applied migrations are corrected only by
  forward migration.

### E. Create experience and authentication

Status: planning contract current through E1b. E1a's local capability/data contract,
page-generation/revision rules, independent draft state, and regressions pass the
focused and complete extension test suites, TypeScript compilation, and
production build/manifest inspection. PR #23 passed required CI run
`32922199032`, was squash-merged as
`c902c2b8688c8d547cfd471f5ebe325833d22948`, and passed post-merge `main` CI run
`32922631250`. E1b passed owner Chrome acceptance and PR CI run `32964086959`,
then merged through PR #25 as
`9938d36a2e8bb9fbd96aaa4899ded664cdc7c587`; post-merge `main` CI run
`32965527019` passed. E1c and later implementation remain separately authorized.
The verified audit, design, security review,
increment boundaries, and acceptance plan are in
`docs/architecture/phase-e-create-auth-plan.md`.

- Rename the visible extension tab **Context** to **Create** and add a bounded
  **Text / Video / Audio** mode switcher.
- Model available, recommended, and selected modes independently so multiple
  supported media types can coexist. Preserve draft state per mode and warn
  before abandoning an active capture or upload.
- Require explicit bounded player selection when multiple players qualify;
  never select an arbitrary player silently.
- Add E1e generic webpage video only after player identity and operation guards:
  readable top-frame or same-origin-frame `<video>`, article-page source identity,
  authoritative top-frame geometry, and fail-closed handling for inaccessible
  cross-origin/DRM/canvas players. Keep `tabCapture` and offscreen Blob ownership.
- Add X.com OAuth 2.0 alongside Google through Supabase Auth with explicit web
  and extension callback tests and an account-linking policy that never merges
  users from display name alone.
- Preserve the accepted tabCapture/offscreen Blob ownership, exact permissions,
  private upload, authoritative status, restart, article, and no-secret
  boundaries. Rollback hides the reorganized Create entry without deleting or
  publishing private drafts.

### F. Claims and removal lifecycle

- Likely files: additive moderation/removal migration and pgTAP tests, server-only
  moderation script/endpoint, signing loader, landing removed state, claim route
  hardening. No full console.
- Migration: removal RPC, reason/audit/cleanup fields if not in A, claim target
  visibility check, and grants.
- Tests: claim confidentiality, unauthorized removal, URL issuance race, media-
  only versus full removal, object-deletion retry, transcript suppression,
  comments/text retention, and proof that vote state or totals cannot trigger or
  authorize a moderation transition.
- Manual staging: file a claim, perform authorized media removal, prove new and
  cached playback fails within the documented TTL/object deletion boundary, and
  verify audit data without claimant exposure.
- Rollback: disable the moderation caller, not the recorded removal. Never restore
  a deleted derivative automatically. Votes do not replace or automatically
  prioritize claims, takedown, hiding, publication, or removal decisions.

### G. Production launch and hardening

- Production uses `annotated.cbandcoop.com`. The consultancy site remains at
  `cbandcoop.com` under Lovable and Bluehost WordPress Plus; Bluehost is the
  current DNS and WordPress hosting authority.
- Do not assume WordPress Plus can run the trusted Next.js application. Evaluate
  the web runtime separately, with Google Cloud Run as the first candidate
  because the project already uses Google Cloud.
- Likely files: cross-app E2E fixtures/scripts, deployment and rollback runbooks,
  runtime/container configuration, monitoring, retention operations, and
  focused hardening fixes.
- Migration: indexes/constraints only when measurements justify them.
- Tests: complete video/audio/article paths, concurrent uploads, duplicate
  completion, worker crash, provider outage, expired JWT/signed URL, storage
  cleanup, 90-second boundary at 89,999/90,000/90,001 ms, security regression,
  and browser compatibility.
- Launch design covers DNS, TLS, Supabase and OAuth callback URLs, extension
  callbacks, cookies, CSP, secret isolation, monitoring/alerts, rollback, and
  staged Production enablement.
- Production remains blocked until Phase E passes Local, required CI,
  and bounded Staging acceptance. Production access, DNS/OAuth/vendor changes,
  deployment, schedule enablement, and traffic cutover remain separate explicit
  authorization checkpoints.
- Rollback retains per-surface feature flags and stops new intake first; active
  jobs finish or fail safely, private raw objects follow retention policy, and
  DNS/runtime rollback never bypasses publication or signing checks.

## 15. Major risks and open questions

1. **Capture geometry semantics.** The accepted Local and Staging matrices cover
   landscape, portrait, letterbox, fullscreen stability, bounded edge movement,
   and terminal unsafe geometry. DPR, zoom, fullscreen, and resize breadth remain
   later compatibility work; every unproven geometry continues to fail closed
   rather than fall back to full-page video.
2. **Chrome tabCapture bitrate and 50 MiB.** Representative short and exact
   90-second captures passed under the accepted 50 MiB MVP ceiling. High-motion
   or higher-resolution inputs can still be larger, so retain the hard ceiling,
   bounded rejection, and operational monitoring rather than silently raising
   the cap.
3. **Audio crackle.** The release gate is accepted: worker-boundary automation,
   blinded listening on two owner-selected devices, real browser capture, and
   exact 90-second Staging playback found no repeatable derivative defect. Keep
   these regressions and reopen causal investigation only if a defect reproduces.
4. **Transcription vendor/cost/privacy.** Staging selected OpenAI `whisper-1`
   behind the reversible adapter, a model allowlist, and a $10 monthly hard
   ceiling. Production authorization, current retention/training terms, regional
   processing, language quality, latency, and ongoing cost remain separate
   operational decisions.
5. **Worker host.** Staging selected immutable, non-root Cloud Run Jobs with
   least-privilege roles and paused schedules. Production provisioning,
   schedule enablement, region, billing, and secret-management policy remain
   separately authorized.
6. **Codec compatibility.** The pinned FFmpeg build produced accepted H.264/AAC
   derivatives from VP8/Opus, VP9/Opus, and audio-only Opus fixtures, including
   owner playback. Broader target-browser compatibility remains a later
   regression concern; unsupported input continues to fail at the private probe
   boundary.
7. **Existing >90-second annotations.** Audit production before validating the
   new target constraint. Decide whether they remain time-code-only legacy pages,
   are shortened with creator consent, or are hidden; never fabricate a hosted
   90-second excerpt from a longer selection.
8. **Handle policy.** Decide whether generated handles are acceptable at launch
   or whether creators must confirm one. Alias reservation prevents link loss in
   either case.
9. **Transcript removal policy.** A transcript may itself be claimed content.
   Default public suppression with media removal is safest; legal/audit retention
   duration requires product counsel.
10. **Signed URL revocation.** A signed URL is bearer access until expiration.
    Keep TTL short, do not cache it, and delete the object during takedown; do not
    promise instantaneous cryptographic revocation.
11. **Extension restart during offline upload.** Cross-restart Blob persistence is
    intentionally out of MVP scope. The UX must say so and preserve the server
    commentary draft while requiring recapture.
12. **Direct-write legacy grants.** Tightening annotation status writes can affect
    existing extension flows. Land and test replacement RPCs in the same phase,
    with article behavior as a regression gate.
