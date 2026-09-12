# Product roadmap

Status: Phase D complete and merged; Phase E increments E1a-E1e, E2a-E2c,
E3, and the bounded live-X Gate 3 are complete, merged, accepted, and rolled
back in Staging. Phase F F0–F5 implementation is merged on protected `main`;
F6 owner-authorized Staging acceptance is recorded 2026-09-04. Exact Storage
cleanup-to-zero for the media-worker buckets is recorded 2026-09-07/08 after
an owner one-shot of `annotated-media-reconciler-staging` (schedules stayed
paused; Production was not accessed). Updated 2026-09-11. Sprint 1 UI polish
and Sprint 2 YouTube hover linking are merged and owner-accepted on `main`;
Sprint 3 (article/text) hover is implemented on `main`. Sprint 4
(audio/podcast) hover is implemented pending owner Chrome acceptance. Sprint
5 (generic page-video hover; not YouTube `/watch`) is implemented pending
owner Chrome acceptance on a readable HTML5 webpage-video fixture. Generic
webpage-video publication (`video_clip` + article source identity)
remains available but is a niche HTML5 path; owner-authorized Sprint 6
locks hosted capture, Feed cards, and hover to **TikTok watch URLs**
(`source_type = tiktok`, not article) and is implemented on `main`
(squash-merged PR #78). Owner Chrome and Staging acceptance for TikTok
are still required. After TikTok Sprint 6, **Spotify podcast / episode
audio** is implemented on `main` for hosted audio annotation capture;
Create/publish identity and hover remain pending owner Chrome and Staging
acceptance. The Spotify hover promo/outline fix is merged as PR #90. A
separate Create UX follow-on is **typed clip range entry** (keep Set start
/ Set end, and also type start/end such as `1:00`–`2:30`); implemented on
`main`. The Matt-only `/ops` operator console is implemented and merged as
PR #91. Owner Q&A (2026-09-11) **locked** five **Pre–Phase G** product
items before Production on `annotated.cbandcoop.com`: **clip range UI**
first, then the social slice (**Share**, **Bookmark**, **What’s
Trending**, **Who to Follow**). They are not bounty must-haves.
This increment implements the locked **clip range UI**: dual-handle
range, 30s/60s presets from the playhead, preview that stops at end,
and typed start/end as secondary. On long media the slider shows a
few minutes around the current range, with pan and recenter. Set
start / Set end buttons are replaced. Staging acceptance is required before Phase G. Fox / Brightcove /
proprietary cross-origin news-site embeds are **tabled indefinitely**
(Phase G / later-horizon) and are not a mid-September bounty blocker.
X OAuth is out of Sprint 6. Staging-only X
OAuth re-enable for the bounty submit is implemented on `main`; Production
remains separately authorized. D1 and D2 completed their
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
post-merge `main` CI `33135718601` passed. E1e passed Owner Chrome acceptance
and merged through PR #31 as `185d1a386ac374f7a1d9fe56dda97b872553b671`
after PR CI `33230216132`; post-merge `main` CI `33230745060` passed. Fox /
Brightcove / proprietary cross-origin player adapters are tabled indefinitely
(Phase G / later-horizon) and are not a bounty blocker. Generic webpage-video
publication is the niche HTML5/article-backed path on `main`. E2a passed Owner Chrome acceptance and merged through PR #33 as
`83db250f9f07eeb747399546f1138b8503c44781` after PR CI `33259588362`;
post-merge `main` CI `33260246341` passed. E2b passed Owner Local web acceptance
and merged through PR #35 as `617cfdbeee4ebee6feacefa1abeb07775a250663`
after PR CI `33265858275`; post-merge `main` CI `33267265075` passed. E2c passed
Owner Chrome acceptance and merged through PR #37 as
`e398b60b4a05ca98f9772dbab1d65b288e625a4f` after PR CI `33289446000`;
post-merge `main` CI `33289955529` passed. E3 completed combined Local
integration and handoff, including Owner audio-upload acceptance. PR #39 passed
required CI run `33318786049` after checksum-pinned FFmpeg CI recovery, was
squash-merged as `ecee20531c8983c7bf97a80446e0fa66b0b21e78`, and passed
post-merge `main` CI run `33319090870`. Gate 3 passed live web and extension X
acceptance through PR #41 after required CI run `33578556343`, was squash-merged
as `fd5b5ffd7b16220a8bfd5e2e656565146f54e5eb`, and passed post-merge `main` CI run
`33579104948`. The disposable Staging identity and grant were removed, both
user-facing capability opt-ins were disabled, and the Supabase Staging X provider
was disabled with its masked credentials retained. Production was not accessed;
later work remains separately authorized.

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

## Phase E — implementation, Staging acceptance, and rollback complete

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
`33135378733` and post-merge `main` CI run `33135718601` passed. E1e's bounded
top-frame and readable same-origin-frame HTML video support, stable frame/player
identity, authoritative geometry, action-time revalidation, ad exclusion, and
tenth-second range display passed Owner Chrome acceptance. PR #31
passed required CI run `33230216132`, was squash-merged as
`185d1a386ac374f7a1d9fe56dda97b872553b671`, and passed post-merge `main` CI run
`33230745060`. Inaccessible cross-origin players continue to fail closed;
Fox / Brightcove / proprietary cross-origin adapters are tabled
indefinitely (Phase G / later-horizon) and are not a bounty blocker.
Generic webpage-video publication is the niche HTML5/article-backed path
on `main`. E2a's provider-neutral web and extension authentication boundaries,
bounded attempt/provider/callback/session validation, one-attempt handling,
safe cleanup, provider-mismatch rejection, and token-safe errors preserved the
proven Google flow. E2a passed Owner Chrome acceptance and PR CI run
`33259588362`, then merged through PR #33 as
`83db250f9f07eeb747399546f1138b8503c44781`; post-merge `main` CI run
`33260246341` passed. E2b's web-only X OAuth start and callback boundary,
deterministic negative coverage, safe returns, stale-attempt isolation, cleanup,
refresh handling, and token-safe responses passed Owner Local web acceptance.
PR #35 passed required CI run `33265858275`, was squash-merged as
`617cfdbeee4ebee6feacefa1abeb07775a250663`, and passed post-merge `main` CI run
`33267265075`. E2c's extension-only X OAuth and identity-policy boundary remained
behind an explicit disabled-by-default capability, preserved production
permissions and Google behavior, and passed Owner Chrome acceptance. During
acceptance, a shared hosted-media start/status race surfaced in YouTube and Audio;
the correction atomically establishes the new capture's `preparing` state before
status reconciliation, and the bounded Owner retest passed both workflows. PR #37
passed required CI run `33289446000`, was squash-merged as
`e398b60b4a05ca98f9772dbab1d65b288e625a4f`, and passed post-merge `main` CI run
`33289955529`. E3 exercised the completed Create, media, web-authentication, and
extension-authentication boundaries together, reconciled deterministic generated
media evidence and checksum coverage, and made the standalone Local audio
fixture report its ready URL. Owner Local integration and audio-upload acceptance
passed with HTTP 200 from both runtimes, successful upload, authoritative
Processing, and no recurring `Failed to fetch`. PR #39 passed required CI run
`33318786049` after the unavailable pinned FFmpeg autobuild was replaced by an
exact release URL, asset, SHA-256, and verified FFmpeg/FFprobe version. It was
squash-merged as `ecee20531c8983c7bf97a80446e0fa66b0b21e78`; post-merge `main`
CI run `33319090870` passed. Gate 3 then added exact Staging-project plus opt-in
capability gates for the web and extension, corrected the web attempt-cookie
lifecycle and exact extension cancellation callback classification, and retained
Google behavior, provider-neutral checks, token-safe handling, production
fail-closed defaults, and the unchanged extension manifest. Owner acceptance
passed web and extension cancellation/retry, correct-app X sign-in, existing-user
reuse, identity isolation, session restoration, provider-token absence, privacy
checks, sign-out, and signed-out recovery. PR #41 passed required CI run
`33578556343`, was squash-merged as
`fd5b5ffd7b16220a8bfd5e2e656565146f54e5eb`, and passed post-merge `main` CI run
`33579104948`. Cleanup deleted the exact disposable X-only Supabase user after
zero-owned-data verification, revoked only its `Annotated Staging OAuth` grant,
disabled both web and extension capability opt-ins, and disabled only the
Supabase Staging X provider while preserving Google, Site URL, redirects, masked
credentials, and the X application. X is again absent from both user surfaces.
Production was not accessed or deployed. Proprietary Brightcove and other
inaccessible cross-origin player adapters are tabled indefinitely (Phase G /
later-horizon) and are not a mid-September bounty blocker.

- Rename the visible extension tab **Context** to **Create** and add a
  **Text / Video / Audio** switcher at the top of the Create surface.
- Replace mutually exclusive page classification with three separate concepts:
  available modes, recommended mode, and selected mode. Multiple supported media
  types may coexist on one webpage.
- Preserve independent draft state per mode. Warn before abandoning an active
  capture or upload, and preserve the existing honest restart/recovery behavior.
- When a page contains multiple media players, require a bounded player-selection
  experience; never silently choose an arbitrary player.
- E1e added generic webpage video for readable top-frame and same-origin-frame
  HTML video players. It revalidates frame/player identity and top-frame geometry
  before each action, preserves the article page as source identity, excludes
  transient advertising media, and never persists or logs ephemeral media
  delivery URLs. Inaccessible cross-origin players remain unsupported pending a
  separately authorized player-adapter contract. Generic webpage-video
  publication is the later article-backed hosted begin increment on this
  branch: `video_clip` on the existing article source, same capture →
  upload → Processing → ready path as YouTube/audio. Fox / Brightcove /
  proprietary cross-origin adapters remain out of that increment and are
  tabled indefinitely (Phase G / later-horizon).
- E2a placed existing Google sign-in behind provider-neutral web and extension
  boundaries with bounded attempt, callback, provider, session, retry, cleanup,
  and token-safe error handling. It did not display, execute, or configure X.
- E2b added the web-only X OAuth start and callback path behind an explicit
  disabled-by-default capability. E2c added the equivalent bounded extension
  boundary and identity-array verification without changing production
  permissions. Gate 3 exercised both capabilities only against the exact
  Supabase Staging project, then removed their opt-ins and disabled the Staging
  provider. The later bounty increment re-enables that Staging-project
  capability; see `docs/product/x-oauth-staging-reenable.md`. Identities are
  never merged based only on display name.
- Retain the accepted capture, private upload, draft-first, processing-status,
  permission, no-host-permission, and article-publication boundaries while the
  Create experience is reorganized.

## Phase F — F6 Staging acceptance recorded; implementation accepted

Claims, takedown, and removal. The bounded plan is
`docs/architecture/phase-f-claims-removal-plan.md`. F0–F5 implementation is
merged on protected `main`. F6 owner-authorized Staging acceptance is recorded
below, including 2026-09-07/08 exact Storage cleanup-to-zero for the
media-worker buckets. Production was not accessed; GCP media dispatcher
and reconciler schedules remain paused.

F0 was merged through PR #43. F1a published-target claim intake is on `main` as
`7ccd615f51a5359d5ef002a175063854a94ca787` (PR #44). F4 media-only withdrawal is
on `main` (PR #45): append-only `private.moderation_audit`, a service-only
`moderate_media_only_withdrawal` RPC, transcript content-clear with metadata
retention, fail-closed signing, and a Bearer + allowlist trusted route at
`/api/moderation/media-only-withdrawal`. F2 is Matt-only claim review on `main`
as `e4a96f293daf9b10a35b47e9966e87f25da61bcc` (PR #50): service-only
list/get/update RPCs, locked routes at `/api/moderation/claims`, confirmation
phrase `CLAIM_REVIEW_UPDATE`, default PII suppression, and no admin UI. F3 is
Matt-only hide/unhide on `main` as
`f8c1b9ad6325842002d119da19895343cd544251` (PR #51): service-only
`moderate_annotation_hide` / `moderate_annotation_unhide`, additive
`private.moderation_audit` actions, and locked routes at
`/api/moderation/annotations/{id}/hide` and `.../unhide` (confirmation phrases
`ANNOTATION_HIDE` / `ANNOTATION_UNHIDE`). F5 is Matt-only full-record remove on
`main` as `892bab9e00c230f1cc7c81bef1dd426785101088` (PR #52): service-only
`moderate_annotation_remove`, `annotations.status → removed` from `published`
or `hidden`, F4 media-revoke when still playable, transcript content-clear,
optional F2 claim resolve (`reviewing → resolved`), and a locked route at
`/api/moderation/annotations/{id}/remove` (confirmation phrase
`ANNOTATION_REMOVE`). Public projections continue to require `published`.
Removed records cannot be unhidden. F5 does not reimplement F3 hide/unhide or
F4 media-only withdrawal. Post-merge `main` CI for F5 passed as run
`33871653061`.

Staging Supabase `nkkunkwirvfwhmpwonqz` applied
`align_derivative_duration_slack`, `phase_f4_media_only_withdrawal`,
`phase_f1a_claim_publish_target`, `phase_f2_claim_review`,
`phase_f3_hide_unhide`, and `phase_f5_full_record_remove`. Production Supabase
was not touched.

Staging env ops on the annotated-staging Vercel Production project added
`SUPABASE_SERVICE_ROLE_KEY` (this fixed playback `SERVER_MISCONFIGURED`),
`ANNOTATED_MODERATION_OPERATOR_IDS=3e3882b6-7c94-46aa-9a6d-583b734536e2`, and
`ANNOTATED_MODERATION_OPERATOR_EMAILS=cbandcoop@gmail.com`. Owner verified that
playback for a withdrawn clip returns `{"error":"MEDIA_UNAVAILABLE"}`, not
`SERVER_MISCONFIGURED`.

Bounded Staging acceptance used the owner-published `geaux tigers` fixture:
annotation `0f993576-9bae-44f0-a098-2532b448ca18`, media
`9c8db8d9-7b53-4e35-99c2-b301cd9e49b9`, owner Google profile
`3e3882b6-7c94-46aa-9a6d-583b734536e2` (`cbandcoop@gmail.com`). Proven sequence
(owner Chrome / Staging HTTP + earlier RPC):

1. Published hosted clip with player and transcript (owner verified).
2. F4 media-only withdraw (RPC): web and extension showed Excerpt unavailable;
   the annotation stayed published; transcript content cleared; audit
   `media_only_withdrawal` / `withdrawn`.
3. F2 HTTP `GET /api/moderation/claims` returned 200 with 3 claims (PII omitted
   by default).
4. F2 HTTP: claim `1363c5ba-56d6-4f23-9278-22fe15c2c3b5`
   `submitted→reviewing` with `CLAIM_REVIEW_UPDATE` returned 200; audit id
   recorded.
5. F3 HTTP: hide then unhide the same annotation with `ANNOTATION_HIDE` /
   `ANNOTATION_UNHIDE` returned 200 `hidden` then `unhidden`.
6. F5 HTTP: remove the same annotation with `ANNOTATION_REMOVE` returned 200
   `resultCode: removed`; audit `annotation_remove` / `removed` at 2026-09-04
   ~14:48 UTC.

F6 Staging follow-up (2026-09-07/08) and remaining out-of-close notes:

- Exact Storage cleanup-to-zero for the media-worker buckets is **done**.
  The owner ran a one-shot `annotated-media-reconciler-staging` execution
  (not permanent schedule enablement) while dispatcher/reconciler
  schedules stayed paused. Outcome: `annotation-media` holds only the 5
  ready/published excerpts; `annotation-media-raw` is empty; no
  reconciliation candidates remain; removed rows have null storage paths.
  Legacy `annotation-audio` still has 4 pre-pipeline objects (out of
  media reconciler scope) — optional follow-up, not blocking F6
  cleanup-to-zero. Production was not accessed. Schedules remain paused.
- Votes isolation is covered by existing pgTAP (`phase_d2c_voting_isolation`
  and Phase F tests on `main`); no Staging vote-driven moderation was observed.
- The full `AGENTS.md` local release gate was not re-run on an agent machine.
  Required GitHub CI green on `main` (pgTAP + web unit), including F5
  post-merge run `33871653061`, is the recorded automated evidence.

Durable Phase F product rules remain:

- Preserve the existing confidential claims, takedown, media-only removal, and
  full-record hiding/removal scope and its forward-only audit/cleanup behavior.
- Votes must not replace, prioritize, automatically trigger, or decide a claim,
  takedown, hiding, publication, or removal action.
- Continue to suppress claimant identity and details from public reads and keep
  processed-media revocation, transcript suppression, comments, and retained
  attribution behavior inside the accepted removal design.

## Near-term after Phase F

Phase F implementation, owner-authorized Staging acceptance, and
2026-09-07/08 exact Storage cleanup-to-zero are recorded above. The next
product work is not Phase G. Default recommendation, unless the owner
pulls an item forward: remaining **extension UI polish** (owner Chrome
acceptance where still pending) and **X OAuth re-enable for the
mid-September bounty submit**. Owner Q&A (2026-09-11) **locked** five
**Pre–Phase G** items so they land before Production on
`annotated.cbandcoop.com`: clip range UI first, then the social slice;
see Pre–Phase G below. They are not bounty must-haves. Staging
acceptance is required before Phase G. Fox / Brightcove / proprietary
cross-origin news-site embeds are tabled indefinitely and are not in
this near-term sequence. Phase G Production launch and hardening remain
separately authorized.

- **Extension UI polish / minimalist redesign.** Sequenced after Phase F per
  the locked September sequence in
  `docs/architecture/phase-f-claims-removal-plan.md`. The owner-approved
  brief is `docs/design/ui-polish-brief.md`. Sprint 1 and Sprint 2 are
  **done** (implemented, merged, and owner-accepted on `main`). All media
  hover highlights (YouTube `/watch`, article/text, audio/podcast, and
  generic page-video) live on this roadmap. Sprint 3 is implemented on
  `main`. Sprint 4 and Sprint 5 are implemented pending owner Chrome
  acceptance. Sprint 6 (TikTok hosted capture/publish + Feed Video
  cards + hover) is implemented on `main` (squash-merged PR #78)
  pending owner Chrome and Staging acceptance. After TikTok Sprint 6,
  Spotify podcast / episode audio is the next platform priority.
  Visual grammar reuses Sprint 2 (outline + light page dim, ~120 ms
  leave debounce). Sprint 2 remains YouTube `/watch` only; generic
  page-video is Sprint 5 and does not replace that path. TikTok uses a
  first-class YouTube-parallel identity (`tiktok`), not the
  article/webpage-video RPC. Those later slices still fail closed and
  must not chase brittle host-specific piercing.
  - **Sprint 1 (done).** Dark-first tokens, the Create-mode segmented
    switch, and nested annotation cards (extension Feed + public web).
    Merged as PR #56.
  - **Sprint 2 (done).** Extension YouTube `/watch` hover linking: when
    the connected tab is the annotation’s watch source, hovering
    card/commentary paints the player with outline + light page dim via
    on-demand `activeTab` / `scripting` injection. Light-DOM best-effort
    (wrapper, not native player chrome); fail closed off-source and on
    non-`/watch` YouTube URLs. YouTube-only was intentional for this
    slice. Merged as PR #61.
  - **Sprint 3 — article / text selection hover linking** (extension;
    separately authorized). When the connected tab is the annotation’s
    article source, hovering card/commentary paints the matched text
    range (or a safe wrapper) with outline + light page dim (~8–12%).
    Debounce leave ~120 ms. Fail closed when the tab is not that article
    source. No persistent content scripts.
  - **Owner-authorized host access (2026-09-05).** Matt authorized
    `host_permissions` for `http://*/*` and `https://*/*`, plus `tabs`,
    so Feed **Open source** can apply the amber highlight on the opened
    article tab after load without a toolbar click, and so a kept-open
    side panel follows the active tab (Create / on-this-source / hover)
    while surfing. Amber is the Open source source of truth. Persistent
    content scripts remain forbidden. See
    `docs/design/ui-polish-brief.md` §5.3.
  - **Sprint 4 — audio / podcast hover linking** (extension;
    implemented; owner Chrome acceptance still required). When the
    connected tab is the annotation’s audio/podcast source page
    (normalized URL + podcast `source_type`), hovering card/commentary
    scrolls to and paints the active player / scrubber with outline +
    light page dim. Prefer a time-range overlay when clip bounds and a
    visible scrubber are known; otherwise highlight the player chrome.
    Soft hover does not seek or play. Open source writes a pending
    highlight applied on tab complete / surf-follow. Fail closed
    off-source, on identity mismatch, or when no safe player target
    exists. Same permissions; no persistent content scripts.
  - **Sprint 5 — generic page-video hover linking** (extension;
    implemented; owner Chrome acceptance still required). When the
    connected tab is the annotation’s non-YouTube video source page
    (news/HTML5/embed chrome; article-page source identity), hovering
    a Video card scrolls to and paints the active player / chrome with
    outline + light page dim. Prefer a time-range overlay when clip
    bounds and a visible scrubber are known; otherwise highlight the
    player chrome. Soft hover does not seek or play. YouTube `/watch`
    stays on the Sprint 2 path. Article and audio hover on the same
    URL are not stolen. Open source writes a pending highlight applied
    on tab complete / surf-follow. Fail closed off-source, on identity
    mismatch, or when no safe player target exists. Webpage-video
    hosted publish is implemented as an article-backed `video_clip`
    begin RPC plus Feed/detail projection; owner Staging acceptance
    still needs a readable HTML5 fixture. Same permissions; no
    persistent content scripts; no host-specific selectors. Fox /
    Brightcove / proprietary cross-origin news-site embeds are tabled
    indefinitely (Phase G / later-horizon) and are not a bounty blocker.
  - **Sprint 6 — TikTok hosted capture, publish, Feed cards, and hover**
    (extension + web + additive Staging RPC; implemented on `main` via
    squash-merged PR #78; owner Chrome and Staging acceptance still
    required). After concluding readable HTML5 webpage-video is too
    rare for real demos, and after confirming TikTok is the
    post-YouTube watch leader with serious news inventory, Matt
    authorized locking Sprint 6 to TikTok (2026-09-05). Mirror the
    YouTube path: stable watch URL
    `https://www.tiktok.com/@handle/video/<id>` (mobile/share variants
    normalize to that); Create → Video on a connected TikTok watch tab;
    1–90 s tabCapture through the existing hosted pipeline;
    `begin_hosted_tiktok_annotation` → draft `video_clip` + media
    `capture_pending` → upload → Processing → ready/published;
    Feed `kind: tiktok` distinct from YouTube and from webpage
    `video_clip` + article. Hover when the connected tab is that watch
    URL: scroll + outline/dim player chrome; soft hover must not
    re-seek or hijack playback; ~120 ms leave debounce; Open source
    pending like audio/page-video. Fail closed on For You, live,
    photos, `vm`/`vt`/`t` short links, login walls, DRM, and when
    identity or player chrome cannot be confirmed. Desktop
    `tiktok.com` watch URLs only for v1. Webpage HTML5 publish remains
    the niche article-backed path. Fox / Brightcove / proprietary
    cross-origin news-site embeds are tabled indefinitely (Phase G /
    later-horizon) and are not in this increment or the bounty submit.
    No X OAuth in this increment.
    Staging migration: `20260905221500_begin_hosted_tiktok_annotation`.
    Do not touch Production. Do not unpause Cloud Run.
  - **After Sprint 6 — Spotify podcast / episode audio** (implemented
    on `main`; hover promo/outline fix merged as PR #90). Owner
    authorization (2026-09-05/06): first-class
    `source_type = spotify` and `begin_hosted_spotify_annotation`, not
    reuse of generic `podcast`. Stable episode URL identity
    (`https://open.spotify.com/episode/<id>` and common variants).
    Create → Audio on a connected episode tab; 1–90 s; proven
    `tabCapture → offscreen → MediaRecorder` audio-only path of
    what that tab can already play (logged-in listen or a logged-out
    limited preview that is already audible). Public playback is
    Annotated's hosted derivative, not a live Spotify embed.
    Feed card `kind: spotify`. Hover highlights the now-playing bar
    (PR #90 keeps the outline on the player bar rather than a
    promotional tile). Fail closed on home, search, show-only, login
    walls that cannot play, DRM, and unreadable / off-start player
    time. DRM and stream-URL scraping stay out of scope. Owner Chrome
    and Staging acceptance remain required. Fox / Brightcove /
    proprietary cross-origin news-site embeds are not the next
    platform after Spotify; they are tabled indefinitely (Phase G /
    later-horizon) and are not a bounty blocker.
    Staging migration: `20260906031846_begin_hosted_spotify_annotation`.
    Owner apply/verify notes: `docs/product/spotify-episode-capture.md`.
    Do not touch Production. Do not unpause Cloud Run.
- **Voice commentary on Video + Audio Create** (this increment; owner
  Chrome and Staging acceptance still required). The existing Text
  Create `AudioRecorder` / `annotation-audio` stack is the commentary
  contract everywhere: typed text, a recorded voice clip, or both;
  Publish stays disabled with neither. Video Create (YouTube / TikTok /
  webpage video) and Audio Create (Spotify / podcast / page-audio) show
  the same mic under Your commentary. Hosted drafts attach voice
  through `attach_owner_annotation_audio` before capture. Do not
  confuse this with Create-mode Audio **media**.
- **Watch-page Audio media from #94 is reverted.** When a page has
  video, Create-mode Audio is unavailable again (YouTube, TikTok, and
  webpage-video-only tabs). Audio **media** stays for Spotify /
  podcast / page-audio only. Text + Video coexistence on the same URL
  remains. Database source coexistence for the same URL is unchanged;
  the extension no longer offers or captures `youtube-audio` /
  `tiktok-audio` / `web-video-audio`. Hosted clips remain 1–90 s. No
  Production access; do not unpause Cloud Run. Staging migration:
  `20260909014932_commentary_voice_or_text`.
- **Typed clip range entry** (Create UX follow-on for Video and Audio;
  implemented on `main`). Owner side note (2026-09-05): in
  addition to **Set start** and **Set end**, the user can **type**
  start and stop times (examples: start `1:00`, end `2:30`). Keep the
  existing Set start / Set end buttons. Direct text fields accept
  common human formats such as `m:ss` and `h:mm:ss`. Validate against
  the connected clip’s bounds and the product max (hosted ranges
  1,000–90,000 ms; duration 1–90 s). Set start / Set end remain
  alternate paths and stay in sync with the typed fields. Applies to
  YouTube, TikTok, Spotify episode, podcast / audio, and webpage
  video/audio as those paths exist.
- **Clip range slider** (Pre–Phase G clip range UI; Video + Audio
  Create; implemented in this increment). Dual-handle range slider
  replaces Set start / Set end entirely per the locked Pre–Phase G
  contract. Preset buttons **30s** and **60s** set a window from the
  current playhead forward, clamped to media duration and the
  90-second product ceiling. Handles snap to whole seconds. Chrome
  shows a start/end timecode readout and remaining-to-90 budget.
  Publish stays disabled until a valid ≤90s range exists. Preview
  plays only the selected range on the host player and stops at the
  end; native page controls still work. Typed `m:ss` / `h:mm:ss`
  fields remain as secondary input and stay in sync with the slider.
  On media longer than four minutes the track zooms to a ~240s window
  around the selection (or playhead); the user can pan and recenter.
  Applies to YouTube, TikTok, Spotify episode, podcast / audio, and
  webpage video/audio. Not Text Create. See Pre–Phase G below.
- **Re-enable X OAuth** on the user-facing web and extension surfaces before
  the mid-September bounty submit. Owner-authorized 2026-09-05/06. This
  increment turns the existing E2b/E2c/Gate 3 Staging capability back on
  when the app points at exact Staging project `nkkunkwirvfwhmpwonqz`.
  Production and Local stay fail-closed. The OAuth start/callback,
  attempt-cookie, and identity-policy boundaries are unchanged. Owner
  checklist for the Staging provider, X Developer Portal, and callback
  URLs: `docs/product/x-oauth-staging-reenable.md`. Production X remains
  separately authorized.
- **Exact Storage cleanup-to-zero** for the media-worker buckets is
  **done** (2026-09-07/08). Owner ran one-shot
  `annotated-media-reconciler-staging` (not permanent schedule
  enablement). `annotation-media` holds only the 5 ready/published
  excerpts; `annotation-media-raw` is empty; no reconciliation
  candidates remain; removed rows have null storage paths. Legacy
  `annotation-audio` still has 4 pre-pipeline objects (out of media
  reconciler scope) — optional follow-up, not blocking F6
  cleanup-to-zero. Production was not accessed. Dispatcher and
  reconciler schedules remain paused. Details are in the Phase F
  section above.
- **Minimal Matt-only operator console** (implemented and merged as
  PR #91; not a broad admin UI). Single allowlisted operator UI at
  `/ops`; reuses existing
  `/api/moderation/*` routes; no new privileges beyond
  `ANNOTATED_MODERATION_OPERATOR_*`. No public nav or Feed link. Non-allowlisted
  sessions, including anonymous visitors, receive `notFound()`. Owner Staging
  acceptance is still required. Shipped sketch:
  - Route in `apps/web` at `/ops` with no public nav link. Server Component
    gate: if the session user is not on the allowlist, `notFound()` (do not
    403 with a useful probe).
  - Claim queue tab: table of open claims via `GET /api/moderation/claims`;
    row click opens detail; optional “Show claimant PII” toggle with
    `includeClaimantPii=true`; Reviewing / Resolve / Reject with typed
    confirm `CLAIM_REVIEW_UPDATE` and optional operator notes.
  - Annotation tools tab: annotation UUID (optional media/claim ids). Buttons
    wired to existing routes only: media-only withdraw
    (`POST /api/moderation/media-only-withdrawal`, `MEDIA_ONLY_WITHDRAW`);
    hide / unhide (`.../hide` / `.../unhide`, `ANNOTATION_HIDE` /
    `ANNOTATION_UNHIDE`); full remove (`.../remove`, `ANNOTATION_REMOVE`).
    Each action requires typing the confirmation phrase in the UI before
    enable.
  - Out of scope: multi-operator RBAC, public appeals, email, analytics
    dashboards, editing claims content, Production-only features.
- **Phase G Production launch and hardening** remains a separate phase with
  its own authorization; it is not the next increment after F. Owner Q&A
  (2026-09-11) locked **clip range UI**, then the **social slice**,
  before this phase. They are not bounty must-haves. Staging acceptance
  is required before Phase G. Fox / Brightcove / proprietary
  cross-origin news-site embeds live on that later-horizon, not in the
  mid-September bounty sequence.

## Pre–Phase G — locked

Owner Q&A completed 2026-09-11. These items land **before Phase G**
(Production on `annotated.cbandcoop.com`). Sequence: **clip range UI
first**, then the **social slice**, then Phase G. They are not
mid-September bounty must-haves. This section locks the product
contract; it does not authorize Staging apply or Production. Clip
range UI is implemented in this increment (owner Chrome acceptance
still required). **Share v1** (in-ecosystem reshare) is implemented in
this increment; Bookmark / What’s Trending / Who to Follow remain
unimplemented. Staging
acceptance is required before Phase G. Hosted
range limits remain 1,000–90,000 ms. Article publication, draft-first
hosted media, and the accepted capture/upload pipeline are unchanged.

### Clip range UI (extension Create) — ship first

Implemented in this increment. Replace **Set start** / **Set end**
**entirely**. No fallback start/end buttons.

- Dual-handle **range** slider; max span **90s**.
- Preset buttons **30s** and **60s**: place a window from the **current
  playhead forward**, then the user adjusts handles side-to-side.
- Applies to **Video Create and Audio Create** (Spotify / podcasts).
- Extension **Preview play**: seeks and plays **only the selected
  range** in the connected browser tab and **stops at end**. Native
  YouTube / audio controls remain normal; the selected range stays
  marked on the page.
- Chrome: start/end **timecode readout**; **snap to whole seconds**;
  **remaining-to-90** indicator; **disable Publish** until a valid
  ≤90s range is set.
- Long media (owner 2026-09-12): the slider track shows only a **few
  minutes around the current range**, not the full episode. The user
  can **pan** the window and **recenter** on the selection or
  playhead. Short media keeps the full timeline.

### Social slice — ship second (after clip UI)

**Share an annotation.** Locked 2026-09-12. In-ecosystem **reshare**
onto the signed-in user’s Annotated feed. Requires an Annotated
profile / auth. Optional **plain-text comment on the reshare row** —
not a new annotation. Surfaces: **web + extension**, control on
**Feed cards and detail**. Users **may reshare their own** published
annotations. Users **may reshare reshares** (nested). Uniqueness is
**at most one reshare per user per target annotation** (the immediate
target row). Owner can **remove / unshare** later. Followers may see
the share in their signed-in feed (home timeline mixes published
annotations with reshares from the viewer and followed profiles;
anonymous home stays annotation-only; profile timelines include that
actor’s reshares). **Not** copy-link, Web Share API, or X intent for
v1. Bookmark / What’s Trending / Who to Follow are separate later
PRs.

**Bookmark an annotation.** **Private** for the signed-in user only.
If logged out, prompt Google / X sign-in. Flat list on **Me**. No
folders and no public save counts in v1.

**What’s Trending.** **Web Feed homepage section**. **7-day** window.
v1 score: `3×comments_7d + 2×unique_commenters_7d + 2×follows_on_author_7d + 1×reshares_7d + recency_boost (~48h half-life) + manual /ops boost`.

**Max one card per author.** No new view-telemetry for v1. Production
or demo may need seeded demo data.

**Who to Follow.** **Curated** placeholders (X-lookalike) until the
accounts exist; resolve when they sign in with that X identity.
Seeds: **@jason** (Jason Calacanis), **@davidscornik**, **@chamath**,
**@friedberg**, plus **Matt** when a public Annotated / X profile
exists.

## Phase G — future

Production launch and hardening. Locked Pre–Phase G items above (clip
UI first, then the social slice) land first per owner Q&A (2026-09-11);
this phase remains separately authorized. Staging before Phase G.

- The Production hostname is `annotated.cbandcoop.com`. `cbandcoop.com` remains
  the consultancy site managed through Lovable and Bluehost WordPress Plus;
  Bluehost is currently the domain/DNS and WordPress hosting authority.
- Chrome Web Store is the end-user update channel for the extension. Staging
  stays load-unpacked. Operator checklist:
  `docs/product/extension-release-versioning.md`.
- Do not assume WordPress Plus can host Annotated's trusted Next.js runtime.
  Evaluate that runtime independently, with Google Cloud Run as the first
  candidate because the project already uses Google Cloud.
- Cover DNS, TLS, Supabase web/extension/OAuth callback URLs, cookies, CSP,
  monitoring, alerting, rollback, retention operations, and staged Production
  enablement. Preserve the Chrome/browser/device, zoom/DPR/fullscreen/resize,
  auth/session, retry, privacy, security, and end-to-end regression matrices.
- **Fox / Brightcove / proprietary cross-origin news-site embeds** are
  tabled indefinitely on this later-horizon. Owner directed (2026-09-07/08)
  that they are not needed for the mid-September bounty submit and are not
  the next platform after Spotify. Readable HTML5 webpage-video remains the
  niche article-backed path; opaque news-site players continue to fail
  closed until a separately authorized Phase G (or later) adapter contract.
- Phase E has passed Local, required CI, bounded Staging acceptance, exact
  cleanup, and reversible rollback. Production access, deployment, schedule
  enablement, DNS/OAuth/vendor configuration, and traffic cutover each still
  require their own explicit authorization.

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
post-merge `main` CI `33135718601` passed. E1e passed Owner Chrome acceptance
and merged through PR #31 as `185d1a386ac374f7a1d9fe56dda97b872553b671`;
E1e PR CI `33230216132` and post-merge `main` CI `33230745060` passed.
E2a passed Owner Chrome acceptance and merged through PR #33 as
`83db250f9f07eeb747399546f1138b8503c44781`; E2a PR CI `33259588362` and
post-merge `main` CI `33260246341` passed. E2b passed Owner Local web acceptance
and merged through PR #35 as `617cfdbeee4ebee6feacefa1abeb07775a250663`;
E2b PR CI `33265858275` and post-merge `main` CI `33267265075` passed. E2c passed
Owner Chrome acceptance and merged through PR #37 as
`e398b60b4a05ca98f9772dbab1d65b288e625a4f`; E2c PR CI `33289446000` and
post-merge `main` CI `33289955529` passed. E3 passed Owner Local integration and
audio-upload acceptance, required PR CI `33318786049`, and post-merge `main` CI
`33319090870`; PR #39 was squash-merged as
`ecee20531c8983c7bf97a80446e0fa66b0b21e78`. Gate 3 passed Owner web and
extension live-X Staging acceptance, PR CI `33578556343`, squash merge
`fd5b5ffd7b16220a8bfd5e2e656565146f54e5eb`, and post-merge `main` CI
`33579104948`; exact disposable-user/grant cleanup and reversible capability/
provider rollback then passed. X user-facing Staging re-enable is implemented in this increment;
the Supabase Staging provider and X Developer Portal remain owner
manual steps in `docs/product/x-oauth-staging-reenable.md`. Fox /
Brightcove / proprietary cross-origin news-site embeds are tabled
indefinitely (Phase G / later-horizon) and are not a bounty blocker.
Schedule enablement, Production access, and deployment remain separately
authorized. Generic webpage-video publication remains the niche
HTML5/article-backed path. Sprint 6 TikTok hosted capture/publish is
the owner-authorized demo path for hosted watch pages after YouTube.
Phase E has passed its Local, required CI, and bounded Staging gates. Production
rollout still requires its own explicit authorization. Phase F F0–F5 are merged
on `main`; F6 owner-authorized Staging acceptance is recorded in the Phase F
section. Exact Storage cleanup-to-zero for the media-worker buckets is
recorded 2026-09-07/08 after a one-shot `annotated-media-reconciler-staging`
run. Production was not accessed; worker schedules remain paused. Legacy
`annotation-audio` objects remain an optional follow-up, not an F6
cleanup-to-zero blocker. Owner Q&A (2026-09-11) locked five Pre–Phase G
items (clip range UI first, then Share / Bookmark / What’s Trending /
Who to Follow) so they land before Production on
`annotated.cbandcoop.com`; they are not bounty must-haves. Staging
before Phase G.
