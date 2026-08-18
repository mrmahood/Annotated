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
$env:ANNOTATED_FFMPEG_BIN = '<verified temporary FFmpeg 8.1 bin directory>'
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
