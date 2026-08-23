# Phase C synthetic media fixtures

These fixtures support the Phase C C1 contract gate and the C6 codec matrix.
They cover supported VP9/Opus, VP8/Opus, and audio-only Opus inputs plus real
fail-closed container, stream, and codec cases. They are generated entirely from FFmpeg `lavfi` sources and contain no
downloaded media, personal data, speech, or third-party creative content.

`manifest.json` is the inventory and expected-probe contract.
`metadata/*.json` contains capture-metadata v2 cases that are safe or expected
to fail closed, plus a version 1 row that must return `recapture_required`.
`generate.ps1` creates binary media under `generated/`, probes the outputs, and
writes `generated/checksums.sha256` and `generated/probes.json`.

The generator intentionally does not download or install FFmpeg. The recorded
C1 run used a checksum-verified BtbN FFmpeg 8.1 build extracted under the
Windows user temporary directory. Its `bin` directory was prepended to `PATH`
for the generator process only. Exact release, version, and archive digest
evidence is in `generated/toolchain.json`; FFmpeg is not a repository
dependency and was not installed system-wide.

To reproduce after separately obtaining and verifying that toolchain with both
commands on the current process `PATH`:

```powershell
& .\apps\media-worker\test\fixtures\generate.ps1
```

The manifest, JSON references, recorded probes, and SHA-256 evidence can be
checked without FFmpeg:

```powershell
node .\apps\media-worker\test\fixtures\validate-fixture-contract.mjs
```

Phase C increment C2 and the C6 codec extension record six bounded local derivatives, their complete
probe facts, and recomputable hashes under `generated/c2/`. Reproduce them with
`test/run-c2-fixtures.mjs` as described in `apps/media-worker/README.md`.

Phase C increment C3 records text-free deterministic fake-transcription evidence
under `generated/c3/`. The temporary 16 kHz mono FLAC is deleted before evidence
is written. Reproduce the record with `test/run-c3-fixture.mjs`.

The script overwrites only files inside its exact `generated` child directory.
Generated files should be reviewed for size and probe facts before deciding
whether binaries or only the reproducible generator belong in Git history.

See `docs/architecture/phase-c-c1-contract-audit.md` for the audit findings and
the reason capture metadata version 2 is required.
