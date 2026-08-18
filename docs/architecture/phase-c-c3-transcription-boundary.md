# Phase C C3 transcription boundary

Status: C3 complete locally, 2026-08-16. This increment uses a deterministic
fake only. It contains no real provider, credentials, network request, package
installation, database or production-capture change, deployment, commit, push,
or remote operation.

## 1. Delivered boundary

The local transcription modules under `apps/media-worker/src/transcription/`
now provide:

- fixed extraction of mono 16 kHz FLAC from the exact validated final
  derivative;
- a module-private derivative-audio capability that cannot be forged by copying
  public fields;
- derivative checksum verification before extraction and transcription-audio
  byte/checksum verification immediately before adapter invocation;
- rejection of raw WebM, missing or altered ephemeral audio, invalid final
  derivative profiles, and caller-created/full-source input objects;
- normalized NFC plain text with collapsed control/whitespace characters;
- the existing 20,000-character transcript, language-tag, 100-character
  provider, 200-character model, and 16,384-byte provider-metadata bounds;
- optional but nonempty-when-present timestamp segments, capped at 500 entries,
  2,000 characters per entry, and 65,536 JSON bytes;
- integer millisecond normalization with a documented 20 ms tolerance only for
  provider rounding overlap and derivative-end drift;
- strict ordering, positive duration, no material overlap, excerpt-relative
  zero, and final-derivative duration enforcement;
- rejection of unknown result/segment fields and non-JSON provider metadata;
- stable `transcript_input_invalid`, `transcript_invalid`,
  `provider_timeout`, `provider_rate_limited`, and `transcription_failed`
  boundaries; and
- a deterministic fake adapter whose output is derived from the verified
  ephemeral-audio checksum and contains no network capability.

The boundary returns a normalized staging candidate only after all checks pass.
It does not call the database or advance media state. C4 will be responsible for
passing an already validated candidate through the lease-fenced staging RPC.

## 2. Exact-derivative proof

`createDerivativeAudioInput` first recomputes the staged final derivative's
SHA-256, re-probes its C2 container/codec/duration/stream/size contract, and then
extracts only `0:a:0` with a fixed FFmpeg argument list. The resulting FLAC is
probed as one 16 kHz mono audio stream, hashed, and represented by a frozen
capability registered in a module-private `WeakMap`.

`transcribeAndValidate` rejects any value not registered by that extraction
path, then recomputes the ephemeral file's size and SHA-256 immediately before
invoking the adapter. Tests prove:

- a shape-identical forged object cannot invoke even a malicious adapter;
- a raw C1 WebM cannot mint the capability;
- changing the ephemeral FLAC after capability creation is detected;
- the adapter never receives a raw path, derivative path, source URL, browser
  credential, or full-source transcript; and
- the public capability omits its private ephemeral filesystem path.

The evidence runner deletes the temporary FLAC before recording results. No
transcription audio or transcript text is retained in repository evidence.

## 3. Segment normalization decision

Provider timestamps may contain fractional milliseconds or very small rounding
overlap. C3 rounds finite timestamps to integer milliseconds. If a segment
starts no more than 20 ms before the previous normalized end, its start is
clamped to that end. If a final end is no more than 20 ms beyond the derivative,
it is clamped to the floored derivative duration. Larger overlap or overflow is
`transcript_invalid`.

This tolerance cannot extend the excerpt, create a zero-duration segment, hide
unordered provider output, or admit any timestamp above the 90-second product
limit. It is stricter than the current database helper because a present empty
segment array and unknown segment keys both fail locally.

## 4. Deterministic evidence

The C3 runner used the recorded C2 landscape derivative:

- source derivative SHA-256:
  `e3840190ff647cbc30cb7d2375080dd9d8414b431d1de2593a3e8001a0cc2b15`;
- source derivative duration: 3,999.675 ms;
- ephemeral FLAC: 16 kHz mono, 31,332 bytes;
- ephemeral FLAC SHA-256:
  `72f26cfaca848ab6d234b457f3bd50c3bf9fc1365dc4ef76cac04f4857e77793`;
- normalized transcript: 35 characters, language `en`, two segments from 0
  through 3,999 ms; and
- adapter: `deterministic-fake` / `fixture-v1`, with network required `false`.

The evidence records only transcript length, hash, language, and segment bounds,
not transcript text. Consecutive runs produce the same evidence checksum.

## 5. Automated gate

The focused C3 suite passes 20/20 tests. It covers normalization, Unicode/plain-
text bounds, language/provider/model/metadata bounds, absent versus empty
segments, timestamp rounding, material overlaps, duration overflow, blank and
oversized fields, unknown fields, the 500-segment limit, bounded provider
failures, fixed extraction arguments, capability forgery, raw-input rejection,
ephemeral integrity changes, deterministic output, cleanup, and zero attempted
Node network calls while `fetch`, HTTP, and HTTPS are denied.

The combined C1-C3 worker gate passes 42/42 tests. The complete existing
regression gate also passes: Supabase lint has no error-level findings, pgTAP is
204/204, shared is 18/18, extension is 92/92 with compile/build and generated-
manifest inspection, and web is 28/28 with lint/build. The extension retains its
existing large-chunk advisory and web tests retain their existing Node module-
type warnings; C3 introduced no new warning. No empirical transcription quality
or provider acceptance is claimed because no real provider was selected or
contacted.

## 6. Remaining gates

C4 is next, but it cannot begin as ordinary orchestration work until the owner
separately authorizes the C1 additive database/RPC correction and the production
capture-metadata v2 change. C4 must keep the validated derivative-audio and
transcript boundaries intact while proving lease-fenced staging, raw deletion,
finalization, retry, duplicate dispatch, and crash recovery against Local only.

Provider comparison, terms, credentials, a real adapter, paid usage, cloud
infrastructure, Staging, and deployment remain later independent decisions.
