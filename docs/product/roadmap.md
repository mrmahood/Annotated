# Product roadmap

Status: Phase D complete and merged; Phase E increments E1a-E1d complete and
merged, 2026-08-27. D1 and D2 completed their
Local automated gates, owner Chrome acceptance, required CI, bounded Staging
application/regression, exact fixture cleanup, protected squash merges, and
post-merge `main` CI. PR #20 merged D1 as
`50a3f9c38683d46f23991fbbd3ee49d807528a00`; PR #21 merged D2 as
`6f0f1c59acb52d5fb53dcc11dfd446b455ac5f2b`. Staging migration history is
aligned through `20260825120300`, all three worker jobs retain accepted immutable
digest `sha256:220c2a4e23fda65395d712ed2c81154e478ea6d0c271ce6d756ec36eb0c7fe92`,
and both schedules remain paused. Every disposable D1/D2 Local and Staging
fixture was removed and verified at zero. Production was not accessed or
deployed. Phase E planning is defined in
`docs/architecture/phase-e-create-auth-plan.md`. E1a implementation and
deterministic Local validation are complete. PR #23 passed required CI run
`32922199032`, was squash-merged into protected `main` as
`c902c2b8688c8d547cfd471f5ebe325833d22948`, and passed post-merge `main` CI run
`32922631250`. E1b merged through PR #25 as
`9938d36a2e8bb9fbd96aaa4899ded664cdc7c587` after PR CI `32964086959`;
post-merge `main` CI `32965527019` passed. E1c merged through PR #27 as
`50196d283dddec40b1fe8636435adf995f91e093` after PR CI `33002721782`;
post-merge `main` CI `33004543238` passed. E1d merged through PR #29 as
`ac456e072302f3cfecf70c7dfdbfa79e45ad8ace` after PR CI `33135378733`;
post-merge `main` CI `33135718601` passed. E1e and later work remain separately
authorized.

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
environment files were restored. C4, C5, and C6 later closed through the
sequential gates recorded below. Git delivery was completed through protected
PR #18 and post-merge CI; Production access/deployment and schedule enablement
were not authorized.

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

## Phase D — complete

Public annotation delivery and social experience. The detailed implementation
and acceptance sequence is defined in
`docs/architecture/phase-d-public-experience-plan.md`.

### D1. Canonical public annotation pages

- The canonical public URL is
  `https://annotated.cbandcoop.com/{creator-handle}/{annotation-slug}`.
  Annotation slugs remain creator-scoped, so the creator handle is a required
  route segment.
- Retain `/a/{annotation-UUID}` as a compatibility route. It permanently
  redirects to the current canonical URL when a public annotation, creator
  handle, and slug can be resolved safely.
- Reserve framework-owned root segments such as `api`, `auth`, and `_next` from
  creator handles before remote rollout so root-level canonical URLs cannot
  collide with application routes.
- Load public detail data through one trusted, allow-listed server boundary.
  Draft, hidden, removed, and other non-public annotation states must not leak
  through route resolution, metadata, comments, transcripts, or media delivery.
- Preserve article rendering as the regression invariant. Add private
  ready-media playback for hosted video/audio, excerpt-only transcript,
  required creator commentary, creator/source attribution, original links,
  canonical SEO and sharing metadata, comments, and the confidential claims
  entry point.
- Private processed media remains private. A same-origin trusted delivery
  boundary may sign only the authoritative processed path after rechecking
  `annotations.status = published`, `annotation_media.processing_status = ready`,
  and `removed_at is null`. No raw path, full-source transcript, download action,
  or signed URL belongs in public data or logs.

### D2. Annotation voting

- Add authenticated upvote and downvote support for published annotations using
  an additive database design, RLS, and bounded trusted mutations.
- Store at most one vote per authenticated user and annotation. A vote is `+1`
  or `-1`, can change direction, and can be cleared.
- Show separate public upvote and downvote totals without exposing voter
  identities or a readable vote graph.
- Initial votes do not affect feed ordering, recommendation, moderation,
  publication, hiding, removal, claims, or takedown decisions.
- Require published-only eligibility, stable bounded errors, mutation rate
  limits, abuse tests, and article/hosted-media/social regression coverage.

D1 shipped through PR #20 after its Local gate (356/356 pgTAP, 18/18 shared,
98/98 extension, 31/31 web, and 13/13 focused route/playback tests), owner Chrome
acceptance, green required CI, and bounded Staging regression. Its five additive
migrations are applied through `20260824140000`. Canonical/UUID/alias routing,
private ready video/audio delivery, exact 120-second signing, Range playback,
excerpt-only transcripts, removed/private states, discovery, extension links,
comments, follows, claims confidentiality, responsive layout, accessibility,
and privacy passed. Exact cleanup returned all disposable rows, objects, users,
and processes to zero. The bounded hosted fixtures incurred approximately
$0.0016 in `whisper-1` cost; both schedules remained paused.

D2 shipped through PR #21 after its Local gate (440/440 pgTAP, 18/18 shared,
98/98 extension, 42/42 web, concurrency/privacy/abuse, and authenticated HTTP
coverage), owner Chrome acceptance, green required CI, and bounded Staging
regression. Its four additive migrations are applied through
`20260825120300`. Creator self-votes are disallowed; private PostgreSQL fixed-
window limits allow at most 20 mutations per user/annotation and 100 per user
across annotations per 10 minutes. Separate totals, session-derived identity,
same-origin enforcement, create/change/clear, concurrency, HTTP 429 rollback and
recovery, voter privacy, and complete discovery/publication/social/media/worker
isolation passed. Exact cleanup returned all disposable rows, limiter state,
users, sessions, and processes to zero. D2 used no hosted processing or external
provider and cost $0; both schedules remained paused.

The D1 and D2 security reviews found no remaining public path, signed URL,
provider metadata, claimant data, voter graph, limiter state, or usable secret
exposure. One D1 disposable harness emitted an already short-lived processed-
media token into private task output; the object was deleted, the token expired,
and the corrected harness completed without further token output. One D2
diagnostic emitted only five characters following the standard `sb_secret_`
prefix; it was not a complete or usable credential. Optional Staging-secret
rotation remains an owner defense-in-depth decision. No full credential was
printed or persisted.

## Phase E — in progress

Create experience and authentication:

The bounded planning contract is
`docs/architecture/phase-e-create-auth-plan.md`. It records the verified current
source/auth behavior and recommended source, player, transition, and identity
boundaries. E1a's local capability/data contract, page-generation/revision rules,
independent draft state, and regressions are complete and merged through PR #23.
E1b's visible Create UI and independent non-destructive mode transitions passed
owner Chrome acceptance and PR CI run `32964086959`, then merged through PR #25
as `9938d36a2e8bb9fbd96aaa4899ded664cdc7c587`. Post-merge `main` CI run
`32965527019` passed. E1b did not change player discovery/capture, source support,
authentication, or provider configuration. E1c's bounded top-frame player
discovery, explicit selection for two to five candidates, stable page/player
identity, action-time revalidation, and Fox-shaped hidden-media corrections
passed owner Chrome acceptance and PR CI run `33002721782`, then merged through
PR #27 as `50196d283dddec40b1fe8636435adf995f91e093`. Post-merge `main` CI run
`33004543238` passed. E1d's bounded begin/capture/upload/verification/retry/
cancel/Processing/restart guards, safe-default switching, stale-result
isolation, and completed-recorder reconciliation were delivered through PR #29
as `ac456e072302f3cfecf70c7dfdbfa79e45ad8ace`. Required PR CI run
`33135378733` and post-merge `main` CI run `33135718601` passed. Video remained
YouTube-only through E1d; E1e generic webpage video, authentication, and
provider configuration remain separate increments.

- Rename the visible extension tab **Context** to **Create** and add a
  **Text / Video / Audio** switcher at the top of the Create surface.
- Replace mutually exclusive page classification with three separate concepts:
  available modes, recommended mode, and selected mode. Multiple supported media
  types may coexist on one webpage.
- Preserve independent draft state per mode. Warn before abandoning an active
  capture or upload, and preserve the existing honest restart/recovery behavior.
- When a page contains multiple media players, require a bounded player-selection
  experience; never silently choose an arbitrary player.
- With E1c player identity and E1d operation guards merged, add E1e generic webpage
  video support for readable top-frame and same-origin-frame HTML video players.
  Keep inaccessible cross-origin players unsupported. Revalidate frame/player
  identity and top-frame geometry before every action, preserve the article page
  as source identity, and never persist or log ephemeral media delivery URLs.
- Add X.com OAuth 2.0 login alongside Google through Supabase Auth. Test explicit
  web and extension callbacks and adopt a safe account-linking policy. Never
  merge identities based only on display name.
- Retain the accepted capture, private upload, draft-first, processing-status,
  permission, no-host-permission, and article-publication boundaries while the
  Create experience is reorganized.

## Phase F — future

Claims, takedown, and removal:

- Preserve the existing confidential claims, takedown, media-only removal, and
  full-record hiding/removal scope and its forward-only audit/cleanup behavior.
- Votes must not replace, prioritize, automatically trigger, or decide a claim,
  takedown, hiding, publication, or removal action.
- Continue to suppress claimant identity and details from public reads and keep
  processed-media revocation, transcript suppression, comments, and retained
  attribution behavior inside the accepted removal design.

## Phase G — future

Production launch and hardening:

- The Production hostname is `annotated.cbandcoop.com`. `cbandcoop.com` remains
  the consultancy site managed through Lovable and Bluehost WordPress Plus;
  Bluehost is currently the domain/DNS and WordPress hosting authority.
- Do not assume WordPress Plus can host Annotated's trusted Next.js runtime.
  Evaluate that runtime independently, with Google Cloud Run as the first
  candidate because the project already uses Google Cloud.
- Cover DNS, TLS, Supabase web/extension/OAuth callback URLs, cookies, CSP,
  monitoring, alerting, rollback, retention operations, and staged Production
  enablement. Preserve the Chrome/browser/device, zoom/DPR/fullscreen/resize,
  auth/session, retry, privacy, security, and end-to-end regression matrices.
- Production remains blocked until Phase E passes Local, required CI,
  and bounded Staging acceptance. Production access, deployment, schedule
  enablement, DNS/OAuth/vendor configuration, and traffic cutover each require
  their own explicit authorization.

Phase B's automated and owner-performed browser acceptance gates passed. C1-C6
implementation and owner acceptance are complete, and Phase C is formally
closed. Phase D's D1a-D1e canonical public experience and D2a-D2c voting work
are implemented, owner-accepted, applied and regression-tested in bounded
Staging, cleaned exactly, squash-merged through PRs #20 and #21, and verified by
successful post-merge `main` CI runs `32807426242` and `32906492506`. Staging is
aligned through `20260825120300`, both schedules remain paused, and Production
was not accessed or deployed. Phase D is formally closed. Phase E planning is
documented in `docs/architecture/phase-e-create-auth-plan.md`; E1a implementation
and deterministic Local validation are complete. PR #23 passed required CI run
`32922199032`, was squash-merged as
`c902c2b8688c8d547cfd471f5ebe325833d22948`, and passed post-merge `main` CI run
`32922631250`. E1b merged through PR #25 and E1c merged through PR #27 as
`50196d283dddec40b1fe8636435adf995f91e093`; E1c PR CI `33002721782` and
post-merge `main` CI `33004543238` passed. E1d merged through PR #29 as
`ac456e072302f3cfecf70c7dfdbfa79e45ad8ace`; E1d PR CI `33135378733` and
post-merge `main` CI `33135718601` passed. E1e and later implementation,
provider configuration, schedule enablement, Production access, and deployment
remain separately authorized.
Production rollout remains blocked until Phase E
passes its Local, required CI, and bounded Staging gates and later Production
authorization is explicitly granted.
