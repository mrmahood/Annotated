# Phase E Create and authentication plan

Status: implementation and Local integration closeout, updated 2026-08-30.
Phase D is complete. E1a was
subsequently authorized; its implementation and deterministic Local validation
are complete and merged, including focused and complete extension tests,
TypeScript compilation, production build, and manifest inspection. PR #23 passed
required CI run `32922199032`, was squash-merged into protected `main` as
`c902c2b8688c8d547cfd471f5ebe325833d22948`, and passed post-merge `main` CI run
`32922631250`. E1b passed owner Chrome acceptance and PR CI run `32964086959`,
then merged through PR #25 as
`9938d36a2e8bb9fbd96aaa4899ded664cdc7c587`; post-merge `main` CI run
`32965527019` passed. E1c passed owner Chrome acceptance and PR CI run
`33002721782`, then merged through PR #27 as
`50196d283dddec40b1fe8636435adf995f91e093`; post-merge `main` CI run
`33004543238` passed. E1d passed required PR CI run `33135378733`, then merged
through PR #29 as `ac456e072302f3cfecf70c7dfdbfa79e45ad8ace`; post-merge
`main` CI run `33135718601` passed. E1e passed Owner Chrome acceptance and
merged through PR #31 as `185d1a386ac374f7a1d9fe56dda97b872553b671`
after required PR CI run `33230216132`; post-merge `main` CI run `33230745060`
passed. E2a passed Owner Chrome acceptance and merged through PR #33 as
`83db250f9f07eeb747399546f1138b8503c44781` after required PR CI run
`33259588362`; post-merge `main` CI run `33260246341` passed. E2b passed Owner
Local web acceptance and merged through PR #35 as
`617cfdbeee4ebee6feacefa1abeb07775a250663` after required PR CI run
`33265858275`; post-merge `main` CI run `33267265075` passed. E2c passed Owner
Chrome acceptance and merged through PR #37 as
`e398b60b4a05ca98f9772dbab1d65b288e625a4f` after required PR CI run
`33289446000`; post-merge `main` CI run `33289955529` passed. E3 completed
combined Local integration and handoff, including Owner audio-upload acceptance.
PR #39 passed required CI run `33318786049` after checksum-pinned FFmpeg CI
recovery, was squash-merged as `ecee20531c8983c7bf97a80446e0fa66b0b21e78`,
and passed post-merge `main` CI run `33319090870`. X remains disabled and
unconfigured. Cross-origin player adapters, generic webpage-video
publication, later implementation, database work, provider configuration or
enablement, Local services, Staging, Production, schedules, and deployment are
not authorized by this document.

This plan is subordinate to the durable security and media rules in
`docs/architecture/media-archive-pipeline.md`. Future-code descriptions define a
fail-closed acceptance contract, not evidence that the code exists or that a live
provider flow has passed.

## 1. Verified baseline and bounded scope

Phase D closed on protected `main` at `c7056e880990fad0fa338b52a9203b5d044194a8`.
Its implementation merges are PR #20 at
`50a3f9c38683d46f23991fbbd3ee49d807528a00` and PR #21 at
`6f0f1c59acb52d5fb53dcc11dfd446b455ac5f2b`. Required Local automation,
owner Chrome acceptance, CI, bounded Staging regressions, exact fixture cleanup,
and post-merge `main` CI passed. Staging is aligned through
`20260825120300`; both worker schedules remain paused. Production was not
accessed or deployed.

Phase E is limited to two independently reviewable product changes:

- reorganize the extension's existing Context surface into an accessible Create
  surface with independent Text, Video, and Audio capabilities, drafts, and
  bounded player selection; and
- refactor Google authentication into a provider-neutral boundary, then add an
  explicit X OAuth 2.0 sign-in option on the web and extension without weakening
  identity, callback, session, or secret boundaries.

Implementation must preserve article immediate publication; hosted-media
draft-first publication; authoritative owner status; the 1,000-90,000 ms range;
private raw and processed Storage; exact-excerpt transcription; raw deletion;
same-origin, no-store, short-lived ready-media signing; no public complete raw
source, full transcript, or download action; and the accepted
`tabCapture -> offscreen -> MediaRecorder` pipeline.

## 2. Explicit non-goals

Phase E does not authorize:

- generic webpage-video publication, inaccessible cross-origin player adapters,
  DRM, paywall, download, full-source transcript, or full-source archive support;
- extension host permissions, persistent content scripts, remote page
  instrumentation, new production permissions, or a Chrome minimum below 116;
- moving the complete raw Blob through the side panel or background service
  worker, or replacing the offscreen document's Blob and upload ownership;
- server rows while a user is merely editing, local recorder completion as a
  processing signal, or public hosted media before every readiness condition;
- explicit account linking, account merging, identity recovery, or unlinking;
- deriving Annotated handles or authorization from X handles, display names,
  avatars, email text, or provider metadata;
- first-publish handle confirmation or changes to canonical routes, aliases,
  reserved handles, comments, follows, claims, votes, removal, or discovery;
- a schema change unless a later audit demonstrates one is unavoidable and the
  owner separately authorizes an additive migration; or
- live Google or X configuration, provider acceptance, deployment, schedule
  enablement, Staging access, Production access, or vendor contact.

## 3. Current Create/Context implementation audit

`apps/extension/entrypoints/sidepanel/App.tsx` exposes three top-level navigation
values: `context`, `feed`, and `account`. E1b changed the visible label and title
to Create while retaining `context` as the tested compatibility alias. The fixed
Text/Video/Audio switcher models available, recommended, and selected modes
independently and preserves each mode's draft while another mode is active.

The connected source classification remains Web page, YouTube, or Podcast/web
audio, but it no longer makes the Create modes mutually exclusive. Text remains
available on a scriptable connected HTTP(S) page when supported media is also
present. Asynchronous audio detection is page-generation-bound and does not
delete another mode's draft.

Article capture and publication already use the validated immediate-publication
RPC. Video and audio call the hosted begin RPC only after Publish, then use the
background/offscreen capture pipeline. Hosted status remains a global operation
panel and is reconciled through the owner-status RPC. The UI labels Processing
only when returned annotation/media IDs match and
`processing_status = processing` with `processing_stage = queued`.

The current media preview seeks and plays the source player from the chosen start
time. It is not a Blob preview, and the side panel never receives the complete
capture Blob. Phase E retains that distinction.

## 4. Current mode detection and source scope

| Mode | Exact Phase E source scope | Current limitation |
| --- | --- | --- |
| Text | A connected, scriptable, top-level HTTP(S) page on which existing selection capture validates the source | Restricted or otherwise unscriptable pages remain unavailable |
| Video | A connected supported YouTube watch page, or an ordinary HTTP(S) page with a readable qualifying HTML video in the top frame or a same-origin child frame | Inaccessible cross-origin, DRM, canvas-only, hidden/inoperable, source-invalid, or unsafe-geometry players remain unsupported; generic webpage publication is deferred |
| Audio | A connected top-level HTTP(S) page with an eligible top-frame `<audio>` or operable audio-only `<video>` with a credible source and readable metadata | Cross-origin/embedded players are inaccessible; more than five eligible players fail closed |

Video remained YouTube-only through E1d. A `youtu.be` URL must finish redirecting
to a supported watch page before it is available. E1e adds bounded generic web-
video availability for readable top-frame and same-origin-frame HTML players;
that availability does not imply that generic webpage publication is enabled.

E1c caps top-frame audio/video discovery at five eligible candidates and reads
only the sixth to detect overflow. One candidate auto-selects; two to five use a
native radio group in filtered DOM order; overflow fails closed. Hidden, paused,
control-less audio-only media is inoperable and does not make an article Audio-
capable, including the accepted Fox-shaped regressions.

Each candidate identity combines mode-compatible element kind, filtered ordinal,
and a page-side digest of its current source without returning, persisting, or
logging the source URL or raw DOM. The selection is scoped to the normalized page
generation. Read, range, preview/seek, hosted begin, recapture, and capture
prepare/play/finish re-enumerate and require one exact identity match; mismatch
invalidates only that mode's player selection while preserving range and
commentary. Playing state is only a status hint and never reorders candidates.

E1e retains bounded one-shot `activeTab` scripting while adding readable same-
origin child-frame enumeration. Inaccessible cross-origin or embedded media is
not enumerated, selected, or described as supported.

### Authorized E1e generic webpage-video amendment

E1e expanded Video after E1c player identity and E1d operation guards were
complete. It supports an ordinary connected HTTP(S) page when an HTML `<video>`
is readable either in the top document or in a same-origin child frame that the
extension can enumerate without adding host permissions. Cross-origin frames,
DRM/encrypted media, canvas-only renderers, detached players, and players whose
geometry cannot be mapped authoritatively remain unavailable.

Enumeration remains bounded to five qualifying video candidates across the page
and eligible frames. Identity includes page generation, normalized article-page
identity, frame path/origin, element kind and ordinal, a non-secret player/source
fingerprint, and bounded duration/intrinsic dimensions. Do not persist, display,
or log signed, tokenized, blob, or ephemeral CDN media URLs. Revalidate the same
frame and player before every read, seek, range action, hosted begin, capture
prepare/play/finish, and retry.

For a framed player, map its element rectangle into top-frame viewport
coordinates by accumulating readable frame rectangles. Reject CSS transforms,
clipping, partial visibility, frame navigation/reorder, origin changes, or any
start/end geometry mismatch. Capture remains `tabCapture -> offscreen ->
MediaRecorder`; neither frame support nor provider-specific markup may move the
Blob into the side panel or bypass worker probe/crop validation.

The connected article page, not its media-delivery URL, is the durable source.
E1e's client-side draft and capture contract reuses article source identity
without persisting ephemeral delivery URLs. Publishing remains intentionally
unavailable until a separately authorized authenticated hosted-web-video begin
boundary and additive data/route/reader handling can distinguish an article-
backed `video_clip` from a YouTube clip. Database, worker, public rendering, and
Staging changes remain separately authorized.

## 5. Existing draft and active-operation state

Text, video, and audio already use separate `chrome.storage.session` keys:

- `annotated.annotationDraft.v1` for text, bound to tab/window and normalized
  source;
- `annotated.youtubeClipDraft.v1` for video, bound to YouTube video ID; and
- `annotated.audioClipDraft.v1` for audio, bound to normalized/canonical page URL.

The UI nevertheless has shared media fields for start, end, duration, current
time, and player-read state. Clearing one media path can reset the other. Source
mismatch, reconnect, and asynchronous capability changes can also clear drafts
silently. Capability discovery must instead be non-destructive.

Hosted work differs from an editor draft. Its safe operation identifiers live in
`chrome.storage.local` and the server is authoritative. Only one hosted operation
can be active. The offscreen document owns recorder chunks, the complete Blob,
upload authorization, direct upload, retry, and cancellation. Browser restart can
recover identifiers but not an in-memory Blob; the honest choices remain
Recapture and Cancel.

E1a splits UI state into explicit `textDraft`, `videoDraft`, and `audioDraft`
models. Each media model owns its range, duration, player selection/read state,
commentary, source identity, and revision. The hosted operation remains global
and separate from all three editor models.

## 6. Available, recommended, and selected mode contract

The fixed presentation order is Text, Video, Audio. The model separates:

- **available modes**: each capability is `checking`, `available`, or
  `unavailable` with a bounded user-safe reason;
- **recommended mode**: Video when available, otherwise Audio, otherwise Text;
  this deterministic ordering is an advisory initial hint only; and
- **selected mode**: the user's explicit current editor, scoped to the connected
  window/tab/page generation and stored in `chrome.storage.session`.

With no supported restored explicit selection, select the recommended available
mode. Once the user selects an available mode, asynchronous probes do not
override it. If it becomes definitively unavailable, retain its draft, move to
the recommended available mode, and announce why. A temporary `checking` state
does not force a switch.

Text remains available on an otherwise supported HTTP(S) page when Video or
Audio is also available. Multiple available modes, multiple players within one
mode, and one player changing source are distinct states.

Selected mode is not a cross-browser preference. A same-page refresh may restore
it after revalidation, but a new normalized page identity creates a new page
generation and recommendation.

## 7. Mode transition contract

All asynchronous editor actions carry their mode, page generation, player
identity where applicable, and draft revision. A stale result cannot write into
the newly selected mode.

| Current state | Requested mode change | Required behavior |
| --- | --- | --- |
| Idle, commentary editing, or range selection | Allow | Save current draft, select requested available mode, preserve all other drafts |
| Text selection read, player-time read, seek, or preview in flight | Allow | Change visible mode; accept the result only if original mode/page/player/revision still matches |
| Article publication in flight | Lock | Keep mode fixed until the atomic validated RPC result; there is no client-side cancel |
| Hosted begin RPC or capture preparation before operation identity is known | Lock | Resolve first. If no operation exists allow switching; otherwise use the active-operation rule |
| Active capture or recorder stopping | Confirmation-gated | Explain that switching cancels capture; on confirmation invoke authoritative cancel and switch only after confirmed cleanup |
| Upload authorization, active upload, or verification | Confirmation-gated | Explain that switching cancels upload; abort/drop the Blob only through authoritative cancellation |
| Retryable waiting-to-upload with in-memory Blob | Confirmation-gated | Preserve Retry/Cancel; confirmed switching routes through Cancel so the only Blob is not stranded |
| Server processing | Allow | Processing is global and authoritative; switching neither cancels nor hides it, and cannot start a conflicting hosted operation |
| Restart Recapture/Cancel state | Allow display switch | Keep global recovery and IDs; another hosted publish stays blocked until Recapture or authoritative Cancel |
| Cancellation in flight | Lock | Apply pending mode intent only after authoritative removed/canceled result |
| Error with no operation and no Blob | Allow | Preserve drafts and show a bounded retry/error message |

Every destructive dialog names the affected mode and range, offers **Keep
working** as the safe default, and makes **Cancel capture and switch** explicit.
Escape and dialog close take the safe path. Switching during server Processing is
not destructive and must not prompt.

## 8. Draft retention, invalidation, and recovery

A draft remains until that draft publishes successfully, the user explicitly
discards it, or explicitly replaces it after a source conflict. Mode change,
capability completion, temporary player loss, reconnect, refresh, or navigation
is not a deletion event.

On navigation to a different normalized source, mark the prior source-bound draft
detached; do not clear it. Offer **Return to source** guidance or explicit
**Discard and start here**. A same-source reconnect restores after capability and
player revalidation. Discarding one mode never discards another.

A media source/player fingerprint change invalidates only that mode's selection
and range validation while preserving commentary and recorded values for review.
The user must reselect and revalidate before preview or publish. If a hosted draft
already exists, fail closed and route through authoritative cancellation.

`chrome.storage.session` remains appropriate for editor drafts and selected
mode/player state; cross-browser-restart recovery is not promised. Hosted IDs
remain in `chrome.storage.local`. No Blob, token, signed URL, provider code, or
provider session artifact is added to editor storage.

## 9. Player enumeration, selection, and revalidation

### Enumeration and bounded identity

Each applicable mode presents at most **five candidates** and reads a sixth only
to detect overflow. More than five produces a bounded overflow state and no
selection until the page has five or fewer. Never silently truncate or choose
from an incomplete set.

Eligibility remains strict and mode-specific. Candidates use filtered top-frame
DOM order; playback state does not reorder them. Bounded display metadata is:

- element kind (YouTube video, audio, or audio-only video);
- accessible label normalized/truncated to 120 characters;
- ready/playing state; and
- finite bounded current time and duration when available.

Do not expose media URLs, raw DOM, page-text blobs, query strings, tokens, or
unbounded metadata. One qualifying candidate may be chosen deterministically.
Two through five require explicit selection in a radio group; playing status is
only a hint.

A player identity is valid for one page generation. It combines element kind,
deterministic ordinal, and a page-side digest of normalized current-source
attributes and non-secret media properties. The ordinal is never trusted alone.
No persistent DOM marker or remote instrumentation is added.

### Revalidation points

Immediately before every time read, set-start, set-end, seek/preview, hosted-begin
handoff, capture prepare, capture play, and capture finish, enumerate again and
require exactly one match for page identity/generation, mode, kind, and source
fingerprint. Preserve all finite-duration, range, current-time, geometry, source,
tab, and target validation. Missing, duplicate, reordered-with-mismatch, or
changed matches invalidate selection and require reselection. A background or
offscreen message cannot revive a stale identity.

Multiple modes on a page do not themselves require player selection. Multiple
candidates within Video/Audio do. A source-changing player invalidates only its
mode. Unsupported or inaccessible embeds are not candidates and get a bounded
explanation.

### Selector accessibility

Use a labeled radio group. Arrow keys move, Tab enters/leaves, Space selects,
focus is visible, and assistive technology receives selected state, kind, bounded
label, status, and set position. Candidate changes announce politely without
moving focus. Overflow/disappearance/source errors focus an actionable heading
only after a user action; passive changes use a live region.

## 10. Accessible Create UI and responsive layout

The visible top-level label and heading become Create. A single-select
Text/Video/Audio control sits at the top. Use a semantic tablist only if panels
fully implement tab behavior; otherwise a fieldset/radio group is the recommended
lower-risk E1b design. It needs an accessible name, programmatic
selected/disabled/checking states, visible focus, keyboard operation, and live
capability message. Color is not the only state cue.

The selected editor follows. The global hosted operation/recovery panel remains
visible outside mode-specific editors. Inactive modes may show **Draft saved** but
must not expose unrelated commentary/source details.

At 390 px and the existing 340 px breakpoint, labels remain visible, candidate
rows wrap, actions stack logically, dialogs fit without horizontal scrolling, and
touch targets stay usable. Focus order is switcher, capability/status, player
selector, editor, actions, then global operation controls. Feed and Account are
unchanged.

## 11. Current Google authentication audit

The extension is Google-specific. `extension-auth.ts` asks Supabase for a Google
URL with `skipBrowserRedirect`, opens `chrome.identity.launchWebAuthFlow`, verifies
the exact `.chromiumapp.org/auth/callback` origin/path, parses bounded implicit
fragment tokens, and calls `setSession`. Its client uses only project URL and
publishable key, persists the Annotated session in `chrome.storage.local`, enables
refresh, disables URL detection, and declares implicit flow. Errors/helper names
are Google-specific. Callback completion does not verify that the resulting
user's identities contain the provider that began the flow.

The web has two Google-specific button implementations. Its callback validates a
safe relative `next` and performs one server-side `exchangeCodeForSession`, but
error UI is Google-specific and the result is not checked against an expected
provider identity. There is no callback route test.

The profile trigger copies allowlisted name/avatar fields from auth metadata. Its
`SECURITY DEFINER` has empty `search_path` and schema-qualified objects. Copied
metadata is presentation only. Stable handles are generated separately and keep
their stable suffix; provider username is unused.

The extension manifest already has exactly `sidePanel`, `activeTab`, `storage`,
`scripting`, `identity`, `tabCapture`, and `offscreen`, no `host_permissions`, and
minimum Chrome 116. Phase E needs no permission change.

Local `supabase/config.toml` currently enables refresh-token rotation with a
10-second reuse interval and allows only the existing loopback web site/redirect
entries (`http://127.0.0.1:3000` and `https://127.0.0.1:3000`). It does not enable
an X provider or list an extension callback. Those facts are configuration
preconditions, not permission to change them.

## 12. Provider-neutral authentication design

E2a created a closed provider type `google | x` plus safe label metadata, while
enabling and exposing only **Continue with Google**. Shared code owns start,
callback-state validation, session setup, expected-provider verification,
cancellation, and provider-neutral safe errors. E2b implemented the web-only X
start and callback path behind an explicit disabled-by-default capability; it
did not expose or enable **Continue with X**. E2c implemented the extension-only
X boundary and expected-identity validation behind the same disabled-by-default
capability without changing production permissions. Any live web or extension
exposure still requires separate provider configuration and enablement
authorization.

Web start passes an allowlisted relative next path and integrity-protected
expected-provider hint through server-controlled state. The callback exchanges
the code exactly once, then requires `user.identities` to contain the expected
provider. Do not rely solely on `app_metadata.provider`, because a linked account
can retain its original primary provider. The hint is not authority. On mismatch,
clear the local session and return a generic auth error.

Extension `signInWithProvider(provider)` preserves exact `chrome.identity`
origin/path validation and bounded parsing. After `setSession`, inspect the
established user and require the expected identity; mismatch signs out locally,
purges the attempted session, and returns a generic error. Allow one active auth
attempt per extension context; a stale callback cannot satisfy a later attempt.

Do not migrate the current extension implicit callback solely because the
Supabase X adapter uses PKCE in its provider-to-Supabase exchange. E2a verified
current client behavior without requiring a flow migration. Any later-required PKCE
verifier is short-lived attempt state and never logged.

## 13. X callback, session, and error contract

Current Supabase documentation identifies the provider as exactly `x`. X uses the
Supabase Auth vendor callback
`https://<project-ref>.supabase.co/auth/v1/callback` (Local:
`http://localhost:54321/auth/v1/callback`). Application redirects must separately
be allowlisted in Supabase, and X requires exact registered redirect matching. No
dashboard, allowlist, or vendor change is authorized here.

The current Supabase X adapter requests `users.email`, `tweet.read`, `users.read`,
and `offline.access` by default. Phase E adds no application-requested scope and
uses no tweets, follows, DMs, or write access. E2b reverified the identifiers,
defaults, callback requirements, and provider-token persistence boundary before
implementation; no provider was configured. Annotated has no product need for
provider access/refresh tokens: application code must not read, copy, transmit,
log, or add them to
application-owned records or storage. E2 must audit the Supabase client's actual
serialized-session behavior. If its browser persistence includes provider tokens,
stop and design a supported exclusion boundary before enabling X. The ordinary
Supabase access/refresh session continues through the existing auth boundary. X
email may be absent.

Denial, cancellation, malformed origin/path, missing/duplicate code or token,
malformed bounds, exchange failure, invalid/expired session, refresh failure,
provider mismatch, and timeout map to bounded provider-neutral messages. UI,
analytics, logs, thrown messages, snapshots, and URLs must not expose callback
URLs, codes, access/refresh tokens, client secrets, signed URLs, or provider
payloads.

Supabase access-token expiry stays inside the client refresh boundary. Rotated
refresh tokens are not reused outside documented behavior. Invalid/unrecoverable
refresh signs out and offers new sign-in; metadata or a prior user's session is
never a fallback.

Authoritative references reviewed:

- [Supabase X OAuth 2.0 guide](https://supabase.com/docs/guides/auth/social-login/auth-twitter)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase `setSession`](https://supabase.com/docs/reference/javascript/auth-setsession)
- [Supabase X provider implementation](https://github.com/supabase/auth/blob/master/internal/api/provider/x.go)
- [X OAuth authorization-code flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

## 14. Account-linking and conflict policy

Phase E supports sign-in; it does **not** add explicit linking/unlinking. Local
`supabase/config.toml` has `enable_manual_linking = false` and it stays false.
Supabase may automatically link identities when its current verified-email rules
recognize the same user. Annotated adds no custom merge and makes no promise that
an X login reaches an existing Google account.

Existing Google users should keep using Google unless X supplies the same
verified email and Supabase safely recognizes it. If X omits email or supplies a
different one, the flow may produce a separate account or fail under provider
policy. Warn before first X use: “Use your existing sign-in method to return to
the same Annotated account. X may create a separate account if it does not provide
the same verified email.”

Never merge or authorize on display name, X handle, avatar, raw email text,
profile metadata, or Annotated handle. On provider/identity/concurrency conflict,
clear only the attempted local session, preserve server records, and direct the
user to the original provider. Phase E has no destructive merge/unlink recovery.

Later explicit linking would require an authenticated account, recent auth where
supported, explicit intent, verified callbacks, deterministic conflict/recovery,
at least two retained identities before unlink, takeover review, audit events,
and complete web/extension coverage. Avoiding duplicates is insufficient reason.

## 15. Profile metadata and canonical handles

Provider data copied by the profile trigger is untrusted presentation data. It
cannot control RLS, identity, ownership, votes, comments, follows, claims,
publication, signing, moderation, or routes.

X usernames never replace or claim Annotated handles. Generated handles, aliases,
stable suffixes, and historical redirects remain. Canonical routes stay
`/{USERNAME}/{title-derived-slug-with-stable-suffix}`; reserved roots remain
`api`, `auth`, and `_next`.

First-publish handle confirmation remains future. Combining it with auth expands
recovery/collision/alias/route scope without being needed for X sign-in.

## 16. Database impact

No schema change is justified. Supabase Auth owns provider identities; the profile
trigger and handle functions already tolerate provider-neutral presentation data.
Do not add an identity-link table or provider-token columns.

If implementation proves a database change necessary, stop with evidence. Any
migration must be additive and separately authorized, preserve applied history,
use explicit grants/RLS, and give `SECURITY DEFINER` functions empty
`search_path` plus schema-qualified objects. Never edit/repair applied history.

## 17. Security and privacy threat review

| Threat | Required control/regression |
| --- | --- |
| Arbitrary/stale player | Bounded enumeration, explicit selection for 2-5, page-generation fingerprint, revalidation before every action |
| Source swap | Fingerprint mismatch invalidates only that mode; retain draft; authoritatively cancel a created hosted operation |
| Cross-origin/hidden confusion | Top-frame one-shot scripting; inaccessible embeds unsupported; geometry/source/target validation retained |
| Draft loss/state bleed | Separate typed state/storage, revision-tagged async results, explicit discard only |
| Blob abandonment | Confirmation plus authoritative cancel; offscreen owns Blob until upload/cancel |
| False Processing | Matching owner-status IDs and exact status/stage; never infer from recorder |
| Callback substitution | Exact web allowlist and extension origin/path; reject malformed/extra data |
| Open redirect | Strict relative next parser; reject absolute, protocol-relative, backslash, controls |
| Provider mix-up/login CSRF | Integrity-bound provider/attempt, one attempt, identity check, purge mismatch |
| Secret leakage | Generic errors; no callback/payload logging; publishable-key-only clients; secrets outside repo/browser |
| Metadata authority | Verified server session/bearer JWT only; metadata presentation-only |
| Unsafe merge/takeover | No custom merge/manual linking; only Supabase verified-email behavior; fail closed |
| X omits email | Do not assume it; warn about separate accounts; no fallback merge |
| Stale/cross-user session | Isolate attempts/storage, sign out fixtures, verify user after callback/refresh |
| Refresh replay | Supabase rotation only; test failure and signed-out recovery without token output |
| Hosted/public regression | Article/hosted gates; private buckets, exact public excerpt only, raw deletion, no-store short-lived signing, no complete source/transcript/download, RLS, comments, follows, claims, votes, canonical routing, removal, and discovery unchanged |

## 18. Rollback and feature-disable boundaries

Create UI, player selection, and X sign-in are independently disableable. E1 may
restore visible Context/current rendering without deleting drafts or operations.
E1c failure disables the media action and fails closed, never falling back to a
first-player capture.

E2 rollback hides X and, when separately authorized, removes its redirect entry.
The provider-neutral Google refactor must preserve proven Google behavior and can
be reverted before X config. Rollback never deletes auth users, unlinks identity,
changes handles, edits migrations, publishes private media, or interrupts server
processing/cleanup.

## 19. Automated test matrix

Every reproduced defect receives a regression.

### Extension

- E1a: capability states, deterministic recommendation, explicit selection
  retention, fallback announcement, Text+Audio/Text+Video coexistence, and
  page-generation scope.
- E1a/E1b: all draft suites cover switching, async races, navigation detachment,
  reconnect, explicit discard, publish-only clearing, and cross-mode isolation.
- E1b: visible Create, fixed order, radio semantics, keyboard/focus/live status,
  inactive-draft indicator, and 390/340 px contracts.
- E1c: 0/1/2/5/6+ audio/video candidates, DOM order, bounded labels, no URL/DOM
  leak, selection, overflow, disappearance, reorder, duplicate fingerprint,
  source swap, stale index, navigation, inaccessible embed.
- E1c: revalidation before read/start/end/preview/begin/prepare/play/finish while
  source/range/duration/geometry checks remain.
- E1d: every transition-table row, safe dialog default, begin race, capture,
  stopping, authorization/upload/verification/retry, authoritative cancel,
  Processing switch, restart Recapture/Cancel, and stale-result isolation.
- E1e: top-frame and same-origin-frame discovery, bounded global ordering and
  overflow, stable frame/player identity, top-frame geometry, source replacement
  and reorder, transient-ad rejection, action-time revalidation, independent
  drafts, and exact tenth-second range display.
- E2a: all Google success/failure plus exact callback origin/path, denial, cancel,
  timeout, malformed/duplicate fragment, missing/malformed bounded tokens, session
  failure, provider mismatch, one-attempt rule, purge, redacted errors.
- E2c: same extension matrix for `x`, identity-array verification, and unchanged
  permissions.
- Static scans: no forbidden permissions/content script, secret pattern,
  token/code logging, Blob side-panel transfer, application-authored provider-
  token persistence/use, or metadata authorization; a focused serialization test
  proves whether the underlying auth client persists any provider-token field.

### Web

- E2a: the provider-button interface exposes only enabled Google; safe/unsafe
  next, one exchange, generic errors, and signed-out recovery remain.
- E2b: X start/success, denial/cancel, missing/duplicate/malformed/invalid/expired
  code, exchange failure, expected-provider mismatch, missing identity,
  concurrent/stale attempt, invalid session, refresh rotation, purge, and
  token-safe response/log snapshots.
- Profile: provider metadata cannot change ownership/handle; X username cannot
  claim reserved roots; aliases/routes remain stable.

After focused tests for each increment, E3 ran the applicable `AGENTS.md` gates:
Local database lint/pgTAP in required CI, shared tests, extension tests/compile/
build, web unit/lint/build, production-manifest inspection, media-worker
regressions, and `git diff --check`. Owner Local integration and audio-upload
acceptance also passed.

## 20. Exact owner Chrome acceptance matrix

Automation is not browser acceptance. On a clean build, record Chrome version,
build/commit, redacted page identity, viewport, expected/actual, safe screenshot
or recording, and pass/fail. Stop at any source, ownership, privacy, callback,
draft-loss, or credential mismatch.

| Case | Exact action | Expected/evidence |
| --- | --- | --- |
| Create/switcher | Open ordinary HTTPS article; tab through nav and modes | Visible Create; fixed Text/Video/Audio; correct focus/announcement; no trap |
| Responsive | Set panel to 390 px then near 340; open each mode/dialog | No horizontal scroll, clipping, overlap, or unreachable action; screenshots |
| Article | Select text, comment, switch/back, publish disposable annotation | Text draft survives; existing immediate publication succeeds |
| YouTube/coexistence | Open supported top-level watch page; use Video and Text if capture supports exact page | YouTube-only Video; explicit selection/drafts persist; record exact Text result |
| Audio/Text+Audio | Open controlled same-origin audio page; draft both modes | Both available, recommendation advisory, drafts independent |
| Multiple audio | Open 2/5/6 eligible-player fixtures; keyboard/screen-reader check | 2/5 explicit choice; 6 overflow/block; stable bounded labels; no URL leak |
| Generic webpage video | Open controlled top-frame and same-origin-frame fixtures; exercise playing/paused range, Text switching, reorder/source replacement, and overflow | Stable selection; drafts persist; visible Start/End difference equals Length to a tenth; unsafe changes and sixth candidate fail closed |
| Cross-origin video | Open a controlled inaccessible cross-origin player | Video remains unavailable; no identity, geometry, or delivery URL leaks |
| Player change | Select then remove/change fixture player before preview and Publish | Fail closed; draft stays; reselect/revalidate; unrelated draft unchanged |
| Capture switch | Start disposable hosted capture; switch in prepare/record | Prepare locks; capture prompts safe default; confirmation waits for cancel |
| Upload/retry switch | Reach upload and approved retryable condition; switch | Prompt; no silent Blob drop; Retry/Cancel accurate; no signed URL visible |
| Processing switch | Reach authoritative queued Processing; switch | Allowed; matching global status stays; no conflicting hosted publish |
| Restart recovery | Close Chrome with in-memory capture awaiting upload; reopen | No false recovery; reconcile IDs; honest Recapture/Cancel |
| Hosted lifecycle | Publish disposable Video and Audio excerpt | Private/draft-first until ready; exact transcript; raw deletion; authoritative publication |
| Google web/extension | After authorized config, use disposable users; refresh/sign out/switch | Correct session persistence/refresh/sign-out/cross-user isolation |
| X web/extension | After authorized config, repeat with disposable X users | Explicit provider; no merge promise; handle stable |
| Denial/cancel/mismatch | Deny/cancel; use deterministic mismatch fixture | Safe error; no residual attempted session; no callback data display |
| Handle stability | Use each approved provider for safe disposable identity | Canonical handle/alias/stable-suffix route unchanged |
| Permission/privacy | Inspect extensions page, manifest, DevTools console/network/storage/public payloads | Exact seven permissions, no hosts, Chrome 116, no credentials/codes/tokens/signed URLs/provider tokens/voter identities |

Live provider rows remain unpassed until owner-performed after separate config
authorization with supplied evidence.

## 21. Sequencing and narrow authorization boundaries

1. **E1a — mode capability/data contract (complete and merged).** Pure models,
   page-generation/revision, independent state, and focused regressions merged
   through PR #23; no visible/capture change.
2. **E1b — Create rename/switcher/drafts (complete and merged).** Visible UI and
   non-destructive storage transitions merged through PR #25 as
   `9938d36a2e8bb9fbd96aaa4899ded664cdc7c587`; source support unchanged.
3. **E1c — player discovery/selection (complete and merged).** Maximum five,
   page identity, explicit selection, and action-time revalidation merged through
   PR #27 as `50196d283dddec40b1fe8636435adf995f91e093`; PR CI `33002721782` and
   post-merge `main` CI `33004543238` passed. Video remains YouTube-only.
4. **E1d — operation guards (complete and merged).** Bounded begin/capture/
   upload authorization and verification/retry/authoritative cancel/Processing/
   restart transitions, safe-default switching, stale-result isolation, and
   completed-recorder reconciliation merged through PR #29 as
   `ac456e072302f3cfecf70c7dfdbfa79e45ad8ace`; PR CI `33135378733` and
   post-merge `main` CI `33135718601` passed. Video remains YouTube-only.
5. **E1e — generic webpage video (complete and merged).** Bounded top-frame and
   readable same-origin-frame discovery, explicit identity, source-safe geometry,
   action-time revalidation, transient-ad exclusion, independent drafts, and
   tenth-second range display merged through PR #31 as
   `185d1a386ac374f7a1d9fe56dda97b872553b671`; PR CI `33230216132` and post-merge
   `main` CI `33230745060` passed. Owner Chrome acceptance completed. Inaccessible
   cross-origin players fail closed, and their adapters plus generic webpage
   publication remain separate increments.
6. **E2a — provider-neutral auth (complete and merged).** Provider-neutral web
   and extension boundaries preserve Google and add bounded attempt/provider/
   callback/session checks, one-attempt handling, safe cleanup, mismatch
   rejection, and token-safe errors. Owner Chrome acceptance completed. PR #33
   passed required CI run `33259588362`, was squash-merged as
   `83db250f9f07eeb747399546f1138b8503c44781`, and passed post-merge `main` CI run
   `33260246341`. X remained absent and unconfigured.
7. **E2b — X web (complete and merged).** Web-only X start/callback behavior,
   bounded provider/attempt/session validation, negative coverage, safe returns,
   cleanup, refresh behavior, and token-safe responses remain behind an explicit
   disabled-by-default capability. Owner Local web acceptance completed. PR #35
   passed required CI run `33265858275`, was squash-merged as
   `617cfdbeee4ebee6feacefa1abeb07775a250663`, and passed post-merge `main` CI run
   `33267265075`. X remains disabled and unconfigured.
8. **E2c — X extension and identity policy (complete and merged).** Extension-only
   X OAuth behavior, exact callback validation, expected identity-array checks,
   one-attempt and stale-callback isolation, safe cleanup, refresh/session
   recovery, and token-safe errors remain behind an explicit disabled-by-default
   capability with no production permission change. Owner Chrome acceptance
   completed. Its shared YouTube/Audio acceptance blocker was corrected by
   atomically establishing `preparing` before status reconciliation; bounded
   retesting passed both capture/upload paths. PR #37 passed required CI run
   `33289446000`, was squash-merged as
   `e398b60b4a05ca98f9772dbab1d65b288e625a4f`, and passed post-merge `main` CI run
   `33289955529`. X remains disabled and unconfigured.
9. **E3 — combined validation/handoff (complete and merged).** The completed
   Create, hosted-media, web-authentication, and extension-authentication
   boundaries passed combined Local validation and Owner audio-upload acceptance.
   Deterministic media evidence and fixture readiness were reconciled. PR #39
   passed required CI run `33318786049` after checksum-pinned FFmpeg CI recovery,
   was squash-merged as `ecee20531c8983c7bf97a80446e0fa66b0b21e78`, and passed
   post-merge `main` CI run `33319090870`. X remained disabled and unconfigured;
   live X configuration and bounded Staging remain separate requests. Proprietary
   Brightcove and other inaccessible cross-origin player adapters remain deferred.
   Production was untouched.

Local callback tests use fake Supabase clients and deterministic fixtures without
credentials/live authorization. CI follows Local. Dashboard/X/redirect config is
after E2 review and before owner live acceptance. Bounded Staging follows owner
Local/provider acceptance and explicit authority. Each increment requires its own
authorization.

## 22. Fixture creation and exact cleanup

Use run-prefixed, recorded disposable identities:

- local HTTP(S) pages for article-only, one/2/5/6 audio players, audio-only video,
  source replacement, removal, navigation, bounded metadata; synthetic unit DOM
  covers YouTube multi-player states not safely reproducible live;
- fake web requests/extension redirects with obvious non-secret placeholder
  codes/tokens for callback cases;
- only after authorization, disposable non-primary Google/X users for approved
  same-verified-email and absent/different-email scenarios; and
- bounded article/video/audio rows and exact recorded raw/final object paths.

Cleanup is exact, never broad: stop capture; use authoritative cancel/delete;
verify recorded annotation/media/transcript/comment/vote/follow rows; delete only
recorded private paths via trusted cleanup; sign out and clear only disposable
local keys; remove disposable auth users/identities only with separate admin
authority; then verify each ID/path absent. Never unlink a real identity, delete a
real profile, reset a database, use wildcards, expose tokens, or claim cleanup
without zero-result evidence.

## 23. Provider cost and external configuration checkpoints

Before live X work, owner approval records:

- current Supabase plan/provider availability, quota, and cost;
- current X access/tier, OAuth 2.0 availability, terms, email behavior, callbacks,
  scopes, rate limits, and cost;
- exact environment-specific Supabase vendor callbacks and separate web/extension
  allowlists, reviewed without printing secrets;
- Google/X credentials stored only in vendor/Supabase secret configuration;
- reverified built-in X scopes and no broader app scope; and
- rollback owner/switch, disposable accounts, acceptance window, cleanup authority.

Costs, tiers, scopes, and rules are time-sensitive and must be reverified from
official sources. Code review/deterministic Local precede configuration. Supabase
Dashboard, X console, redirects, Staging, and Production are separate approvals.

## 24. Unresolved decisions and recommendations

1. **Video scope (resolved):** keep YouTube-only behavior through E1d, then add
   bounded generic top-frame and same-origin-frame HTML video in E1e. Continue
   to fail closed for inaccessible cross-origin, DRM, canvas-only, or unsafe-
   geometry players.
2. **Mode persistence:** `chrome.storage.session` for page/tab generation, not a
   global/cross-browser preference.
3. **Candidate maximum:** five presented, sixth only detects overflow.
4. **Capture/upload switching:** lock while identity is unresolved; then confirm
   and authoritatively cancel before destructive switch; allow Processing switch.
5. **Linking:** exclude manual linking and keep disabled; document only current
   Supabase verified-email automatic behavior.
6. **Google user using X:** recommend continued Google. Same account only if
   Supabase safely recognizes verified identity; otherwise no app merge and use
   disposable acceptance users.
7. **First-publish handle confirmation:** defer; retain generated handles.
8. **Live X config:** after E2 code/Local/review, before owner live acceptance and
   separately authorized Staging; Production later.
9. **X scopes/data:** add none; reverify current `users.email`, `tweet.read`,
   `users.read`, `offline.access`; do not store provider tokens/assume email.
10. **Local/vendor split:** fake clients and bounded callbacks in Local/CI; only
    owner end-to-end vendor flows count as acceptance.

E1b retained internal navigation value `context` as the compatibility alias;
the visible language is Create. E1c did not reopen or alter that resolved
boundary.

## 25. Planning validation and implementation closeout records

Completion requires cross-document contradiction review, `git diff --check`, only
the three authorized docs changed, and confirmation no Supabase environment was
accessed.

E3's combined Local integration and handoff were delivered through PR #39 after
the complete shared, extension, web, and applicable media-worker regression
gates, extension compilation and production build/manifest inspection, web
lint/build, deterministic generated-evidence reconciliation, and Owner Local
integration/audio-upload acceptance. The Owner verified HTTP 200 for the Local
web runtime and audio fixture, successful retry or recapture upload,
authoritative Processing, and no recurring `Failed to fetch`. Required PR CI
initially stopped before repository tests because its checksum-pinned BtbN
FFmpeg autobuild had expired with HTTP 404. A workflow-only recovery refreshed
the exact release URL, Linux LGPL 8.1 asset, SHA-256, and matching FFmpeg/FFprobe
version after independent bounded verification. Required PR CI run `33318786049`
then passed. PR #39 was squash-merged into protected `main` as
`ecee20531c8983c7bf97a80446e0fa66b0b21e78`, post-merge `main` CI run
`33319090870` passed, and local `main` was fast-forwarded to the same commit. The
feature branch remains preserved. A supplied proprietary Brightcove player
remained outside the accepted readable top-frame/same-origin boundary; its
adapter and other inaccessible cross-origin adapters remain separately
authorized. X remains disabled and unconfigured. E3 did not access Staging or
Production, configure providers, deploy, or enable schedules. This documentation
closeout did not access any Supabase environment.

E2c's accepted implementation was delivered as PR #37 after focused extension
authentication and capture tests, the complete extension regression suite,
TypeScript compilation, production extension build and manifest inspection, and
Owner-completed Chrome acceptance. Acceptance verified X remained absent and
non-executable, Google cancellation/retry, duplicate-attempt rejection, session
restoration, sign-out/recovery, token-safe storage/console/network behavior,
unchanged production permissions, and authenticated article publication. The
initial YouTube and Audio smoke tests exposed a shared hosted-media start/status
race that could reconcile away a newly active capture. The correction atomically
establishes the new capture's `preparing` state before status reconciliation, and
the bounded Owner retest passed YouTube and Audio capture/upload without
`STALE_CAPTURE`, including cleanup between tests. Required PR CI run
`33289446000` passed. PR #37 was squash-merged into protected `main` as
`e398b60b4a05ca98f9772dbab1d65b288e625a4f`, post-merge `main` CI run
`33289955529` passed, and local `main` was fast-forwarded to the same commit. The
feature branch remains preserved. X remains disabled and unconfigured; no
Supabase environment was accessed, and E2c did not deploy, enable schedules, or
access Production.

E2b's accepted implementation was delivered as PR #35 after focused X web-auth
tests, the complete web unit suite, web lint/build, authentication regressions,
and Owner-completed Local web acceptance. Acceptance confirmed that X was absent
from the UI, direct and unsafe X starts failed safely through `/auth/error`, and
existing Google cancellation/retry, safe returns, refresh/session restoration,
sign-out, and signed-out recovery remained intact. Browser console, network,
cookie, and storage checks exposed no callback codes or provider tokens. Required
PR CI run `33265858275` passed. PR #35 was squash-merged into protected `main` as
`617cfdbeee4ebee6feacefa1abeb07775a250663`, post-merge `main` CI run
`33267265075` passed, and local `main` was fast-forwarded to the same commit. The
feature branch remains preserved. X remains disabled and unconfigured; no
Supabase environment was accessed, and E2b did not change extension
authentication or media behavior, deploy, enable schedules, or access
Production.

E2a's accepted implementation was delivered as PR #33 after focused and complete
extension and web regression suites, extension TypeScript compilation,
production extension and web builds, production-manifest inspection, web lint,
and Owner-completed Chrome acceptance. Acceptance verified existing Google
sign-in, cancellation/retry, duplicate-attempt rejection, session restoration,
sign-out, and signed-out recovery on both surfaces; X remained absent and
non-executable. Authenticated article publication, comments, follows, voting,
YouTube, and Audio smoke tests passed, and extension permissions remained
unchanged. Required PR CI run `33259588362` passed. PR #33 was squash-merged into
protected `main` as `83db250f9f07eeb747399546f1138b8503c44781`, post-merge
`main` CI run `33260246341` passed, and local `main` was fast-forwarded to the
same commit. The feature branch remains preserved. E2a did not expose or
configure X, change media behavior, access Supabase environments, deploy, enable
schedules, or access Production.

E1e's accepted implementation was delivered as PR #31 after deterministic Local
tests, the complete extension regression suite, TypeScript compilation,
production extension build and manifest inspection, and Owner-completed Chrome
acceptance. Acceptance verified Fox-shaped transient-ad rejection without false
Audio/Video availability, direct top-frame and readable same-origin-frame HTML5
players, independent Text/Video draft preservation, accurate playing and paused
tenth-second ranges, and unchanged YouTube behavior. Required PR CI run
`33230216132` passed. PR #31 was squash-merged into protected `main` as
`185d1a386ac374f7a1d9fe56dda97b872553b671`, post-merge `main` CI run
`33230745060` passed, and local `main` was fast-forwarded to the same commit. The
feature branch remains preserved. E1e supports bounded top-frame and readable
same-origin-frame HTML video while continuing to fail closed for inaccessible
cross-origin players. Cross-origin player adapters and the authenticated article-
backed hosted-video server/data/public-reader publication contract remain
deferred. E1e did not access Supabase environments, configure providers, deploy,
enable schedules, or access Production.

E1d's merged implementation was delivered as PR #29 after deterministic Local
tests, the complete extension regression suite, TypeScript compilation,
production extension build and manifest inspection, and owner Chrome acceptance
exercises that surfaced bounded operation-guard defects followed by their
reconciliation and required Local revalidation. Required PR CI run `33135378733`
passed. PR #29 was squash-merged into protected `main` as
`ac456e072302f3cfecf70c7dfdbfa79e45ad8ace`, post-merge `main` CI run
`33135718601` passed, and local `main` was fast-forwarded to the same commit. The
feature branch remains preserved. E1d did not access Supabase environments,
configure providers, deploy, enable schedules, access Production, or implement
E1e generic webpage video.

E1c's accepted implementation was delivered as PR #27 after deterministic Local
tests, the complete extension regression suite, TypeScript compilation,
production extension build and manifest inspection, and owner Chrome acceptance.
Required PR CI run `33002721782` passed. PR #27 was squash-merged into protected
`main` as `50196d283dddec40b1fe8636435adf995f91e093`, post-merge `main` CI run
`33004543238` passed, and local `main` was fast-forwarded to the same commit. The
feature branch remains preserved. E1c did not access Supabase environments,
configure providers, deploy, enable schedules, access Production, implement E1d
operation guards, or implement E1e generic webpage video.

The following E1a implementation authorization was granted verbatim and fulfilled
through Local implementation and validation. A later owner authorization permits
the production build/manifest check, commit, push, and Draft PR for this exact E1a
diff, and a final owner authorization permitted ready-for-review transition,
squash merge, post-merge `main` CI verification, and local `main` fast-forward.
PR #23 passed required CI run `32922199032`, was squash-merged into protected
`main` as `c902c2b8688c8d547cfd471f5ebe325833d22948`, and passed post-merge `main`
CI run `32922631250`. Local `main` was fast-forwarded to the same commit, and the
local and remote `codex/phase-e-planning` branches remain preserved. No owner
Chrome acceptance is claimed because E1a made no authorized visible behavior
change. None of these authorizations permits E1b:

> Authorize E1a only on `codex/phase-e-planning`: implement the pure Create mode
> capability/data contract, page-generation and revision rules, independent
> Text/Video/Audio draft state, and focused deterministic regression tests. Do
> not change the visible Context UI, player discovery/capture behavior,
> authentication, packages, lockfile, migrations, Supabase configuration, Local
> Supabase, Staging, Production, schedules, deployment, Git remote state, or
> provider/vendor settings. Stop after focused Local tests, the applicable
> existing extension regression suite, production-manifest inspection if a build
> is run, and `git diff --check`, then report the exact diff and results.
