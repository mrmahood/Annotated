# Phase C C6 Staging runtime

Status: C6 Local validation, Staging lifecycle/recovery, codec, geometry,
exact-duration, transcript, and owner media-quality gates passed, including the
risk-based Gate 5d audio-crackle acceptance, 2026-08-23. Schedules remain paused
pending review. Draft PR #18's lower-duration migration is present on exact
Staging through `20260823235900`; immutable worker digest
`sha256:cc920050b6699e3c4ff543f5910ea901a352dd2919c6061f4aa0f4dfdd40449f`
passed the bounded corrective VP8/Opus lifecycle and cleanup. Later cleanup-v2,
processed-bucket, resumable-recapture, removed-state, and processed-only
terminal-retention corrections pass Local validation but have not been applied
to Staging. This record covers only the Staging boundary.
Production deployment and merge remain prohibited.

Gate 5a, the exact 90,000 ms audio boundary, is accepted. A
repository-owned runner now fails closed on the branch, Supabase ref, Production
link state, Google account/project, paused schedules, and immutable worker
digest before it can seed or invoke anything. Its synthetic raw fixture carries
spoken markers at 0, 30, 60, and 85.5 seconds over a quiet continuous tone. The
first attempt reached the provider and retained its private derivative for a
bounded corrective retry; that exact recovery, the subsequent clean
first-attempt rerun, and owner playback all passed. The codec and geometry
matrices followed, and crackle was the final acceptance slice. The codec Local slice
passes supported VP9/Opus, VP8/Opus, and audio-only Opus conversions
plus fail-closed malformed, wrong-container, missing-stream, and unsupported
Vorbis cases. The repository-owned runner then exercised the missing positive
VP8/Opus Staging lifecycle against the current immutable worker. Its first
attempt, transcript, raw deletion, publication, sanitized logs, and exact
cleanup passed. Owner playback passed at `00:09` with smooth motion, clear
speech, steady tone, balanced channels, clean ending, and no crackle, clicks,
warble, dropouts, or notes. Gate 5b is accepted. The codec gate did not apply a
migration, replace the image,
resume schedules, or access Production.

Gate 5c is accepted. Its 33/33 media-core and eight static/container checks
cover accepted landscape, portrait, and letterbox crops, exact one-CSS-pixel
edge/movement tolerance, stable fullscreen and capture-track facts, and six
unsafe cases that create no derivative. The matrix found and fixed a validation
ordering defect at exactly `-1` CSS pixel while retaining fail-closed behavior
beyond that tolerance. The geometry correction was deployed by immutable digest
with both schedules paused. The prepared remote matrix is portrait, letterbox,
and one terminal partial-visibility rejection. It requires no database
migration.

After the corrected digest was deployed, the portrait matrix case passed raw
generation, empty preflight, private upload, and dispatch. Attempt one staged
the portrait derivative, then stopped safely at `transcribing` /
`transcript_invalid`; at that checkpoint, the annotation remained draft with a
database-owned retry and no lease. The runner retained that exact fixture and
did not start the letterbox or unsafe cases until the repository-owned text-free
structural diagnostic ran against the checksum-matched derivative. That
diagnostic passed: OpenAI returned
HTTP 200, nonblank text, four ordered nonblank segments, and a final end of
10,160 ms for the exact 9,000 ms derivative. The sole failure is 1,160 ms of
provider timestamp tail drift. The checksum-matched derivative was retained
without dispatching a retry, then reused and cleaned during the accepted
continuation recorded below.

The bounded 2,000 ms final-tail correction passes focused source tests and
read-only, no-network container probes while rejecting starts outside the
excerpt and tails beyond the bound. The pinned non-root image is
`sha256:f4b101880bbdf77784769f82fe5055261537f0fb6f868252b3891eb687d7b057`.
It passed its runtime probes, was pushed by checksum-derived tag, and all three
Staging jobs were updated to that exact immutable digest. No execution occurred during
deployment. Exact retained-portrait recovery and the remaining letterbox and
terminal unsafe cases then ran with both schedules paused and Production
untouched.

The automated continuation passed. Portrait recovered on attempt two with the
exact 531,109-byte derivative and checksum reused, four transcript segments
bounded to 9,000 ms, raw deletion confirmation, publication, the expected
five-event resume sequence, and exact cleanup. Letterbox passed on attempt one
with a 9,000 ms 426x240 derivative, transcript, six-event lifecycle, and exact
cleanup. Partial visibility then failed closed at terminal attempt three as
`transcoding` / `unsafe_geometry`: the annotation remained draft, no transcript
or processed object/facts existed, and raw was retained only until controlled
cleanup. The queue and all fixture objects/rows returned to zero. Owner playback
of both exported 9-second artifacts passed: crop/no-magenta-border, smooth
motion, clear speech, steady tone, channel balance, and clean ending all passed,
with no crackle, clicks, warble, dropouts, or notes. Gate 5c closed, and Gate 5d
audio-crackle followed.

Gate 5d is Local-first and causal. Its initial worker-boundary matrix generated
three independent 90-second samples for each of audio-only Opus 64 kbps,
VP9/Opus 64 kbps, and VP8/Opus 96 kbps, then compared each exact decoded raw
excerpt with its final AAC derivative. All 9/9 pairs passed exact duration,
channel balance, discontinuity, near-zero-run, and 20 ms window-energy checks.
Across all samples, raw/derivative maximum adjacent steps were 397/476 of 32,768,
large-step count was zero, maximum near-zero run was two samples, maximum channel
RMS ratio was 1.001346/1.000927, and minimum-to-median window RMS ratio was
0.989476/0.864310. The owner then completed the three blinded 90-second
raw-versus-derivative WAV pairs on two distinct output devices. Both A and B
passed all pairs, neither was judged worse, and tone, channel balance, and clean
endings passed. Device names were withheld by owner choice. After recording the
result, the mapping was revealed: pairs one and three presented raw as A, while
pair two presented the derivative as A. No repeatable worker-derivative defect
was observed. No network, database, provider, container, or deployed job was
used. The Local browser capture causal matrix followed.

The Local capture scaffold was implemented without weakening the hosted
metadata contract. A build-time configuration is accepted only when both the
web app and collector are localhost HTTP origins. With no collector configured,
the compiled production defaults remain loopback enabled, 1,000 ms timeslicing,
automatic codec preference, and browser-default bitrates. Diagnostic captures
use the real tabCapture/offscreen/MediaRecorder path but terminate at a bounded
localhost collector before authorize/upload/complete. This is required because
loopback-disabled metadata must continue to fail the normal worker contract.
The six one-factor variants are VP9 default, loopback off, no timeslice, VP8
default, VP9 explicit bitrate, and VP8 explicit bitrate, capped at three raw
captures per variant. The harness retains capacity for all six variants, but a
risk-based stop rule ends Local repetition once the default path and one causal
variant pass without a reproduced defect. At that checkpoint, additional
Staging evidence remained blocked until the bounded Local evidence was recorded.

VP9-default browser capture is complete locally: 3/3 exact 90,000 ms captures
passed live listening across both public sources and both anonymous devices,
with no crackle, clicks, warble, or dropouts. A non-exact 89,394 ms calibration
run is preserved but excluded. These real MediaRecorder Blobs reproduced two
worker-boundary gaps before Staging: absent WebM container duration and a narrow
viewport centered inside a wider Chrome `crop-and-scale` track. The worker
derives a bounded duration from at most 25,000 packet timestamps when a WebM
duration is absent, rejecting truncated or malformed timing output. Geometry
uses a uniform scale and centered offsets only when probed dimensions match the
recorded track and `resizeMode` is `crop-and-scale`; other mismatches fail
closed. Focused tests pass 46/46. All three real captures then produced bounded
H.264/AAC derivatives and passed raw-versus-derivative signal checks. The blind
pair is retained. No remote lifecycle was invoked.

Loopback-off then completed one retained 89,568 ms causal capture. It did not
count toward the exact-duration repetition total, but it proved the intended
one-factor behavior: live tab playback was silent, capture motion continued,
the Blob contained stereo audio, and a 89,564 ms derivative passed automated
raw-versus-derivative signal checks. Production worker validation continues to
reject loopback-disabled metadata; the Local harness recorded and used a
validation-only copy solely to exercise media processing. Because the default
browser path already passed three exact samples and the worker-boundary matrix
passed 9/9 plus owner listening on two devices, the Local causal gate is
accepted. The unused no-timeslice, VP8-browser, and explicit-bitrate repetitions
are intentionally skipped unless later evidence reproduces a defect. The exact
90-second Staging lifecycle already recorded below supplies the remote evidence:
one attempt reached ready/published, raw deletion was confirmed, and owner
playback passed all four markers, steady tone, channel balance, clean ending,
and absence of crackle, clicks, warble, or dropouts. Gate 5d is accepted without
another provider invocation. Full repository regression then passed, followed
by the Draft PR #18 corrective review described in the status above.

## Approved boundary

- Google Cloud project: `annotated-504301`.
- Billing owner: `cbandcoop@gmail.com`.
- Google Cloud monthly budget alert: USD 25. Budget alerts are not a hard spend
  cutoff, so job size, retry count, dispatch batch size, and schedules are also
  bounded.
- Supabase Staging: `nkkunkwirvfwhmpwonqz`, AWS `aws-0-us-east-1`.
- Google region: `us-east4`. This is the closest available selected region to
  the Staging database and is an explicit architecture inference, not a claim
  that both services share a data center.
- Transcriber: OpenAI `whisper-1`, with an owner-set USD 10 monthly project
  budget. Current terms were accepted by the owner.
- No Production resources, deployment, traffic, or merge.

## Provider contract

The adapter calls only
`https://api.openai.com/v1/audio/transcriptions`, with model `whisper-1`,
`response_format=verbose_json`, and segment timestamps. The official API limit
is 25 MB; the worker-generated 16 kHz mono FLAC is separately bounded and is
derived only from the final trimmed derivative. OpenAI currently publishes
only the `whisper-1` alias for this model, not a dated snapshot. Response-shape
and normalization tests are therefore the regression pin.

The worker retains only normalized transcript text, an ISO language code when
recognized, bounded relative segments, provider `openai`, model `whisper-1`,
and two fixed schema facts. Provider tokens, request/response bodies, errors,
and raw provider metadata are excluded from logs and persistence. The official
data-controls table currently identifies `/v1/audio/transcriptions` as not used
for training, with no application-state retention and eligibility for Zero Data
Retention; the owner must re-check policy before a provider change.

Whisper may report a final segment end slightly beyond the exact derivative
duration. Segment overlap tolerance remains 20 ms. Final-end drift is clamped
to the derivative boundary only when it is at most 2,000 ms; larger drift still
fails closed as `transcript_invalid`, as does any segment whose start is at or
beyond the derivative boundary. The bound covers the observed 9,280 ms and
10,160 ms provider ends for verified 9,000 ms derivatives and is exercised in
source and no-network container regressions.

References:

- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI create transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [OpenAI Whisper model and pricing](https://developers.openai.com/api/docs/models/whisper-1)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint)

## Database identity

Migration `20260818214914_phase_c_worker_runtime_role.sql` creates the login
`annotated_media_worker` with no password and with `NOSUPERUSER`, `NOCREATEDB`,
`NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, and `NOBYPASSRLS`. Staging
bootstrap must generate the password outside migration history and store only
the percent-encoded connection URL in Google Secret Manager.

The login has no direct domain-table, transcript-table, sequence, or Storage
table rights. It has `USAGE` on `private` and `EXECUTE` only on the exact claim,
stage derivative, stage transcript, raw-delete confirmation, finalize,
attempt-release, dispatch-list, reconciliation-list, cleanup-claim,
cleanup-confirmation, and processing-reconciliation functions. It cannot call
upload acceptance, owner retry, or the obsolete failure function.

Cloud Run uses the Supabase Shared Pooler transaction endpoint
`aws-0-us-east-1.pooler.supabase.com:6543` with user
`annotated_media_worker.nkkunkwirvfwhmpwonqz`. The code rejects every other
remote database/API host, port, role, project, or environment value.

References:

- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase database connections and transaction pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)

## Cloud resources

Names are fixed so audits and rollback are unambiguous:

| Resource | Name | Boundary |
| --- | --- | --- |
| Artifact Registry | `annotated-workers` | Docker, `us-east4` |
| Worker job | `annotated-media-worker-staging` | one task, 2 vCPU, 512 MiB, 600 seconds, one platform retry |
| Dispatcher job | `annotated-media-dispatcher-staging` | one task, bounded candidate batch/concurrency |
| Reconciler job | `annotated-media-reconciler-staging` | one task, bounded reconciliation/cleanup batch |
| Worker identity | `annotated-media-worker` | secret access only; also used by reconciler |
| Dispatcher identity | `annotated-media-dispatcher` | database/dispatch secrets plus worker-job invocation |
| Scheduler identity | `annotated-media-scheduler` | dispatcher/reconciler invocation only |
| Schedules | `annotated-media-dispatch-staging`, `annotated-media-reconcile-staging` | created paused; enable only after sequential owner acceptance |

The dispatcher obtains an access token only from the Cloud metadata server and
calls the fixed Cloud Run v2 `jobs:run` endpoint. Its identity has the dedicated
`roles/run.jobsExecutorWithOverrides` role on the worker job only; ordinary
`roles/run.invoker` is insufficient for this boundary. Each invocation
overrides exactly `ANNOTATED_MEDIA_ID` and a five-minute HMAC envelope. Database
leasing remains authoritative, so duplicate Cloud Run executions cannot obtain
two valid leases or publish competing results.

Secrets are runtime-only Secret Manager versions:

- `annotated-staging-database-url`;
- `annotated-staging-supabase-secret-key` for private Storage operations only;
- `annotated-staging-openai-api-key`;
- `annotated-staging-dispatch-secret`.

No secret is placed in the image, repository, command output, scheduler body,
or extension/web client.

## Local evidence

- Focused source/static tests: 33/33 passed before the integration slice.
- Real Whisper adapter integration with injected HTTP and verified FFmpeg:
  23/23 passed; no fixture audio contacted OpenAI.
- Additive migration applied to Local; database lint passed.
- Local pgTAP: 237/237 passed, including eight worker-role assertions.
- Candidate image: `annotated-media-worker:c6-staging-candidate`.
- Candidate local image ID:
  `sha256:283fabf161394219fed1820c506641a2bb70a630291567f1c20cbaaf9ed94f87`.
- The first tested Linux/amd64 runtime was pushed without its local build
  attestation index to immutable Artifact Registry tag
  `media-worker:c6-283fabf16139`. A subsequent credential-path audit found
  that its PostgreSQL child-process argument contained the complete connection
  URL. That artifact is retained for audit but prohibited from deployment.
- The adapter now passes a password-redacted PostgreSQL URL as a process
  argument and supplies only `PGPASSWORD` in the child environment. The
  corrected image passed the complete private Local container lifecycle and was
  pushed as immutable tag `media-worker:c6-70139b5af0ed`. Its approved remote
  deployment digest is
  `sha256:70139b5af0ed343d158afc72d49fdec4e0d1ec9b56bffc10b90f7ac7212d0082`.
- Image runs as `10001:10001`; pinned Node 24.14.1, FFmpeg/ffprobe
  `n8.1.2-44-g7c533d0f86-20260816`, and PostgreSQL client 17.6 probes passed.
- Portable Google Cloud CLI 578.0.0 was downloaded to a temporary directory
  and verified against official SHA-256
  `c4379e0637a0264441a17cdda64afd562930c83bd9c28d0da0c60aa2c106e0eb`.
- Google billing was verified enabled for project number `560828879274`. The
  project-scoped USD 25 monthly budget has 50%, 90%, and 100% alert thresholds;
  it is an alerting control, not a hard cutoff.
- Artifact Registry `annotated-workers`, the three dedicated service accounts,
  and four regional Secret Manager containers exist in `us-east4`. Only the
  worker can read all four secrets; the dispatcher can read only the database
  URL and dispatch secret. Runtime jobs and paused schedules are deliberately
  deferred until Staging migration and secret-version gates pass.
- Staging migration preflight found exactly the C5 worker-contract and C6
  worker-role migrations pending. Both were applied in order to verified ref
  `nkkunkwirvfwhmpwonqz`; post-apply Local/remote history matches through
  `20260818214914`. A read-only remote audit confirmed the role attributes,
  bounded settings, direct-table denial, and schema boundaries. An owner of
  Supabase organization `zpwzugzuzqxqxkruumfa` authorized an isolated CLI
  profile. The generated role password was set without entering migration
  history, and Secret Manager versions were created for the database URL and
  Supabase Storage secret without printing or writing either value locally.
- The corrected container authenticated through the Staging transaction pooler
  as `annotated_media_worker`; a read-only probe confirmed that this identity
  still cannot select `public.annotations`.
- All four Secret Manager containers now have one enabled version. The owner
  confirmed a USD 10 monthly hard spend limit. The key-permission dashboard did
  not expose the required transcription scope and would not save Restricted
  with every visible row set to None, so the Staging-only key is temporarily
  set to All. The separate Annotated Staging Model Usage policy is an allowlist
  containing only `whisper-1`; no other model is allowed. This is a documented
  least-privilege exception because model restriction does not narrow the key's
  non-model endpoint permissions. Compensating controls are the dedicated
  project, Secret Manager-only key, worker-only secret access, fixed adapter
  endpoint/model, paused schedules, and USD 10 hard project limit. Three earlier
  bounded probes used the production adapter and four-second synthetic
  final-derivative audio; OpenAI rejected each before transcription or billable
  processing. The final pre-change diagnostic was HTTP 401, `missing_scope`,
  with exact required scope `api.model.audio.request`.
- `test/staging-openai-probe.mjs` is the explicit post-change gate. It uses the
  production adapter and verified four-second final derivative, emits only a
  bounded status/checksum diagnostic, and removes its temporary FLAC. The first
  owner-controlled attempt stopped before HTTP because the supplied runbook had
  an incorrect temporary FFmpeg directory; the probe now validates the key and
  executables explicitly and the runbook contains the verified path. Secret
  Manager access then passed for `cbandcoop@gmail.com` and project
  `annotated-504301`. The corrected gate reached OpenAI and returned HTTP 200
  for `whisper-1`, proving the required request scope and model allowlist. The
  synthetic tone did not normalize as a valid transcript (`transcript_invalid`),
  which remained separate from transcript-quality acceptance. The subsequent
  bounded worker lifecycle with synthetic spoken audio passed as recorded below.
- Worker, dispatcher, and reconciler Cloud Run jobs are deployed from the exact
  approved digest. Each has one task and one-way job-level invocation IAM:
  dispatcher to worker, scheduler to dispatcher/reconciler, and no scheduler
  access to the worker.
- Both Cloud Scheduler jobs exist at the intended one- and five-minute cadences
  and are confirmed `PAUSED`. They were created first with a future-only
  schedule, immediately paused, and only then updated to the operational cron
  expressions, so no scheduled invocation occurred during provisioning.
- One owner-authorized reconciler execution processed two pre-existing
  `abandoned_cleanup` candidates with zero failures. Sanitized logs recorded
  only the cycle counts and two removal outcomes; the post-run reconciliation
  count is zero. One dispatcher empty-state execution then completed with zero
  candidates, dispatches, and failures. No worker job or OpenAI request ran.
- The isolated Supabase CLI owner profile was reauthorized and verified to see
  exact project `nkkunkwirvfwhmpwonqz` as `ACTIVE_HEALTHY`; the Production
  project remained separate and untouched.
- The first bounded spoken-audio dispatch found that `roles/run.invoker` lacks
  `run.jobs.runWithOverrides`; no worker started. The exact worker-job binding
  was replaced with `roles/run.jobsExecutorWithOverrides`, and the same sole
  candidate then dispatched successfully.
- The first worker attempt created and verified the private 9,000 ms derivative
  but scheduled a transcript retry. A one-request, text-free structural
  diagnostic found HTTP 200, one nonblank segment, and a provider end timestamp
  of 9,280 ms. The bounded final-end clamp described above fixed the real
  provider incompatibility; 35 focused source tests and three FFmpeg integration
  tests passed.
- Corrected image tag `media-worker:c6-2c50cccc1f8d` was inspected as
  Linux/amd64, UID/GID `10001:10001`, Node 24.14.1, PostgreSQL client 17.6, and
  FFmpeg `n8.1.2-44-g7c533d0f86-20260816`. Its immutable digest is
  `sha256:2c50cccc1f8dbf9d15d93c5b193368da9e310bb006b22de1b8077cab247af263`;
  all three Staging jobs are ready on that digest with one task and one-way IAM.
- The retry resumed at `transcribing` from the verified derivative and reached
  `ready/published`. Evidence recorded provider/model `openai`/`whisper-1`, a
  117-character transcript containing all expected synthetic spoken terms, one
  segment bounded exactly 0-9,000 ms, confirmed raw deletion, a private processed
  object, released lease, and no pending retry. Worker logs contained exactly
  `worker_started`, `worker_claimed`, `transcript_staged`,
  `raw_cleanup_confirmed`, and `worker_completed`, with no unexpected payload
  fields. The disposable rows and both Storage objects were then removed, and
  the dispatch queue returned to zero.
- Operator audit note: one initial unfiltered Cloud Run execution listing
  included the five-minute dispatch envelope from the execution override. The
  envelope was bound to the disposable media ID, is expired, and did not expose
  the HMAC secret; the fixture is deleted. Future worker execution checks must
  request only bounded name/status/count fields and must not print the complete
  execution specification or environment overrides.
- Both scheduler jobs remain `PAUSED`; Production was not accessed or changed.
- The next sequential known-video gate completed its automated Staging slice:
  one 1,280x720 VP9/Opus private raw fixture produced an exact 9,000 ms,
  426x240 H.264/AAC derivative, a 136-character `whisper-1` transcript with two
  segments bounded 0-9,000 ms, confirmed raw deletion, atomic publication, and
  sanitized logs. Expected spoken terms were present through the exact excerpt
  boundary. The remote fixture was completely removed and the queue returned to
  zero. The owner then passed the checksum-matched derivative on 2026-08-18:
  duration `00:09`, crop/no magenta border PASS, motion PASS, clear audio with no
  crackle or clicks, A/V alignment PASS, and no notes. The disposable local
  derivative was removed after that evidence was recorded.
- The sequential known-audio gate completed its automated Staging slice: one
  synthetic 9,958 ms Opus stereo raw fixture with speech over a quiet steady
  tone produced an exact 9,000 ms, 48 kHz stereo AAC derivative. The processed
  object was private, 108,325 bytes, and matched SHA-256
  `ed1c09898ef132689aa872d4cca0730bc86cb7f7f40ee894cf094c508051488e`.
  `whisper-1` produced one nonblank segment bounded exactly 0-9,000 ms; the
  expected in-range speech terms were present. The first worker attempt reached
  `ready/published`, confirmed raw deletion, and released its lease. Dispatcher
  counts were one candidate, one dispatch, and zero failures. Worker logs
  contained exactly `worker_started`, `worker_claimed`, `derivative_staged`,
  `transcript_staged`, `raw_cleanup_confirmed`, and `worker_completed`, with
  allow-listed fields only. All remote fixture rows and objects were removed,
  the processing queue returned to zero, and one checksum-matched local
  derivative was retained solely for owner speech, tone, crackle/click, dropout,
  channel, and trim-quality acceptance. The owner then passed that derivative
  on 2026-08-18: duration `00:09`, clear speech, steady tone, no crackles,
  clicks, warble, or dropouts, balanced channels, clean ending, and no notes.
  The disposable local derivative was removed after this evidence was recorded.
- After the audio fixture was cleaned, a later read-only CLI query found that
  the isolated `annotated-staging-owner` profile no longer enumerated the
  Annotated organization. Exact-ref cleanup was independently verified through
  the Staging project URL using its Secret Manager-held server secret. Before
  the next CLI database action, reauthorize that isolated profile and reverify
  exact ref `nkkunkwirvfwhmpwonqz`; never proceed against the unrelated projects
  currently visible to the profile.
- The owner reauthorized the isolated CLI profile. It again resolved healthy,
  linked Annotated Staging ref `nkkunkwirvfwhmpwonqz`; Production remained
  separate and unlinked. The forced transient-retry gate then began from an
  empty queue with both schedules paused.
- Two initial operator-only attempts to inject a non-secret invalid provider
  credential were rejected before claim because the manual token generator
  normalized trailing whitespace in the dispatch secret. Each Cloud Run
  execution emitted only sanitized `runtime_failed` records; the authoritative
  row remained draft at attempt zero with no derivative or transcript. This
  confirms that operator-generated dispatch tokens must not replace the deployed
  dispatcher, which consumes the exact Secret Manager bytes in memory.
- The actual transient gate temporarily withheld the disposable raw object and
  used the normal dispatcher. Attempt one emitted `worker_started`,
  `worker_claimed`, and one sanitized `probing` / `unexpected_failure` with
  `retry_scheduled`. The lease was released, the annotation stayed draft, raw
  deletion was not confirmed, and neither derivative metadata, processed object,
  nor transcript existed. The paused schedule prevented automatic execution
  after the bounded backoff became due.
- Restoring the exact raw object with SHA-256
  `2d0cdf67cd621fb0b9b4cd8257b03d5627a5074faa4a6e2f9858d2cf0a980d9e`
  made the same row the sole candidate. Attempt two reached `ready/published`,
  cleared failure/retry/lease fields, confirmed raw deletion, and produced one
  exact 9,000 ms private AAC object. Its 110,482 bytes matched authoritative
  SHA-256 `f458a4bc915ca35bbb940fee082cb700df427e320d353567dfcd6edb28542340`;
  the Storage prefix contained exactly one `excerpt.m4a`. `whisper-1` produced
  two segments bounded 0-9,000 ms. Recovery logs contained the six expected
  allow-listed worker events and no forbidden fields. All fixture rows, both
  object prefixes, and local files were removed; the queue returned to zero and
  both schedules remain paused.
- The six-boundary Staging matrix used a repository-owned, opt-in acceptance
  harness excluded from the container image. It prepared the exact durable facts
  left by each crash, expired only that fixture's lease, and then invoked the
  deployed reconciler and normal dispatcher. No runtime crash hook, image
  rebuild, job configuration change, schema change, or operator-created dispatch
  token was used. Every prepared annotation remained draft at attempt one.

| Prepared crash boundary | Recovery claim | Recovery evidence |
| --- | --- | --- |
| claim before durable output | `probing` | created one derivative |
| derivative upload before database staging | `probing` | reused the existing object; no duplicate |
| derivative database staging | `transcribing` | skipped derivative staging |
| transcript database staging | `raw_cleanup` | skipped media and provider work |
| raw Storage deletion before database confirmation | `raw_cleanup` | accepted already-absent raw only with authoritative staged facts |
| raw deletion database confirmation before finalization | `finalizing` | performed only atomic finalization |

- Each reconciler run released exactly the expired fixture lease. Each recovery
  claimed attempt two and reached `ready/published` with no retry, lease, or
  failure fields. All six final objects were private, exact 9,000 ms AAC,
  checksum-matched to database facts, and paired with `openai` / `whisper-1`
  transcripts containing two segments bounded 0-8,960 ms. Raw deletion was
  confirmed before publication in every case. Recovery logs omitted stages that
  authoritative state allowed them to skip.
- Matrix cleanup found zero fixture sources, annotations, media rows,
  transcripts, raw objects, processed objects, dispatch candidates, and
  reconciliation candidates. All local fixture files were removed. Both
  schedules remain `PAUSED`, the three jobs remain available, and Production is
  separate, unlinked, and untouched. The focused worker gate passed 61/63 tests
  with only the two opt-in Local suites skipped; the five container/static
  contract checks and harness syntax validation passed.
- Gate 5a's first exact 90,000 ms attempt created a 628,495-byte private AAC
  derivative with SHA-256
  `a07a5f22dc27e7b41d49a716654b4f4ca147630f3d55dbd135f80ab45111d70e`,
  then scheduled a `transcribing` / `transcript_invalid` retry while retaining
  the draft, raw object, and derivative. A single text-free diagnostic returned
  HTTP 200 from `whisper-1`, six nonblank ordered segments, no overlap, and a
  final provider timestamp of 90,400 ms for the exact 90,000 ms derivative.
  This isolated a validator-ordering defect: the old 90,020 ms absolute ceiling
  rejected the provider value before the documented final-end clamp could run.
- The initial corrected validator admitted at most 1,000 ms of final provider
  tail drift, clamped it to the authoritative derivative duration, and rejected
  timestamps beyond 91,000 ms. Focused source tests and an in-container
  90,400-to-90,000 regression passed. Corrective image
  `media-worker:c6-db5b20136e38` was checksum-built and inspected as Linux/amd64,
  UID/GID `10001:10001`, Node 24.14.1, PostgreSQL client 17.6, and pinned FFmpeg
  `n8.1.2-44-g7c533d0f86-20260816`. Its immutable digest is
  `sha256:db5b20136e38284fa03f45292edeb29c398597592e6155d994b09f8fc9cffd57`.
  All three Staging jobs now use that digest; both schedules remain `PAUSED`, no
  execution occurred during deployment, and Production was not accessed.
- The separate recovery gate required the exact retained row to be the sole
  processing candidate at attempt one, verified its raw object and staged
  derivative checksum, and invoked only the normal dispatcher. Attempt two
  reused the exact 628,495-byte derivative, produced a 136-character transcript
  with six valid segments bounded 0-90,000 ms, confirmed raw deletion, cleared
  retry/lease/failure state, and reached `ready/published`. Logs recorded the
  expected resume path without another derivative stage. Exact cleanup found
  zero fixture rows, raw objects, processed objects, and processing candidates;
  both schedules stayed paused and Production remained untouched. The ordinary
  duration gate remained separate and subsequently ran from an empty queue on
  attempt one, as recorded below.
- The subsequent empty-queue rerun generated a 90,958 ms, 931,264-byte Opus raw
  fixture with spoken markers at 0, 30, 60, and 85.5 seconds. Its sole worker
  attempt reached `ready/published` with no retry, lease, or failure; confirmed
  raw deletion; produced the exact 90,000 ms, 628,495-byte AAC derivative with
  SHA-256
  `a07a5f22dc27e7b41d49a716654b4f4ca147630f3d55dbd135f80ab45111d70e`;
  and stored a 136-character `whisper-1` transcript with six segments bounded
  exactly 0-90,000 ms. The newest sanitized log sequence was exactly
  `worker_started`, `worker_claimed`, `derivative_staged`,
  `transcript_staged`, `raw_cleanup_confirmed`, and `worker_completed`, with no
  failure event. Exact cleanup found zero fixture/source rows, raw objects, processed objects,
  and processing candidates. Both schedules remain paused and Production was
  not accessed.
- Owner playback passed on 2026-08-23: duration `01:30`; start, 30-second,
  60-second, and complete final/ninety-second markers all PASS; the quiet tone
  remained steady; no crackles, clicks, warble, or dropouts were audible;
  channel balance and the clean ending PASS; notes `NA`. After this evidence was
  recorded, both checksum-identical disposable local 90-second artifacts were
  removed.

## Stop and rollback

Create schedules paused. Stop on an unexpected project/account/region, missing
budget, failed migration, secret exposure, non-Draft PR, provider response
shape, raw-deletion failure, or premature publication. Rollback disables
dispatcher/reconciler schedules and new hosted intake; it never edits migration
history, resets the linked database, publishes partial output, or deploys to
Production.
