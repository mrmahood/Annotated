# Phase C C5 local runtime checkpoint

Status: complete locally, 2026-08-18. The owner-approved pinned container build,
inspection, executable probes, and hardened one-media Local acceptance gate all
pass. C5 is closed; C6 remains separately authorized.

This increment is Local-only. It adds no package, lockfile, provider, cloud
host, credential, migration, Staging access, infrastructure, deployment,
commit, push, or pull request.

## Implemented locally

- A direct PostgreSQL adapter invokes the existing service-only C4 functions
  through `psql` without a new client package. Local configuration rejects
  non-loopback database and Supabase URLs.
- A private Storage adapter accepts only the two hosted-media buckets, exact
  authoritative object paths, no-upsert uploads, bounded deletion lists, and
  server-only credentials supplied at runtime.
- A one-media worker claims one UUID with a 900-second lease, resumes from
  persisted facts, downloads and verifies the raw object, creates or validates
  the deterministic derivative, transcribes only derivative-extracted audio
  with the deterministic fake, confirms raw deletion, and finalizes atomically.
- A valid deterministic processed object left by a crash before derivative
  staging is re-downloaded and validated rather than overwritten. A staged
  derivative resumes directly at transcription.
- Failures call the lease-fenced attempt-release function. PostgreSQL alone
  computes backoff, due time, the three-attempt ceiling, and terminal state.
- Dispatch candidates come from the bounded service-only function. Duplicate
  IDs are removed, concurrency is limited to 1-8, and the dispatch handler
  receives only the media UUID.
- Local dispatch authentication uses a five-minute HMAC token bound to exactly
  one media UUID and nonce. The token is passed only in the child environment;
  it is never an argument or log field. Each accepted dispatch starts a separate
  worker process for one UUID.
- Reconciliation calls the authoritative processing function for expired,
  legacy, deadline, and attempt-exhaustion cases. Retention first obtains an
  exact cleanup claim, deletes only its raw/processed paths, verifies absence,
  and then confirms cleanup with the observed timestamp and paths.
- Structured JSON logging uses an exact field allow-list. Paths, signed URLs,
  source URLs, credentials, transcript text, provider payloads, exception
  messages, and stack traces cannot enter the logger record.
- The entrypoint has a hard 600-second worker-process deadline. Container
  metadata sets a 900-second lease so process termination precedes lease expiry.

## Container contract and built evidence

The Linux/amd64 container definition pins:

- Node 24.14.1 image digest
  `sha256:e484ae3f1e3c378021c967fd42254f343c302a9263e412280eac32bf5bca7008`;
- PostgreSQL 17.6 image digest
  `sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3`;
- BtbN LGPL FFmpeg/ffprobe
  `n8.1.2-44-g7c533d0f86-20260816`, asset SHA-256
  `3a379bb6ce47ca7c175999ed44a8f386cc89a9b9e450774b69d98a2c45c5189b`.

The checksum-enforced, no-cache Local build completed as
`annotated-media-worker:c5-local`. Its local image digest is
`sha256:b1fab7ac1ac48dc1609ad22915740a509806f6b7bed26f300b5df314ba7ea977`,
platform `linux/amd64`, size 412,603,786 bytes, and 19 root filesystem layers.
The image retains the FFmpeg license, copies only worker source, defines no
secret environment values, and is configured as numeric UID/GID 10001.

Image inspection found the expected `node /opt/annotated/src/entrypoint/main.mjs`
entrypoint and `worker` command. Its environment contains only base-image names
and the non-secret worker defaults for executable paths, lease duration, and
timeout. A sensitive-name scan over the full layer history returned zero
matches. Runtime probes as the configured user returned Node 24.14.1,
PostgreSQL client 17.6, and FFmpeg/ffprobe
`n8.1.2-44-g7c533d0f86-20260816`.

## Evidence completed

- C5 unit and static container-contract tests pass 11/11, including the
  hardened Local acceptance harness contract.
- Existing media/transcription unit tests plus C5 tests pass 42/42.
- The actual loopback-only C5 integration passes 5/5 with all non-loopback
  `fetch` calls denied.
- Authenticated due dispatch processed one audio fixture through the real Local
  database/Storage contract to `ready/published`, with transcript present and
  raw absent.
- A deterministic fake provider timeout staged the derivative, released the
  lease, and produced database-owned backoff. The row was absent from the due
  list until its test clock boundary was advanced, then resumed at transcription
  and completed without replacing the derivative.
- Expired-lease reconciliation cleared the stale lease, returned the row to
  `processing/queued`, and made it due for dispatch without publishing it.
- A third-attempt failure and an abandoned upload were claimed for retention.
  Exact raw/processed objects were deleted and confirmed before both media rows
  became `removed`; both annotations remained `draft`.
- Finalizers removed all generated Local rows and private objects.
- Captured logs contained no object path, Local service key, bearer value,
  source URL, transcript text, raw exception message, or provider payload.
- Combined C4/C5 Local integration files run with test concurrency 1 because
  parallel Supabase CLI `status` processes race on its user-level Windows
  telemetry file. This serialization does not change worker or dispatcher
  concurrency; it only protects test setup.
- Worker component gates collectively pass 68 tests: 43 source/static tests,
  10 C2/C3 media/transcription integrations, the C4 10-test lifecycle/crash
  matrix, and the C5 5-test runtime lifecycle.
- Local schema lint is clean and all 229 pgTAP assertions pass. Shared passes
  18/18, extension passes 93/93 plus compile/build, and web passes 28/28 plus
  lint/build.
- The generated production manifest remains version 3 with Chrome 116, exactly
  the seven approved permissions, no host permissions, and no persistent
  content scripts. `git diff --check`, worker syntax checks, and a focused
  credential-pattern scan pass.
- Post-run inspection found zero C4/C5 fixture annotations, zero matching
  private objects, and no disabled media timestamp trigger.
- Existing nonblocking warnings remain: the extension side-panel chunk is about
  512 kB after minification, and Node reparses several web test modules because
  that package does not declare a module type.

## Empirical container acceptance

The owner-authorized Local gate created exactly one disposable audio media job
and ran it in a separately created container with Docker Desktop host networking
while runtime validation accepted only loopback database and Supabase endpoints,
a read-only root, 64 MiB writable `/tmp` tmpfs, all capabilities dropped,
no-new-privileges, 128 PIDs, 512 MiB memory, two CPUs, and explicit UID/GID
10001. Credentials and the media-bound five-minute dispatch token were passed
only through a temporary env file, which was removed in the finalizer.

The worker exited 0 and emitted six JSON records containing only allow-listed
fields. The output contained none of the service key, database URL, dispatch
secret/token, object paths, source URL, transcript text, bearer text, or file
extensions. The single row reached `ready/published` with a transcript; raw
Storage and its database reference were absent; the processed derivative was
present and inaccessible through both public and anonymous access. The harness
then removed the exact processed object, annotation cascade, source, user,
container, and temporary env directory, and verified zero fixture residue.

The image remains local only. It was not pushed or deployed.

C6, provider/host selection, credentials, Staging, provisioning, deployment,
Git delivery, and any package installation remain separately authorized.
