# Annotated local media core

Phase C increment C2 is a dependency-free, local-only media core. It validates
capture-metadata v2, parses authoritative ffprobe facts, rejects unsafe crop
geometry, constructs fixed FFmpeg arguments, produces bounded H.264/AAC MP4 or
AAC-LC M4A derivatives, and re-probes/hashes every output.

It does not contain database, Storage, lease, transcription-provider,
dispatcher, cloud, or deployment code. Capture-metadata v1 always returns the
stable `recapture_required` failure.

C3 adds a provider-neutral transcription boundary with a deterministic fake.
Only a module-issued capability for 16 kHz mono FLAC extracted from the exact
validated final derivative can enter an adapter. Transcript text and segments
are normalized and bounded before a staging candidate is returned. No real
provider or network client exists.

C4 adds a dependency-free Local-only integration harness. It refuses
non-loopback Supabase API and database URLs, keeps Local credentials in memory,
and exercises the actual private Storage HTTP API plus the private worker RPCs.
It creates UUID-scoped fixtures and removes their database rows, Storage
objects, and temporary derivative audio even when a test fails.

Run unit tests without FFmpeg:

```powershell
node --test .\apps\media-worker\test\media-core.test.mjs
```

Run the complete C2 integration suite with the separately verified temporary
toolchain:

```powershell
$env:ANNOTATED_FFMPEG_BIN = '<verified temporary FFmpeg bin directory>'
node --test .\apps\media-worker\test\media-core.test.mjs .\apps\media-worker\test\media-core.integration.test.mjs
node .\apps\media-worker\test\run-c2-fixtures.mjs
node --test .\apps\media-worker\test\transcription.test.mjs .\apps\media-worker\test\transcription.integration.test.mjs
node .\apps\media-worker\test\run-c3-fixture.mjs
Remove-Item Env:\ANNOTATED_FFMPEG_BIN
```

Run the C4 Local Storage lifecycle and crash-boundary matrix only while Local
Supabase is running:

```powershell
$env:ANNOTATED_C4_LOCAL = '1'
$env:ANNOTATED_FFMPEG_BIN = '<verified temporary FFmpeg bin directory>'
node --test .\apps\media-worker\test\orchestration.integration.test.mjs
Remove-Item Env:\ANNOTATED_C4_LOCAL
Remove-Item Env:\ANNOTATED_FFMPEG_BIN
```

The C4 harness does not contact a linked or remote project and does not print
API keys, object paths, transcript text, or provider metadata.

C5 adds the dependency-free runtime under `src/runtime`, direct Local
PostgreSQL and private Storage adapters under `src/infrastructure`, and one
bounded entrypoint with `worker`, `dispatch`, and `reconcile` modes. Dispatch
uses a five-minute HMAC envelope bound to one media UUID, then starts one worker
process for that UUID. PostgreSQL remains authoritative for leases, attempt
counts, due times, retry backoff, reconciliation eligibility, and cleanup
claims. Structured logs use an exact allow-list and omit paths, credentials,
URLs, transcript text, provider payloads, and exception messages.

Run the C5 unit and static container-contract gate without network access:

```powershell
node --test .\apps\media-worker\test\runtime.test.mjs .\apps\media-worker\test\container.test.mjs
```

Run the actual C5 Local Supabase lifecycle with only loopback network access:

```powershell
$env:ANNOTATED_C5_LOCAL = '1'
$env:ANNOTATED_FFMPEG_BIN = Join-Path $env:TEMP 'Annotated-ffmpeg-8.1-42c721d1f3164c61b72b7aaeba07772d\extracted\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin'
node --test .\apps\media-worker\test\runtime.integration.test.mjs
Remove-Item Env:\ANNOTATED_C5_LOCAL
Remove-Item Env:\ANNOTATED_FFMPEG_BIN
```

When C4 and C5 are both enabled, run Local integration files serially with
`node --test --test-concurrency=1`. The Supabase CLI writes one user-level
telemetry file, so parallel `supabase status` processes on Windows can race even
though the database scenarios themselves are isolated.

`Dockerfile` pins Linux/amd64 Node 24.14.1 and PostgreSQL client 17.6 image
digests plus the BtbN LGPL FFmpeg 8.1 archive checksum. It runs as numeric UID
and GID 10001, contains no credential defaults, and accepts secrets only at
runtime. The owner-approved C5 Local image is built only as
`annotated-media-worker:c5-local`; it is not pushed or deployed.

Run the destructive-fixture/automatic-cleanup container gate only while Local
Supabase is running and only after building that exact local tag:

```powershell
$env:ANNOTATED_C5_CONTAINER_LOCAL = '1'
node .\apps\media-worker\test\container-acceptance.mjs
Remove-Item Env:\ANNOTATED_C5_CONTAINER_LOCAL
```

The harness creates one UUID-scoped audio job, supplies Local-only secrets via a
temporary env file, and runs with a read-only root, 64 MiB `/tmp` tmpfs, all
capabilities dropped, no-new-privileges, and bounded CPU, memory, and PIDs. It
verifies the private processed object, transcript, publication, raw deletion,
sanitized logs, and exact cleanup. It never prints the runtime environment.

The fixture runner writes only its exact known files below
`test/fixtures/generated/c2/`. Its results contain local synthetic-media facts
and checksums, never credentials, source URLs, transcript text, or user data.

C6 adds the dependency-free `whisper-1` adapter and Cloud Run Jobs dispatch
adapter. The provider adapter accepts only the opaque derivative-audio
capability minted after the final processed derivative is re-probed and hashed.
It sends one bounded FLAC to the fixed OpenAI transcription endpoint with
`verbose_json` and segment timestamps, maps only transcript text/language/
relative segments, and stores no raw provider payload. HTTP 429, timeout, and
other failures become the stable `provider_rate_limited`, `provider_timeout`,
and `transcription_failed` codes. Segment overlap tolerance remains 20 ms; a
provider-reported final segment end may be clamped to the exact derivative end
only when the overrun is at most 2,000 ms. A segment that starts at or beyond
the derivative boundary still fails closed.

Staging configuration fails closed to Supabase project
`nkkunkwirvfwhmpwonqz`, its `aws-0-us-east-1` transaction pooler on port 6543,
database login `annotated_media_worker`, Google Cloud project
`annotated-504301`, region `us-east4`, and job
`annotated-media-worker-staging`. Local remains the default environment and
continues to use the deterministic fake and loopback-only URLs. No provider or
cloud credentials are accepted from client code or image layers.

Run the C6 focused source gate:

```powershell
node --test .\apps\media-worker\test\runtime.test.mjs .\apps\media-worker\test\transcription.test.mjs .\apps\media-worker\test\container.test.mjs
$env:ANNOTATED_FFMPEG_BIN = '<verified temporary FFmpeg 8.1 bin directory>'
node --test .\apps\media-worker\test\transcription.integration.test.mjs
Remove-Item Env:\ANNOTATED_FFMPEG_BIN
```

The real-adapter integration injects an in-memory HTTP response. It does not
contact OpenAI, send fixture audio over the network, or require an API key.

After the owner has set the Annotated Staging project model allowlist to only
`whisper-1`, run the single-request provider permission gate from an
owner-controlled PowerShell session. The script uses the production adapter,
extracts 16 kHz mono FLAC only from the verified four-second final derivative,
prints only a bounded diagnostic, and removes the temporary audio. It never
prints the API key or transcript text.

```powershell
$gcloud = Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'
$env:ANNOTATED_FFMPEG_BIN = '<verified temporary FFmpeg 8.1 bin directory>'
$env:ANNOTATED_C6_STAGING_PROBE = '1'
$env:OPENAI_API_KEY = (& $gcloud secrets versions access latest --secret=annotated-staging-openai-api-key --project=annotated-504301).Trim()
try {
  node .\apps\media-worker\test\staging-openai-probe.mjs
} finally {
  Remove-Item Env:\OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_PROBE -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_FFMPEG_BIN -ErrorAction SilentlyContinue
}
```

Proceed to a real Staging worker execution only when this gate reports
`"outcome":"passed"` and `"http_status":200`. The synthetic final derivative
contains a tone rather than speech, so `adapter_outcome` may state that the
provider accepted the request without producing a valid transcript. That is a
permission-gate pass, not transcript-quality acceptance; the subsequent bounded
worker lifecycle must still prove a valid spoken excerpt end to end.

When auditing Cloud Run worker executions, select only bounded execution name,
status, and count fields. Do not print an unfiltered execution description or
list result because per-execution environment overrides contain the short-lived
one-media dispatch envelope.

The opt-in `test/staging-crash-acceptance.mjs` harness prepares one disposable
durable crash state at a time without adding a crash switch to the deployed
worker. It is excluded from the image by `.dockerignore`, requires
`ANNOTATED_C6_STAGING_CRASH=1`, pins the exact Staging API and pooler hosts, and
supports only these boundaries: `after_claim`, `after_derivative_upload`,
`after_derivative_stage`, `after_transcript_stage`, `after_raw_delete`, and
`after_raw_confirm`. Its `prepare`, `status`, and `cleanup` commands require
runtime-only database, Storage, OpenAI, psql, FFmpeg, ffprobe, and raw-fixture
environment values. Never print those values or persist them to a file.

Before each harness database action, independently verify linked project ref
`nkkunkwirvfwhmpwonqz`. Keep both schedules paused. After `prepare`, run the
deployed reconciler and normal dispatcher; never generate an operator dispatch
token. `status` emits only bounded facts, and `cleanup` removes the exact fixture
objects and rows. Finish by proving all six fixture families, both queues, and
all twelve possible object locations are empty.

Gate 5 begins with the exact 90-second behavior. Run it only from an
owner-controlled Windows PowerShell session with the existing authenticated
Supabase and Google Cloud profiles:

```powershell
.\apps\media-worker\test\get-c6-supabase-cli.ps1
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -RunDurationGate
```

The temporary CLI step is required because pinned repository CLI 2.111.0 has a
known custom-profile fallback defect. The acquisition script downloads official
2.115.0 Windows AMD64 release assets, verifies the published checksum file SHA-256
and the archive checksum, and extracts only under `%TEMP%`; it does not install
system-wide or modify the repository dependency graph. The runner rejects any
other executable version. Authorization is stored in the isolated
`%TEMP%\Annotated-supabase-c6-home` CLI home. This bypasses the legacy global
custom-profile selector without deleting it, changing the system installation,
or persisting a token in the repository. On Windows, authorization, exact-ref
verification, and the duration gate remain in one PowerShell script boundary so
the CLI cannot silently resolve a different Windows Credential Manager identity
between separate operator commands.

The runner stops unless branch `codex/phase-c-worker`, healthy linked Staging
ref `nkkunkwirvfwhmpwonqz`, unlinked Production, Google project
`annotated-504301`, both paused schedules, and immutable worker digest
`sha256:db5b20136e38284fa03f45292edeb29c398597592e6155d994b09f8fc9cffd57`
all match. It generates a local 90.95-second Opus fixture with spoken markers at
the start, 30 seconds, 60 seconds, and near the final trim boundary; retrieves
the Storage secret only into the process environment; proves the processing
queue is empty; seeds one fixed disposable media ID; and invokes the deployed
dispatcher exactly once. It accepts only an exact 90,000 ms private AAC result,
bounded `whisper-1` transcript, confirmed raw deletion, first-attempt
publication, matching byte/checksum facts, one deterministic object, and a
bounded sanitized-log query.

On success it downloads the checksum-matched owner artifact to
`$env:TEMP\Annotated-c6-duration-90000-acceptance.m4a`, removes every remote
fixture row and object, proves the queue is empty, and removes the raw local
fixture. If an unexpected result occurs, it clears secrets and the local raw
file but retains the remote disposable fixture for diagnosis; do not rerun or
delete it manually. The script never resumes schedules or accesses Production.

If the exact retained fixture stops at `transcribing`/`transcript_invalid` with
a scheduled retry, do not dispatch that retry. Run one text-free structural
diagnostic in the same verified Supabase authorization boundary:

```powershell
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -RunDurationDiagnostic
```

This command requires both schedules to remain paused, verifies and downloads
only the checksum-matched private derivative, performs exactly one bounded
`whisper-1` request, emits response structure and timestamp facts without
transcript text, removes the local diagnostic derivative, and leaves the remote
fixture unchanged for corrective recovery.

After the exact timestamp incompatibility is corrected and all three Staging
jobs are verified on the accepted immutable digest, recover that retained row
through its database-owned retry. Do not seed a replacement or execute the
worker job directly:

```powershell
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -RunDurationRecovery
```

The recovery gate requires the retained media ID to be the sole processing
candidate at attempt one, verifies the private raw and checksum-matched
90,000 ms derivative, executes the normal dispatcher exactly once, and accepts
only attempt-two publication that reuses the exact derivative. It cleans the
remote fixture only after success and retains a checksum-matched local artifact.
After recovery and cleanup pass, run the original duration gate once from its
empty preflight to prove the corrected image succeeds on the first attempt.

If the normal dispatcher completes but the operator script exits while the row
still shows the original attempt-one retry, do not dispatch again. Resume only
the observation and cleanup boundary:

```powershell
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -ObserveDurationRecovery
```

This mode never executes the dispatcher. It waits for the worker execution
already launched, distinguishes the unchanged attempt-one state from a genuine
attempt-two retry, and otherwise applies the same exact-result and cleanup
checks.

If the ordinary duration gate has already emitted a passed first-attempt status
and exported the checksum-matched acceptance artifact but stops during its log
query, do not rerun or redispatch. Finalize only the passed status, newest
complete six-event worker log sequence, and exact cleanup:

```powershell
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -FinalizeDurationGate
```

This continuation requires the existing local artifact and ready Staging row
to match, executes no dispatcher or worker, and leaves the artifact in place for
owner playback acceptance.

After Gate 5a owner playback passes, run the isolated Gate 5b codec check. The
Local fixture matrix first covers VP9/Opus, VP8/Opus, audio-only Opus, malformed
bytes, an MP4 disguised as WebM, missing audio, missing video, and unsupported
Vorbis audio. The Staging slice then adds only the missing positive lifecycle:
one synthetic VP8/Opus video through the pinned worker, `whisper-1`, private
H.264/AAC derivative, raw deletion, atomic publication, sanitized logs, exact
cleanup, and owner playback. It does not apply a migration, resume schedules,
or access Production.

```powershell
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -RunCodecGate
```

On success the owner artifact is
`$env:TEMP\Annotated-c6-codec-vp8-acceptance.mp4`. If the script retains a
fixture, do not rerun or delete it manually; report its bounded output first.

Gate 5c expands the Local geometry matrix across landscape, portrait,
letterbox, exact one-CSS-pixel visibility/movement tolerance, fullscreen and
track-aspect stability, six unsafe capture states, and proof that rejected
geometry creates no derivative. The matrix reproduced and fixed an ordering
defect that rejected the documented `-1` CSS-pixel edge before applying its
tolerance; values below `-1` still fail closed. The corrected pinned non-root
candidate is deployed to all three paused Staging jobs.

The first portrait attempt retained a checksum-matched derivative after
Whisper reported its final end at 10,160 ms for the exact 9,000 ms excerpt. The
bounded structural diagnostic passed. The deployment and recovery commands are
retained below for reproducibility and have passed for the current image:

```powershell
.\apps\media-worker\test\build-deploy-c6-provider-tail-fix.ps1
.\apps\media-worker\test\authorize-c6-supabase-cli.ps1 -RunGeometryRecovery
```

The recovery command admits at most 2,000 ms of final provider-only tail drift,
recovers and cleans the exact retained portrait fixture, then runs only the
remaining letterbox and terminal unsafe cases. It never reseeds portrait.

The Staging runner executes portrait and letterbox publication lifecycles plus
one terminal partial-visibility rejection. It exports only the two accepted
private derivatives to
`$env:TEMP\Annotated-c6-geometry-portrait-acceptance.mp4` and
`$env:TEMP\Annotated-c6-geometry-letterbox-acceptance.mp4`, cleans every remote
fixture after validation, keeps both schedules paused, and never accesses
Production. Stop without rerunning if a retained-fixture warning appears.

Owner playback of portrait and letterbox passed at exactly 9 seconds: correct
crop with no magenta border, smooth motion, clear speech, steady tone, balanced
channels, and clean endings, with no crackle, clicks, warble, or dropouts. Gate
5c is accepted. Gate 5d audio-crackle is next.

Gate 5d starts with a Local-only, network-free worker comparison:

```powershell
$env:ANNOTATED_FFMPEG_BIN = Join-Path $env:TEMP 'Annotated-ffmpeg-8.1-42c721d1f3164c61b72b7aaeba07772d\extracted\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin'
$env:ANNOTATED_C6_AUDIO_QUALITY_ROOT = Join-Path $env:TEMP 'Annotated-c6-audio-quality-local-final-v2'
node .\apps\media-worker\test\run-c6-audio-quality-local.mjs
```

The accepted run generated three 90-second samples for each of audio-only Opus,
VP9/Opus, and VP8/Opus. All 9/9 raw-excerpt/final-AAC comparisons passed bounded
signal checks and produced three blinded WAV pairs for owner listening. On
2026-08-23 the owner completed all three pairs on two distinct output devices;
both A and B passed every pair, neither version was worse, and tone, channel
balance, and endings passed without audible defects. Device names were withheld
by owner choice. The revealed mapping covered raw-as-A, derivative-as-A, and all
three source variants, so no repeatable worker-derivative degradation was
observed. The temporary directory is evidence, not a repository dependency.

The browser portion of Gate 5d uses a disposable Chrome profile and a
localhost-only collector. Diagnostic captures never call the hosted upload or
completion routes, so the loopback-off case is not misrepresented as valid
capture metadata. Production defaults remain loopback on, a 1,000 ms timeslice,
automatic codec preference, and browser-default bitrates. The bounded variants
are `vp9-default`, `loopback-off`, `timeslice-none`, `vp8-default`,
`vp9-explicit`, and `vp8-explicit`, with at most three captures each. Prepare it
from the repository root:

```powershell
node .\apps\media-worker\test\run-c6-browser-audio-matrix.mjs prepare
```

The collector binds only to `127.0.0.1`, writes checksummed raw evidence under
`$env:TEMP\Annotated-c6-browser-audio-matrix`, adds no extension host permission,
and does not access Staging or Production. Owner Chrome acceptance remains
required; preparation alone is not acceptance.

The first browser variant, VP9/Opus with loopback enabled, a 1,000 ms
timeslice, and browser-default bitrates, passed three exact 90,000 ms live
captures across two public Blender sources and two anonymous owner-selected
output devices. One earlier 89,394 ms calibration capture is retained but
excluded. The real Chrome Blobs exposed two Local worker regressions: live WebM
has no container duration, and a narrow tab viewport may be centered inside a
wider `crop-and-scale` track. Packet timestamps now provide a bounded duration
fallback, and exact track dimensions plus `resizeMode = crop-and-scale` allow a
uniform centered viewport mapping. All other aspect mismatches still fail
closed. The three real Blobs then passed the worker derivative and audio-signal
checks; the representative blind pair remains sealed until owner listening.

The loopback-off variant then completed one bounded 89,568 ms causal capture.
It was intentionally excluded from the exact 90,000 ms repetition count, but
retained as valid one-factor evidence: live tab playback became silent, the raw
Blob retained stereo audio, and its 89,564 ms H.264/AAC worker derivative passed
the channel-balance, discontinuity, near-zero-run, and window-energy checks.
Normal worker validation still rejects `loopback_enabled = false`; the Local
analysis used an explicitly recorded validation-only metadata copy and did not
weaken production acceptance. Combined with the three exact VP9-default browser
captures and the 9/9 worker-boundary matrix, this closed the Local causal gate.
The remaining no-timeslice/VP8/explicit-bitrate repetitions were not executed
because no defect reproduced and further owner repetitions would add little
evidence. The previously completed exact 90-second Staging lifecycle supplies
the remote half of this gate: it reached ready/published in one attempt, cleaned
raw storage, and passed owner playback with all four markers, steady tone,
balanced channels, a clean ending, and no crackle, clicks, warble, or dropouts.
Gate 5d is accepted; full repository regression and delivery readiness are next.
