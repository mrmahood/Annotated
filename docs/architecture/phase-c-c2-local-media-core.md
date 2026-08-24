# Phase C C2 local media core

Status: C2 complete locally, 2026-08-16. This increment contains no database,
Storage, lease, transcription-provider, dispatcher, cloud, deployment, commit,
or remote Git work.

## 1. Delivered boundary

The dependency-free local core under `apps/media-worker/` now:

- requires capture-metadata version 2 and returns `recapture_required` for every
  version 1 video or audio row;
- runs ffprobe with a fixed argument list and validates authoritative container,
  stream, codec, duration, dimension, and byte facts;
- accepts only the expected WebM/Opus audio layout and WebM VP8/VP9 plus Opus
  video layout;
- validates stable start/end viewport, DPR, scroll, rectangle, fullscreen,
  track-aspect, intrinsic-size, and computed-style facts;
- fails closed for partial visibility, aspect mismatch, movement, resize, DPR
  change, missing end samples, unsupported style, or an unsafe calculated crop;
- maps viewport-relative CSS geometry to the probed encoded frame, clamps the
  crop, and produces even coordinates without adding scroll offsets;
- removes the measured monotonic lead-in, crops before scale, never upscales,
  and bounds video to 426x240 with even dimensions;
- produces H.264 Main/yuv420p plus AAC-LC MP4 video and AAC-LC M4A audio using
  fixed, non-shell-concatenated FFmpeg arguments;
- re-probes every output and enforces final container, stream layout, codec,
  profile, sample rate, channel, duration, dimension, and byte limits;
- streams SHA-256 calculation from disk and returns lowercase hashes; and
- bounds executable output and timeouts with stable failure codes.

No package was installed and no lockfile changed. The modules use Node's built-
in ESM, process, filesystem, and crypto APIs. Creating the planned packaged
TypeScript/container workspace remains a later separately authorized step; C2
does not add a repository FFmpeg dependency.

## 2. Local output profile exercised

The C1 checksum-verified temporary FFmpeg build provides the LGPL-compatible
`libopenh264` encoder, so C2 exercises this initial local profile:

| Output | Local C2 profile |
| --- | --- |
| Video | MP4, H.264 Main via `libopenh264`, yuv420p, 450 kbps target, 600 kbps max, approximately 426x240 without upscaling, AAC-LC 96 kbps/48 kHz/at most stereo, fast-start |
| Audio | M4A/MP4, AAC-LC 96 kbps, 48 kHz, at most stereo, fast-start |

This is evidence that the pinned build can produce the accepted containers and
codecs. The profile is not frozen for production until the owner completes the
later representative browser, quality, A/V-sync, size, licensing, and audio-
crackle acceptance gates.

## 3. Recorded derivatives

The deterministic runner writes probe facts and hashes beneath
`apps/media-worker/test/fixtures/generated/c2/`.

| Scenario | Final facts | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Landscape | H.264 Main/AAC-LC, 424x240, 3,999.675 ms | 276,362 | `e3840190ff647cbc30cb7d2375080dd9d8414b431d1de2593a3e8001a0cc2b15` |
| Portrait | H.264 Main/AAC-LC, 144x240, 3,999.675 ms | 275,367 | `e62aface1d8907e077f0f1582e9dd0cf0a533f6833f9c9af79fc05622876fe32` |
| Letterboxed | H.264 Main/AAC-LC, 424x240, 3,999.675 ms | 276,636 | `1bb11a4f8b167ad78999c4b440f6d0bfc7c94aa12b683ac2a94664fb0e14fc75` |
| Audio | AAC-LC, 48 kHz stereo, 4,000 ms | 50,006 | `46365a2842d160c289015aee782e214e377f825d27fa2367317a4a648be2da4b` |
| 90-second audio boundary | AAC-LC, 48 kHz stereo, 90,000 ms | 26,110 | `240c876936c46e9ee8f39ce06d13ca3c1fa1d60a1017142a253b143f8c75762e` |

The small 90-second output is expected because its synthetic source is silence;
it is a duration boundary fixture, not a quality or representative-size sample.
Two consecutive runs produced identical output and evidence checksums.

The safe portrait metadata was corrected during C2 to describe a portrait
360x640 captured viewport rather than the inherited 1280x720 landscape
viewport. Raw fixtures were also corrected to include their declared 35-40 ms
lead-in, allowing the derivative to prove the full selected four seconds after
trim.

## 4. Automated gate

The focused C2 suite passes 22/22 tests. Coverage includes:

- landscape, portrait, letterboxed, and audio-only derivatives;
- 89,999 ms and 90,000 ms accepted output boundaries and a 90,001 ms
  authoritative range rejected before transcode;
- malformed bytes, an MP4 hidden under a `.webm` name, missing audio, and raw
  recorder overshoot;
- every safe and unsafe geometry fixture;
- version 1 recapture for both media types;
- fixed FFmpeg argument construction, executable timeout, probe/output
  validation, byte facts, and SHA-256 verification; and
- deterministic consecutive output runs.

`validate-fixture-contract.mjs` independently recomputes the C1 and C2 hashes
and verifies the recorded probe, codec, profile, duration, stream, and dimension
facts without requiring FFmpeg on ordinary `PATH`.

The complete existing regression gate also passes:

- Supabase schema lint: no error-level findings;
- pgTAP: 204/204;
- shared package: 18/18;
- extension: 92/92, TypeScript compile, production build, and generated-manifest
  security inspection;
- web: 28/28, lint, and production build; and
- worker syntax, PowerShell parser, fixture evidence, and `git diff --check`.

The extension build retains its existing large-chunk advisory, and web unit
tests retain their existing Node module-type warnings. C2 introduced no new
warning. No empirical browser/media acceptance is claimed.

## 5. Remaining gates

C2 proves only local deterministic media behavior on synthetic inputs. It does
not prove empirical playback, visual crop quality, audible quality, A/V sync,
production capture-metadata v2, browser compatibility, provider behavior,
database transitions, Storage operations, leases/retries, or deployment.

The next planned increment is C3, the provider-neutral transcription boundary
with a deterministic fake. A real provider, credentials, network usage, and
spend remain separately authorized. The capture-metadata v2 production change
and additive database contract correction identified by C1 also remain required
before end-to-end worker integration.
