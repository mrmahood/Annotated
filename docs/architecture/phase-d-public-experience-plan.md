# Phase D public annotation experience plan

Status: Phase D complete and merged, 2026-08-25. D1a-D1e and D2a-D2c passed
their complete Local automated gates, owner Chrome acceptance, required CI,
bounded Staging application/regression, exact cleanup, protected squash merges,
and post-merge `main` CI. PR #20 merged D1 as
`50a3f9c38683d46f23991fbbd3ee49d807528a00`; PR #21 merged D2 as
`6f0f1c59acb52d5fb53dcc11dfd446b455ac5f2b`. Staging migration history is
aligned through `20260825120300`, both worker schedules remain paused, and all
disposable Local and Staging fixtures were removed and verified at zero.
Production was not accessed or deployed. Phase E is next and remains separately
authorized.

This plan narrows Phase D of `docs/product/roadmap.md` and the accepted hosted
media architecture in `docs/architecture/media-archive-pipeline.md`. Those
documents and `AGENTS.md` remain authoritative if this plan is ambiguous.

## 1. Outcome, scope, and non-goals

Phase D delivers two reviewable product increments:

- **D1 — canonical public annotation delivery:** one canonical creator-scoped
  page for article, hosted video, hosted audio, and compatible historical
  time-code annotations, plus trusted private ready-media playback, excerpt-only
  transcript, commentary, attribution, metadata, comments, and claims entry.
- **D2 — annotation voting:** authenticated `+1`/`-1` voting with one mutable or
  clearable vote per user and published annotation, separate public totals, and
  no voter-identity exposure or initial ranking/moderation effect.

The canonical public URL is:

```text
https://annotated.cbandcoop.com/{creator-handle}/{annotation-slug}
```

The creator handle is required because annotation slugs are unique only within a
creator. The UUID remains the authoritative database identity for comments,
claims, votes, media, transcripts, worker operations, and all mutations.

Phase D includes:

- additive handle/slug completion and safe public route-resolution contracts;
- `/{creator-handle}/{annotation-slug}` and `/a/{annotation-UUID}`
  compatibility behavior;
- one allow-listed server-side public annotation loader;
- article parity plus hosted video/audio rendering and historical time-code
  compatibility;
- a same-origin trusted processed-media signing boundary;
- transcript, creator commentary, source attribution, original links, canonical
  metadata, sharing, comments, and claims entry;
- additive vote persistence, trusted mutation/read boundaries, RLS, separate
  aggregates, UI, abuse controls, and regression tests;
- Local, CI, owner Chrome, and separately authorized bounded Staging gates.

Phase D does not include:

- changes to capture, offscreen Blob ownership, raw upload, worker/transcriber,
  retry, cleanup, or draft-first publication architecture;
- full-source media, full-source transcripts, source downloads, additional
  derivatives, DRM/paywall bypass, or a download action;
- feed recommendation or vote-ranked ordering;
- using votes for publication, moderation, claims, takedown, hiding, or removal;
- comment replies/editing, a moderation console, or expansion of the accepted
  Phase F claim/removal scope;
- the Phase E Create mode redesign, multi-player selection, or X.com OAuth;
- Production hosting, Bluehost/Lovable/DNS/TLS/OAuth configuration, schedule
  enablement, worker deployment, or Production access.

Article publication remains immediate through its validated RPC and is a
release-blocking regression gate. Hosted media remains draft-first and becomes
public only after the authoritative Phase C ready transaction has verified a
bounded derivative, an exact-excerpt transcript, and confirmed raw deletion.

## 2. Baseline database and route contract audit

This historical audit describes merged `main` after migration
`20260824020000`, before D1/D2 implementation. The Phase D closeout state is
recorded in sections 5 and 13; the baseline is retained to document why the
additive boundaries were required.

### 2.1 Database and RLS contract

- The branch has sixteen additive migrations. The first twelve are the merged
  baseline through `20260824020000`; D1a migrations `20260824120000` and
  `20260824123000` plus D1c migrations `20260824130000` and
  `20260824133000` are applied to Local only. Applied migration files are
  immutable.
- `annotations` uses UUID identity, creator/source relationships, required type
  and commentary, nullable creator-scoped `slug`, `published_at`, and statuses
  `draft`, `published`, `claim_pending`, `hidden`, and `removed`.
- `annotations.slug` is lowercase, immutable once assigned, and unique by
  `(user_id, slug)` when non-null. Hosted begin RPCs generate it, but article and
  grandfathered time-code publication paths can still leave it null.
- `profiles.username` is the current public handle. `set_profile_handle` is the
  controlled authenticated mutation, old handles are reserved permanently in
  `profile_handle_aliases`, and direct username updates are revoked. Hosted
  begin ensures a generated handle, but older/article-only creators can still
  have a null username.
- `profile_handle_aliases`, `annotation_media`, and
  `annotation_transcripts` have RLS and no direct anonymous/authenticated table
  access. The service role has explicit table privileges.
- `get_public_annotation_media(UUID)` returns only ready/public/not-removed
  media identity and playback facts. It intentionally omits the processed path.
  `get_public_annotation_transcript(UUID)` returns only excerpt text, language,
  and bounded segments; it omits provider audit fields.
- Ready hosted publication is guarded by the database: processed facts,
  transcript, raw deletion, and media/annotation relationships must all be
  authoritative. Historical published video/audio rows without
  `annotation_media` remain readable compatibility records.
- `annotation_audio` is creator-recorded commentary in a separate existing
  public bucket. Current detail rendering exposes it only for article
  annotations; it is not hosted source media.
- Comments are flat `public`/`removed` records. Public reads and authenticated
  inserts require a published parent; comment counts are exposed through a
  bounded aggregate RPC.
- Claims are insert-only to public clients and claimant fields have no public
  read path. The current insert policy constrains claim status but does not yet
  itself verify that the parent annotation is public; Phase D must preserve
  confidentiality and must not broaden this surface. Phase F owns claim-target
  hardening and moderation/removal unless a reproduced D1 bypass requires an
  earlier additive security correction.
- There is no vote table, vote RPC, vote API, vote aggregate, or vote UI.

### 2.2 Web and route contract

- `apps/web/src/app/a/[annotationId]/page.tsx` is the only annotation-detail
  route. It validates a UUID, selects a `published` annotation and related public
  target/source/profile rows, and returns not found on malformed or unavailable
  data.
- The UUID page renders article selected text or a historical video/audio time
  range, required commentary, optional article audio commentary, creator/source
  attribution, original links, follows, comments, and the private claim form. It
  does not render processed hosted media or transcripts.
- Metadata currently points canonical URLs to `/a/{UUID}` when
  `NEXT_PUBLIC_SITE_URL` is valid.
- Feed cards and UUID profile pages are chronological by `published_at`, link to
  `/a/{UUID}`, and query only `published` annotations. The stored-range mapper
  preserves the historical five-minute read ceiling while new hosted creation
  remains capped at 90 seconds.
- Public comments keep annotation UUIDs internally and already enforce published
  visibility in read/insert queries. Claims likewise receive the annotation UUID
  from the public page.
- The web app has a server-only service client boundary for hosted upload routes,
  plus bearer-token verification helpers. No current playback signing endpoint
  exists.

### 2.3 Required additive gaps

D1 must close these gaps without weakening existing RLS:

1. backfill current handles and immutable slugs for every published annotation;
2. ensure every future publication path creates them before publication;
3. resolve current/alias handle plus creator-scoped slug without leaking a
   non-public annotation;
4. distinguish ready hosted media, removed hosted media, and compatible legacy
   time-code records without exposing paths or operational fields;
5. derive the processed path only inside a service-only delivery function and
   sign it only after a fresh authoritative readiness check;
6. centralize detail loading so UUID and canonical requests cannot drift;
7. change feed/profile/share/comment-return links to the canonical URL while
   retaining UUID identity internally.

D2 must add a new isolated vote domain. It must not overload comments, follows,
annotation status, claim status, or discovery ordering.

At closeout, all five D1 migrations and all four D2 migrations are applied to
Staging, whose ledger is aligned through `20260825120300`. Canonical routing,
private ready-media delivery, excerpt transcript projection, reserved-root
handles, private vote rows, private limiter state, bounded public totals, and
service-only current-user vote state are present. Applied history remains
immutable.

## 3. D1 canonical-page design

### 3.1 Route and compatibility contract

Add the App Router page:

```text
apps/web/src/app/[creatorHandle]/[annotationSlug]/page.tsx
```

Normalize and validate route parts before database access. Handles must match the
accepted lowercase 3-30 character handle format; slugs must match the existing
lowercase 3-100 character slug format. Invalid values return the same public
not-found response as an absent annotation.

Because the canonical route now starts at the site root, framework-owned first
segments `api`, `auth`, and `_next` cannot be creator handles. Application and
extension link builders reject them and retain UUID compatibility rather than
constructing an ambiguous destination. Additive D1e migration
`20260824140000_phase_d1e_reserved_root_handles.sql` reports any existing
current/alias conflict and prevents future assignment of these reserved root
handles; already-applied D1a history is not edited.

Add a bounded public route-resolution function that:

- accepts one handle and one slug;
- resolves the handle against current usernames or permanently reserved aliases;
- joins the slug only inside the resolved creator scope;
- returns a row only when `annotations.status = published`;
- returns only annotation UUID, current handle, immutable slug, and whether the
  request used an alias;
- uses an empty `search_path`, explicit qualification, exact execute grants, and
  no dynamic SQL.

If the request uses an alias or otherwise differs from the stored lowercase
canonical path, issue a 308 redirect to the current-handle URL. The page loader
then uses the resolved UUID; route strings never become mutation identities.

Retain `/a/{annotation-UUID}`. Its behavior is:

| Resolution | UUID compatibility result |
| --- | --- |
| Published annotation with current handle and slug | 308 permanent redirect to `/{current-handle}/{slug}`. |
| Published historical annotation still missing a route part during guarded rollout | Render through the shared UUID loader; never invent or guess a route. |
| Draft, `claim_pending`, hidden, removed, unknown, or malformed UUID | Public not found; no redirect and no canonical metadata. |

The migration/backfill gate must reach zero published rows without a handle or
slug before canonical links are enabled. The fallback row above is rollback
protection, not an accepted steady state.

### 3.2 Handle and slug completion

Use one new additive migration after Local collision reporting:

1. report counts and collision candidates without changing Local data;
2. use the existing deterministic handle/slug helpers to populate missing values
   for published annotations and their creators;
3. update or replace each still-executable publication RPC so article, hosted,
   and grandfathered time-code paths ensure a handle and immutable slug before
   setting `published`;
4. add a publication guard requiring a non-null slug for newly published rows;
5. prove current handles and aliases remain globally collision-free and old
   handles remain reserved;
6. leave private historical drafts nullable until their normal publication or
   cleanup path needs a route.

Source title is the slug seed; source host and annotation kind are deterministic
fallbacks. The existing UUID suffix/collision-extension algorithm remains in
force. A later title change never changes a slug.

### 3.3 Shared trusted loader and access rules

Create one server-only loader module used by canonical rendering, UUID fallback,
metadata, and link generation. It returns a discriminated allow-listed model and
fails closed when relationships or types do not match.

| Authoritative state | Public behavior |
| --- | --- |
| Published article | Render selected passage, commentary, attribution, original link, optional creator audio commentary, comments, and claim entry. |
| Published hosted video/audio with media `ready` and not removed | Render processed excerpt player, exact excerpt transcript, range, commentary, attribution, comments, and claim entry. |
| Published video/audio with no media row | Render the historical time-code range and original-source link; do not claim that hosted playback or a transcript exists. |
| Published annotation with media `removed` | Keep the permitted public annotation text/attribution/comments/claim entry, show a stable “archived excerpt unavailable” state, and expose no transcript or playback URL. |
| Draft, `claim_pending`, hidden, or annotation `removed` | Public not found from canonical route, UUID route, metadata, comments, media, transcript, and vote surfaces. |
| Hosted row in capture/upload/processing/failed state | Parent remains draft and is public not found. No owner preview is added in D1. |

The removed-media distinction requires a new safe public media-state projection
that returns only `ready` or `removed` availability and bounded ready metadata.
It must return no raw/processed path, removal claim ID, failure details, lease,
capture metadata, checksum, provider metadata, or private timestamp.

The model variants are `article`, `video_hosted`, `video_legacy`,
`audio_hosted`, `audio_legacy`, and `media_removed`. Every variant contains the
UUID, current handle, slug, commentary, publication date, creator public fields,
source attribution, and original URL. Hosted variants additionally contain only
the safe media facts and public transcript projection.

### 3.4 Article, video, audio, transcript, and attribution rendering

- Preserve the current article passage, commentary, creator audio commentary,
  source attribution, comments, and claim behavior before adding hosted media.
- Hosted video uses the authoritative MP4 MIME/dimensions/duration in a native
  accessible player. Hosted audio uses the authoritative M4A/AAC MIME/duration
  in a native accessible player.
- Player `src` points only to the same-origin delivery endpoint. Use controls,
  bounded preload, a textual fallback, and `controlsList="nodownload"` as a UX
  hint. Do not add a download link or describe the hint as DRM.
- Show the selected source range and derivative duration. Historical time-code
  pages keep the original timestamp/deep link and do not masquerade as archives.
- Render transcript plain text and optional bounded relative segments from the
  public transcript RPC. Treat it as untrusted text and escape it normally.
  Provider/model/metadata and any full-source transcript remain private.
- A ready hosted annotation missing a valid transcript is a contract error and
  fails closed; “transcript unavailable” is allowed only for the explicit
  removed-media presentation.
- Display creator name/handle, source title, author/publisher/show/hostname,
  original link, required commentary, and publication date prominently. Keep
  source timestamps in original links for compatible video where applicable.

### 3.5 Private processed-media signing boundary

Add a same-origin GET/HEAD route keyed only by annotation UUID. The route:

1. validates the UUID and method;
2. calls a new service-only database function that locks nothing and returns the
   authoritative processed path/MIME only when annotation is `published`, media
   is `ready`, `removed_at is null`, processed metadata is complete, raw path is
   null, raw deletion is confirmed, and the transcript exists;
3. derives the exact private bucket server-side and never accepts a path, bucket,
   MIME, or expiry from the caller;
4. creates a short-lived signed URL (initial target: 120 seconds) and responds
   with a temporary redirect plus `Cache-Control: private, no-store`;
5. returns bounded not-found/unavailable codes without revealing which
   readiness condition failed;
6. logs only allow-listed IDs, outcome, latency, and stable code—never a signed
   URL, path, source URL, transcript, bearer token, or service key.

The page HTML and public RPCs never contain the signed URL. The player may retry
the same-origin endpoint once after an expiry/network error to obtain a fresh
authorization. Supabase signed URLs remain bearer credentials until expiry;
short TTL plus processed-object deletion is the revocation boundary.

Raw media is never signable, public, owner-downloadable, or a route input.

### 3.6 SEO, sharing, comments, claims, feed, and profile integration

- Generate title, description, Open Graph, X/Twitter summary metadata, and
  `alternates.canonical` from the current canonical path. Never embed a signed
  media URL, transcript body, claimant data, or private Storage metadata.
- Non-public, malformed, or unresolved routes use not-found plus no-index
  metadata. Alias and UUID compatibility routes redirect and do not compete as
  indexable duplicates.
- Configure the production origin as `https://annotated.cbandcoop.com` only in
  Phase G. Local/Staging metadata tests use their explicitly configured trusted
  origins; D1 does not change DNS or hosting.
- Feed cards, profile lists, extension ready/share actions, comment sign-in
  return paths, comment anchors, and internal detail links use the canonical
  path when route parts are available. UUID remains in mutations and component
  props.
- Preserve current comment visibility, pagination, insert/delete ownership, and
  aggregate behavior. Comments cannot make a non-public annotation discoverable.
- Keep the current confidential claim form entry on every publicly rendered
  annotation, including a permitted removed-media page. Never return claimant
  fields. Full claim target hardening and moderation remain Phase F unless D1
  testing reproduces a security defect that must be fixed additively now.

## 4. D2 voting design

### 4.1 Accepted additive schema

Phase D added `public.annotation_votes` after D1 was accepted:

| Column/constraint | Contract |
| --- | --- |
| `annotation_id uuid not null` | References `annotations(id)`; part of the primary key. |
| `user_id uuid not null` | References `profiles(id)`; part of the primary key. |
| `value smallint not null` | Check `value in (-1, 1)`; zero is represented by no row. |
| `created_at timestamptz not null` | First vote time. |
| `updated_at timestamptz not null` | Last direction change; protected by the standard trigger. |
| Primary key `(annotation_id, user_id)` | Exactly one vote per user and annotation. |
| Index `(user_id, updated_at desc)` | Bounded owner/abuse operations without creating a public graph. |

Enable RLS immediately. Revoke all privileges from `public`, `anon`, and
`authenticated`; grant only the narrowly required service-role privileges. Do
not add a readable authenticated policy. RLS remains defense in depth if a grant
regresses. Voter identity is never part of a public select or API response.

Do not add vote columns to `annotations`, comments, claims, or feed tables.
Initial totals are calculated by a bounded aggregate function. A cached summary
table may be proposed later only after measurements and with reconciliation
tests; it is not part of initial D2.

### 4.2 Trusted mutation and state boundaries

The same-origin authenticated vote endpoint verifies the bearer/session
user with Supabase Auth, accepts one annotation UUID and `+1`, `-1`, or `null`,
enforces request size/content type, and calls one service-only database mutation.

The service-only mutation:

- receives the verified user UUID, annotation UUID, and nullable vote;
- requires the user profile and `annotations.status = published` in the same
  transaction;
- upserts `+1`/`-1`, changes direction atomically, or deletes the caller's row
  for `null`;
- is idempotent for repeated same-direction and repeated clear requests;
- cannot change annotation status, timestamps, ranking, claims, comments,
  follows, media, or another user's row;
- returns only bounded action (`created`, `changed`, `unchanged`, or `cleared`),
  the caller's current vote, and refreshed separate totals.

Use stable public errors such as `AUTH_REQUIRED`, `ANNOTATION_UNAVAILABLE`,
`INVALID_VOTE`, `RATE_LIMITED`, and `VOTE_UNAVAILABLE`. Do not return SQL text,
existence details for private annotations, voter IDs, or raw exceptions.

Changing `+1` to `-1` updates the one row; it never briefly creates two votes.
Clearing deletes the row. The UI uses three explicit states: upvoted, downvoted,
and no vote. Upvote and downvote totals are displayed separately, including
zero. Optimistic UI must roll back to the authoritative response on failure.

### 4.3 Public aggregates and published-only eligibility

The bounded security-definer aggregate function accepts at most 100 unique,
non-null annotation UUIDs. It returns only:

```text
annotation_id, upvote_count, downvote_count
```

It includes rows only for annotations currently `published`, returns integer
counts greater than or equal to zero, has an empty `search_path`, and is
executable by anonymous and authenticated roles. It never returns user IDs,
vote timestamps, rows, or whether a particular user voted.

The authenticated endpoint may return the caller's own current vote after auth;
no endpoint accepts a user ID from the caller. Draft, `claim_pending`, hidden,
removed, and unknown annotations share one unavailable result. If an annotation
ceases to be published, totals and mutation state become publicly unavailable;
stored vote rows do not authorize visibility or a status transition.

Initial feed/profile queries remain ordered only by `published_at desc, id desc`.
Add a regression assertion that vote totals are absent from discovery filters,
ordering, publication guards, claim/removal functions, and worker contracts.

### 4.4 Abuse, rate limit, and regression requirements

- Enforce the accepted private PostgreSQL fixed-window limits at the trusted
  database boundary: 20 mutations per user/annotation and 100 per user across
  annotations per 10 minutes. Tests prove HTTP 429 plus `Retry-After`, recovery
  after the window, and no vote change on a rejected request.
- Bound request bytes, UUID/value parsing, database statement time, response
  shape, and aggregate batch size. Reject duplicate IDs before querying.
- The primary key limits storage amplification to one live row per user and
  annotation, but rate limiting must also bound direction-change write churn.
- Use CSRF-safe same-origin methods/cookie settings or bearer authorization as
  appropriate to the final endpoint. Reject unsupported origins where cookies
  can authorize a mutation.
- Do not log voter identity together with source URLs or public content. Use
  bounded security telemetry and short operational retention.
- Test concurrent same-user requests, duplicate submissions, direction races,
  clear races, deleted auth users, unpublished transitions, count correctness,
  integer bounds, RLS/grant regressions, service-key absence from client bundles,
  and API error redaction.
- Preserve article publication, hosted draft-first readiness, media signing,
  comments, follows, claims confidentiality, and chronological discovery as
  release-blocking regression gates.

## 5. Increment-by-increment implementation order

Each increment requires explicit authorization and stops on unexpected results.

### D1a. Route/data contract and Local migration

- Add focused failing route/loader/SQL tests first.
- Create the additive Local-only handle/slug backfill, publication guard, public
  route resolver, safe media-state projection, and service-only delivery lookup.
- Produce a Local preflight/backfill report with counts and collision handling.
- Run database lint/pgTAP and prove article and historical read compatibility.

Exit: zero Local published rows lack route parts; non-public resolution and
private path access fail closed; no remote database was accessed.

D1a completed Local validation on 2026-08-24. Additive migration
`20260824120000_phase_d1a_public_route_contract.sql` provides the transaction-
locked integrity report/backfill, publication route trigger, validated published-
slug constraint, current/alias and UUID resolvers, path-free ready/removed media
projection, and service-only processed-path lookup. Review then reproduced a
defense-in-depth gap in which delivery trusted a syntactically valid but wrongly
bound stored processed path. Because the first migration was already applied to
Local, forward correction
`20260824123000_phase_d1a_delivery_path_binding.sql` preserves immutable history
and makes both public readiness and service delivery rederive the exact expected
owner/annotation/media/type path. The focused red-to-green contract passes 55/55
tests and the complete Local database gate passes 304/304 with no schema-lint
errors. The actual Local integrity report is zero across published rows, missing
route parts, current/alias collisions, and route collisions; a rolled-back pgTAP
fixture separately proves one missing handle and slug are completed exactly once
and the backfill is idempotent. Article immediate publication and historical
two-minute time-code reads pass. Staging and Production were not accessed.

### D1b. Canonical article parity and compatibility redirects

- **Local complete, 2026-08-24.** One server-only, allow-listed detail loader
  now backs the canonical and UUID routes, metadata, and shared renderer. Route
  parts are validated before resolver access and revalidated after loading.
- `/{creator-handle}/{annotation-slug}` renders the current route; reserved
  aliases and `/a/{UUID}` return 308 to route identity returned by the published-
  only D1a resolvers. A guarded UUID rendering fallback remains only for an
  incomplete historical rollout row and never invents a route.
- Article passage, creator audio commentary, attribution, follow state,
  comments, confidential claim entry, historical two-minute video/audio ranges,
  and original-source links passed Local HTTP parity. Feed/profile detail and
  comment links use validated canonical paths with UUID fallback only when route
  identity is absent.
- Focused route tests pass 5/5. Local HTTP fixtures proved canonical 200, exact
  UUID/alias 308, and indistinguishable no-index 404 behavior for malformed,
  unknown, and known-draft requests. Exact disposable users, annotations,
  aliases, and sources were removed and verified at zero.
- Security note: the first HTTP probe was started before checking the existing
  `apps/web/.env.local`, which points to Staging. Five page requests caused
  anonymous, read-only Staging API lookups and all returned 404. The server was
  stopped immediately; no mutation, privileged call, schedule, deployment, or
  secret output occurred. Remaining integration used process-only Local values
  after a loopback assertion. This was not Staging validation or authorization.

Exit: article layout, audio commentary, comments, claims, follow state, metadata,
and historical range pages pass; unresolved/non-public rows leak nothing. Exit
was met against Local only at that checkpoint; owner Chrome acceptance
subsequently passed during D1d.

### D1c. Ready hosted playback and transcript

- **Local complete, 2026-08-24.** The same-origin GET/HEAD playback route accepts
  only an annotation UUID, revalidates the service-only authoritative delivery
  projection, signs the exact private processed object for 120 seconds, and
  returns a 307 with `Cache-Control: private, no-store` and
  `Referrer-Policy: no-referrer`. Logs contain only the annotation ID, stable
  outcome code, and latency.
- Native ready video/audio variants use the same-origin endpoint, metadata-only
  preload, normal controls, a no-download UX hint, and one bounded signing retry.
  Excerpt transcript text and relative timestamp segments render as escaped
  text. A published annotation whose media alone is removed retains permitted
  commentary and attribution with a stable unavailable presentation and no
  player or transcript.
- Additive migration
  `20260824130000_phase_d1c_public_transcript_projection.sql` exposes only the
  exact ready excerpt transcript and bounded segments. Focused review then found
  that a malformed hosted row could be indistinguishable from a legitimate
  historical row when the transcript was missing. Forward correction
  `20260824133000_phase_d1c_public_media_fail_closed.sql` adds a path-free
  `unavailable` state so the loader rejects malformed hosted publication instead
  of falling back to legacy rendering.
- Focused database tests pass 18/18 and focused web route/signing tests pass
  12/12. Verified-loopback HTTP fixtures proved ready video/audio 200 pages,
  GET/HEAD/retry 307 signing, complete 14,767-byte MP4 and 13,294-byte M4A
  delivery, 206 range seeking, removed-media presentation, and indistinguishable
  404 denial for invalid, missing-transcript, removed-signing, and private-draft
  requests. HTML and logs contained no private path, signed URL, provider
  metadata, service credential, or hidden commentary. Both private Storage
  objects and every exact database/file fixture were removed and verified at
  zero.

Exit: one ready Local video and audio play through private signing; every
non-ready/removal state is denied; raw remains private/deleted as authoritative.
Exit met against Local only; owner playback, expiry, keyboard, responsive, and
accessibility acceptance passed during D1d.

### D1d. Sharing, discovery, comments, claims, and accessibility

- **Implementation, automated Local validation, and owner Chrome acceptance
  complete, 2026-08-24.** Web feed/profile/detail and comment/follow return
  paths use validated canonical identity with UUID fallback only for an
  incomplete historical route. The extension now selects and validates creator
  username plus annotation slug and emits the same canonical public-page
  action instead of hard-coding `/a/{UUID}`.
- Hosted/removed metadata remains text-only and excludes transcript bodies,
  Storage data, and credentials. Transcript segment ranges use semantic `time`
  elements, existing native players retain named controls and one retry, and the
  responsive/focus/reduced-motion contracts have focused static coverage.
- The full pre-acceptance Local gate passes: 322/322 database assertions, 18/18
  shared tests, 98/98 extension tests, 31/31 web unit tests, 13/13 focused D1
  route/signing tests, database lint, TypeScript, web lint, both production
  builds, exact manifest inspection, and whitespace/package checks. Verified-
  loopback HTTP acceptance preparation proves canonical/alias/UUID routing,
  ready video/audio signing and range delivery, historical and removed states,
  malformed/private denial, canonical discovery links, the temporary Local-only
  session boundary, and authenticated comment create/delete.
- The first owner Chrome pass accepted playback, transcript, removed/private
  states, comments/claims, extension links, responsive layout, keyboard focus,
  and privacy, but did not independently capture 308 or extension-permission
  evidence. Product clarification then removed the mistaken `/lons` namespace;
  the corrected root route, UUID and historical-handle 308s, removed old route,
  discovery/extension links, and the manifest loaded by Chrome all passed a
  bounded owner recheck in Chrome 151.0.7922.170 on Windows 11 25H2.
- The corrected-route server was stopped and its exact Local user, profile,
  source, annotation, handle alias, SQL files, and process were removed. Exact
  post-cleanup counts were zero and port 3017 had no listener.

Exit: the D1d Local implementation and owner Chrome gate are complete. D1e
closes the corrected root-route database reservation before any remote work.

### D1e. Framework-owned root-handle reservation

- **Implementation and complete Local validation finished, 2026-08-24.** New
  immutable migration `20260824140000_phase_d1e_reserved_root_handles.sql`
  reports bounded current-handle and alias conflict counts under the existing
  handle advisory lock and aborts rather than renaming an identity.
- The applied Local preflight returned `0` current-handle conflicts and `0`
  alias conflicts. Validated table constraints protect privileged direct profile
  and alias writes; the controlled handle RPC, automatic generator, and alias
  trigger also reject or skip `api`, `auth`, and `_next` explicitly.
- Focused pgTAP passes 34/34. The complete Local database suite passes 356/356,
  with schema lint, article publication, current/alias canonical resolution,
  UUID compatibility, generated suffixed handles, and the accepted
  title-derived slug-with-stable-suffix contract all green. Complete shared,
  extension, web, compile, lint, Local-bound production-build, manifest,
  package, and whitespace gates also pass.

Exit: D1 Local implementation, route hardening, and owner Chrome acceptance were
complete at that checkpoint. Commit/push/Draft PR, CI, and bounded Staging
application were then completed under separate authorizations.

### D2a. Vote contract and Local migration

- **Implementation and Local validation complete, 2026-08-25.** Creator self-
  votes are disallowed. Private PostgreSQL-backed fixed windows allow at most 20
  mutations per user/annotation and 100 per user across annotations per 10
  minutes, return bounded retry timing, and make no vote change when rejected.
- Additive migration `20260825120000_phase_d2a_annotation_voting.sql` adds the
  private vote table, forced RLS/revoked API table access, trusted atomic
  mutation, bounded public aggregate, private pair/global limiter state, and
  opportunistic expired-state cleanup. Forward corrections
  `20260825120100_phase_d2a_vote_retry_expression_correction.sql` and
  `20260825120200_phase_d2a_vote_cleanup_contention.sql` preserve immutable
  history while correcting retry computation and cleanup contention.
- Focused pgTAP, concurrency, privacy, abuse, idempotency, opposite-direction
  race, pair/global rate-limit, unchanged-on-rejection, and exact cleanup tests
  passed against Local Supabase.

Exit met: one row per user/annotation, exact `+1`/`-1`/clear behavior, separate
totals, identity privacy, creator rejection, published-only eligibility, and
both accepted mutation ceilings passed Local tests.

### D2b. Vote API and annotation-page UI

- **Implementation and Local validation complete, 2026-08-25.** The same-origin
  authenticated API derives the voter exclusively from the verified server-side
  session, rejects cross-origin mutation and caller-supplied user IDs, maps the
  database limit to bounded HTTP 429 plus `Retry-After`, and returns private,
  no-store, bounded JSON.
- Additive migration
  `20260825120300_phase_d2b_current_vote_projection.sql` adds the service-only,
  bounded current-user vote-state projection without exposing a public vote
  graph.
- The canonical detail page shows separate totals, disabled signed-out controls
  plus an explicit sign-in action, current-user state, create/change/clear,
  creator rejection, pending semantics, and authoritative rollback after
  failures. Feed and profile cards remain vote-free.

Exit met: two Local users voted, changed, cleared, and persisted independently;
anonymous, private-state, cross-origin, caller-ID, creator, and rate-limited
mutations failed with bounded authoritative results.

### D2c. Discovery isolation and final Phase D regression

- **Complete, 2026-08-25.** Vote totals remain detail-page-only. Focused
  discovery-isolation coverage proves votes do not affect feed/profile ordering,
  publication, visibility, comments, follows, claims, removal, media lifecycle,
  transcripts, or worker candidates.
- The final Local gate passed 440/440 pgTAP assertions across 15 files, the D2
  concurrency/privacy/abuse and authenticated HTTP harnesses, 18/18 shared,
  98/98 extension, and 42/42 web tests, plus database lint, extension compile and
  production build, exact manifest inspection, web lint/build, artifact privacy
  scans, and whitespace/package checks.
- Owner Chrome acceptance passed on Chrome 151.0.7922.170 and Windows 11 25H2,
  including signed-out behavior, detail-only/discovery isolation, private 404,
  create/change/persist, cross-user and social isolation, creator rejection,
  keyboard/pending accessibility after an uncontaminated retest, 390 px layout,
  privacy, and rate-limit rollback/recovery.

Exit met: required CI, bounded Staging regression, exact cleanup, protected
merge, and post-merge `main` CI passed; both schedules remain paused and
Production remains untouched.

## 6. Completed database migration sequencing and authorization record

1. Write each migration additively; never edit the twelve merged baseline
   migrations or either D1a migration after its Local application.
2. Run D1 migration and pgTAP on Local only. Review the complete SQL diff,
   preflight counts, handle/slug collision report, grants, policies, and rollback
   boundary.
3. Implement and accept D1 locally before requesting any Staging database work.
4. Apply the exact reviewed D1 migration to Staging only after explicit approval
   that names project `nkkunkwirvfwhmpwonqz` and the migration file(s). Verify the
   ref immediately before the remote command. Keep both schedules paused.
5. Complete bounded D1 Staging acceptance and cleanup before starting D2.
6. Repeat Local-first review for the separate D2 migration. D1 authorization
   does not authorize D2 SQL or any remote application.
7. Apply D2 to Staging only after separate explicit approval and repeat the
   paused-schedule preflight/postflight checks.
8. Production migration, backfill, runtime, DNS, OAuth, schedules, and traffic
   are deferred to Phase G and require separate authorization. Never run
   `supabase db reset --linked` or repair migration history casually.

If a Staging migration has been applied, rollback uses a reviewed forward
migration or feature disablement. Do not edit or delete the applied file.

## 7. Acceptance gates — completed

### 7.1 Exact Local automated gate

Run from the repository root with the installed pnpm version and stop on the
first unexpected result:

```powershell
pnpm install --frozen-lockfile
pnpm exec supabase db lint --level error
pnpm exec supabase test db
node --test apps/web/src/lib/public-routes.test.mjs apps/web/src/lib/media-playback.test.mjs
pnpm --filter @annotated/shared test
pnpm --dir apps/extension test
pnpm --dir apps/extension run compile
pnpm --dir apps/extension run build
pnpm --dir apps/web run test:unit
pnpm --dir apps/web run lint
pnpm --dir apps/web run build
git diff --check
```

Add focused D1/D2 tests to those existing commands or document one explicit
additional repository-owned command before implementation acceptance. Focused
coverage must include:

- route-part validation, current/alias resolution, UUID/alias 308s, canonical
  metadata, backfill collisions, and future publication guards;
- public/non-public state matrix, article/legacy/hosted/removed rendering, safe
  loader allow-list, transcript bounds, and comments/claims integration;
- signing denial for every non-ready state, caller-supplied-path rejection,
  short TTL/no-store, expiry refresh, deletion/removal races, and log redaction;
- vote schema/grants/RLS, auth/published eligibility, create/change/clear,
  concurrency, separate totals, identity non-disclosure, rate limiting, and no
  discovery/moderation effect;
- article immediate publication, hosted draft-first publication, historical
  five-minute reads, exact hosted 90-second bounds, private raw/processed buckets,
  and extension manifest regression.

Inspect `apps/extension/.output/chrome-mv3/manifest.json` after the build. It must
retain exactly `sidePanel`, `activeTab`, `storage`, `scripting`, `identity`,
`tabCapture`, and `offscreen`, minimum Chrome 116, no `host_permissions`, and no
persistent content scripts.

### 7.2 Required CI gate

The protected Draft PR must run the complete Local command set above on the
reviewed branch plus focused route/security/database tests. CI must additionally
fail on:

- a public/client reference to service secrets, raw paths, processed paths,
  signed URLs in serialized HTML, transcript provider metadata, or claimant/voter
  identities;
- a non-308 compatibility response when safe canonical resolution exists;
- canonical route/metadata mismatch;
- vote-based changes to feed order, moderation, publication, claims, or removal;
- changed extension production permissions or hosted-media publication guards.

Required review/CI, owner Chrome acceptance, and bounded Staging acceptance were
separate gates; one did not substitute for another. Both post-merge `main` CI
runs passed and satisfied the final Phase D closure requirement.

### 7.3 Owner Chrome gate

Only the owner may report empirical Chrome acceptance as passed. Use a fresh
Chrome profile or the explicitly designated test profile, load the generated
extension, and run one behavior at a time. The exact checks are in section 10.

Acceptance requires current Chrome on Windows at minimum, keyboard-only page
navigation, normal and narrow responsive widths, one article, one short hosted
video, one short hosted audio, one historical time-code record, one removed-media
record, signed-out and signed-in comments, and two authenticated voting users.
Record screenshots, the visible canonical URL, redirect status evidence, media
duration/playback notes, transcript scope, separate vote totals, and any console
or network error. Stop immediately on private data, unexpected publication,
wrong-source playback, a download action, identity exposure, or state mismatch.

### 7.4 Bounded Staging gate

Staging work requires a separate authorization naming
`nkkunkwirvfwhmpwonqz`. Before and after every gate, verify both worker schedules
remain `PAUSED`; do not enable them. Do not access Production.

D1 Staging acceptance, in order:

1. apply only the approved D1 additive migration;
2. verify migration history, route backfill counts, collisions, grants, policies,
   private buckets, and zero published annotations missing route parts;
3. publish one article through the normal validated flow;
4. create one short video and one short audio through the normal hosted flow;
   if processing is needed, invoke only the approved bounded one-ID dispatcher
   path, never a schedule, and record any provider cost;
5. verify canonical/UUID/alias routes, ready private playback, transcript scope,
   source attribution, comments, claims entry, metadata, expiry refresh, and
   non-public denial;
6. verify raw deletion, processed-bucket privacy, sanitized logs, paused
   schedules, and exact disposable fixture/user/object cleanup.

D2 Staging acceptance, only after D1 closes:

1. apply only the approved D2 additive migration;
2. use two disposable authenticated users and one published article annotation;
3. verify upvote, downvote, change, clear, idempotency, separate totals, current
   user state, anonymous denial, non-public denial, and bounded rate-limit error;
4. verify feed order, claim state, annotation status, comments, media, and worker
   candidates are unchanged by voting;
5. remove every disposable vote/user/annotation fixture through approved cleanup,
   confirm no voter identities in public responses/logs, confirm schedules still
   `PAUSED`, and stop without Production access.

Any unexpected remote result stops the gate. Do not repair, reset, rerun, or
dispatch again until authoritative state is understood and the owner authorizes
the next action.

## 8. Security and privacy threat review

| Threat | Required control and proof |
| --- | --- |
| Draft/hidden/removed enumeration | Route resolver and loaders require `published`; all non-public states share not-found behavior and no canonical metadata. |
| Alias or slug collision/hijack | Current and historical handles stay globally reserved; slugs remain immutable and creator-scoped; backfill reports collisions before route enablement. |
| Open redirect or host injection | Redirect targets are constructed from validated stored route parts and a configured trusted origin, never request headers or caller URLs. |
| Path/bucket substitution | Playback accepts annotation UUID only; service-only DB lookup derives the exact processed path and bucket. |
| Premature or removed playback | Every signing request rechecks published/ready/not-removed, complete processed facts, transcript, and confirmed raw deletion. |
| Signed URL leakage/replay | URL stays out of HTML/public RPCs/logs, response is no-store, TTL is short, and object deletion bounds revocation. |
| Raw/full-source exposure | Raw bucket has no public signing/read path; only the exact derivative and excerpt transcript can be delivered. |
| XSS through commentary/transcript/source metadata | Render as escaped text, validate external HTTP(S) links, prohibit raw HTML injection, and keep CSP hardening in Phase G. |
| Claimant or voter identity exposure | Claims remain no-read; votes have no public row reads; aggregates contain counts only; logs are allow-listed. |
| Vote forgery or cross-user mutation | Auth is verified server-side; caller user ID is never accepted; service mutation touches only the verified user's composite-key row. |
| Vote write amplification/race | Composite primary key, atomic upsert/delete, request/rate bounds, concurrency tests, and no event append log in initial D2. |
| Vote-driven moderation abuse | No vote reference in feed ordering, publication guards, claims/removal RPCs, or worker paths; regression tests enforce isolation. |
| CSRF/session misuse | Use same-origin/cookie protections or bearer-token auth, reject invalid origins where needed, and keep callback/cookie redesign in Phase G. |
| Secret/client leakage | Service keys remain server-only; scan built web/extension output and error/log snapshots for keys, paths, signed URLs, and tokens. |
| Cache retains withdrawn content | Dynamic/no-store detail and playback responses, short signed TTL, fresh state checks, and processed-object deletion on removal. |

The 90-second ceiling, low-resolution derivative, commentary, attribution,
original link, no download action, claims entry, and raw deletion are product
controls, not a fair-use determination or DRM.

## 9. Rollback and cleanup boundaries

### D1

- Keep the shared UUID renderer behind an independent compatibility switch until
  canonical acceptance completes. Rollback disables canonical link emission and
  308 redirects while `/a/{UUID}` resumes rendering.
- Disable the playback route independently if signing is suspect. Hosted
  annotations may remain published with an unavailable player only under the
  accepted removed/unavailable presentation; never expose a path as a workaround.
- Generated handles, reserved aliases, and immutable slugs are durable route
  data. Do not reuse, delete, or rewrite them casually after links can exist.
- Signed URLs expire naturally; removal also deletes the processed object through
  the accepted lifecycle. Raw cleanup remains Phase C's authoritative process.
- Applied migrations roll back through forward correction only. Do not edit
  migration history or reset a linked database.

### D2

- Hide/disable vote controls and the vote API without changing feed order or
  annotation visibility. The rest of D1 remains usable.
- Revoke trusted vote function access through a forward migration if the
  mutation boundary is unsafe. Existing vote rows remain private under RLS.
- Do not delete vote data until retention/audit policy is approved. If deletion
  is approved, use an exact reviewed migration or bounded server cleanup, never
  a broad client operation.
- Rate-limit operational state and disposable acceptance users/votes must be
  removed exactly after evidence is recorded. Do not remove real user votes.

At every rollback, preserve article publication, hosted draft-first guards,
private buckets, claims confidentiality, comments, source attribution, and
paused Staging schedules. Production is not a Phase D rollback target because
Phase D does not access or deploy Production.

## 10. Exact owner manual checks — completed record

The owner completed these checks against the accepted Local fixtures and build.
They remain here as the durable regression procedure; repeating them requires a
newly authorized fixture setup and does not authorize remote work.

### 10.1 Preparation

1. In PowerShell at the repository root, run the exact Local automated gate in
   section 7.1. Stop if any command fails.
2. Start Local Supabase with the repository's normal Local configuration. Do not
   link or target Staging/Production.
3. Start the web app with `pnpm --dir apps/web run dev` and the extension with
   `pnpm --dir apps/extension run dev` (or load the reviewed production build for
   the final pass).
4. In `chrome://extensions`, enable Developer mode, load the generated Chrome
   extension directory, open its Details page, and confirm the permission list
   has no site access/host permission beyond the accepted manifest.
5. Open Chrome DevTools for the public page. Preserve screenshots and sanitized
   status/header evidence only; never record cookies, bearer tokens, signed URLs,
   service keys, Storage paths, or transcript provider payloads.

### 10.2 D1 article and routing

1. Publish one article passage through the extension with required commentary.
   Expected: publication is immediate and the ready/share action opens
   `/{current-handle}/{slug}`.
2. Record the canonical URL and page screenshot. Expected: selected passage,
   commentary, creator/source attribution, original link, optional creator audio,
   comments, and claim entry all match the UUID page baseline.
3. Paste `/a/{UUID}` in a new tab and record the Network document status.
   Expected: HTTP 308 to the exact canonical URL, then HTTP 200.
4. If a controlled old handle exists, paste the old-handle canonical URL.
   Expected: HTTP 308 to the current handle with the same slug.
5. Replace the slug/handle/UUID with valid-looking unknown values and test a
   known draft/hidden fixture supplied by the test harness. Expected: identical
   not-found/no-index behavior with no creator, title, comments, media, or
   canonical destination leaked. Stop on any distinguishable private data.

### 10.3 D1 hosted video/audio and transcript

1. Open the accepted short ready video annotation. Click Play, seek near the
   middle and end, pause/resume, and let any test TTL expire before retrying.
   Expected: the private processed clip plays at the shown duration/dimensions,
   a fresh same-origin authorization recovers once if needed, and there is no
   download action.
2. Compare the transcript and selected source range with the known excerpt.
   Expected: transcript contains only excerpt speech, timestamps are relative and
   bounded, attribution/original link are correct, and no full-source text appears.
3. Repeat for the short ready audio annotation. Expected: clear playback at the
   shown duration, excerpt-only transcript, commentary, attribution, original
   link, comments, and claim entry.
4. Open a historical time-code-only video/audio annotation. Expected: range and
   original deep link render, but no hosted-player/transcript claim appears.
5. Open the controlled removed-media fixture. Expected: commentary, attribution,
   comments, and claim entry remain as allowed; the page shows the stable
   unavailable state and has no player or transcript.
6. In Network/console, verify public JSON/HTML/log evidence contains no raw path,
   processed path, service key, provider metadata, claimant data, or voter data.
   A browser-visible short-lived signed request must not be copied into evidence.

### 10.4 D1 comments, claims, metadata, responsive, and accessibility

1. Signed out, follow the comment sign-in path and cancel before authentication.
   Expected: the return path is canonical and no draft comment is posted.
2. Signed in, post then delete one test comment. Expected: count/body update on
   the canonical page and the UUID compatibility path still redirects.
3. Open the claim form, inspect required fields, then either cancel or submit the
   approved disposable claim. Expected: claim data never appears publicly.
4. Inspect document metadata with the reviewed browser method. Expected:
   canonical/Open Graph/X URLs use the exact creator/slug URL and contain no signed
   media URL or transcript body.
5. At normal and narrow widths, use keyboard only through player, source link,
   comments, claim form, and voting controls. Expected: visible focus, logical
   order, named controls, readable transcript, no horizontal data loss, and no
   keyboard trap.

### 10.5 D2 votes

1. Signed out, view one published annotation. Expected: separate upvote and
   downvote totals are visible and mutation controls request sign-in without
   changing counts.
2. Sign in as disposable user A and click Upvote once, then again if the design
   uses toggle-to-clear. Expected: first action creates `+1`; clear returns to no
   vote; totals never go negative or double-count.
3. Set Upvote, then click Downvote. Expected: one row changes direction, up total
   falls by one, down total rises by one, and only Downvote is selected.
4. In a separate Chrome profile sign in as disposable user B and upvote.
   Expected: totals combine both users correctly while neither identity appears
   in page data, network responses, or public database access.
5. Trigger only the approved bounded rate-limit test. Expected: a stable 429 with
   retry guidance, no vote change for rejected requests, then normal behavior
   after the controlled window. Stop rather than bypassing the limit.
6. Open a controlled draft/hidden/removed annotation vote endpoint request from
   the test harness. Expected: the same unavailable result and no vote row.
7. Return to the public feed and claim entry. Expected: chronological order,
   annotation status, claim behavior, comments, and media are unchanged by vote
   totals.

Record pass/fail for every numbered check, Chrome/Windows version, branch/commit,
Local or Staging label, annotation/media IDs where safe, screenshots, exact
redirect status, and concise playback/accessibility notes. Do not report Chrome
acceptance as passed unless the owner performed it and supplied the result.

## 11. Resolved decisions and remaining risks

Phase D resolved these implementation decisions:

1. **Creator self-votes:** disallowed and covered at database, API, HTTP, and
   owner-acceptance boundaries.
2. **Rate limiting:** private PostgreSQL-backed fixed windows permit at most 20
   mutations per user/annotation and 100 per user across annotations per 10
   minutes. Rejections return bounded retry timing and do not mutate vote or
   limiter state beyond the accepted decision boundary.
3. **Signing TTL/player refresh:** fixed at 120 seconds with one bounded
   same-origin retry. Local, owner Chrome, and Staging expiry/refresh/seek
   evidence passed.
4. **Initial vote placement:** totals remain canonical-detail-only and have no
   discovery ordering or moderation effect.
5. **Signed-out voting:** disabled controls remain visible with an explicit
   sign-in action; vote buttons do not trigger unexpected OAuth navigation.

The following decisions remain outside Phase D:

1. **Claim target hardening (Phase F):** preserve claimant confidentiality and
   decide the final published-parent insertion guard with the claim/removal
   contract.
2. **Generated-handle product acceptance (Phase E):** decide whether creators
   must confirm or change deterministic handles. Existing aliases and canonical
   links must remain durable.
3. **Removed-annotation presentation (Phase F):** confirm final copy and legal/
   audit retention while keeping confidential reason and claim data private.
4. **Metadata preview asset:** the accepted text/existing-site asset remains.
   Any dynamic per-annotation image requires separate scope and must not use a
   signed media frame or transcript body.
5. **Runtime/distributed controls (Phase G):** final cookies, CSP, callbacks,
   caching, and operational rate-limit behavior depend on the selected trusted
   Next.js runtime. Google Cloud Run remains the first candidate; Bluehost
   WordPress Plus is not assumed capable of hosting it.
6. **Staging secret rotation:** one D2 diagnostic emitted only five characters
   following the standard `sb_secret_` prefix, not a complete or usable
   credential. Optional defense-in-depth rotation remains an owner decision.

## 12. Authorization checkpoints

Phase D checkpoints 1-8—implementation, additive Local migrations, owner
Chrome gates, bounded D1/D2 Staging application/regression, commit/push/Draft
PR, review/CI, squash merge, and post-merge closeout evidence—were separately
authorized and completed. No authorization was inferred across checkpoints.

Schedule enablement, Production access or deployment, DNS, Bluehost, Lovable,
OAuth/X, callback, vendor, runtime-hosting, feature-branch deletion, and Phase E
implementation remain unauthorized until separately approved. Production
remains blocked until Phase E passes Local, required CI, and bounded Staging
acceptance and a later Production gate is explicitly authorized.

## 13. Final Phase D closeout record

### 13.1 Delivery and validation

- D1 merged through protected PR #20 as
  `50a3f9c38683d46f23991fbbd3ee49d807528a00`. Its required PR validation and
  post-merge `main` CI run `32807426242` passed.
- D2 merged through protected PR #21 as
  `6f0f1c59acb52d5fb53dcc11dfd446b455ac5f2b`. Its required PR validation and
  post-merge `main` CI run `32906492506` passed.
- D1's final Local gate passed 356/356 pgTAP, 18/18 shared, 98/98 extension,
  31/31 web, and 13/13 focused route/playback tests, plus schema lint, compile,
  lint/build, generated-manifest, artifact-privacy, package, and whitespace
  checks.
- D2's final Local gate passed 440/440 pgTAP across 15 files, the complete
  concurrency/privacy/abuse and authenticated HTTP harnesses, 18/18 shared,
  98/98 extension, and 42/42 web tests, plus the same compile, lint/build,
  manifest, privacy, package, and whitespace boundaries.
- Owner Chrome acceptance passed on Chrome 151.0.7922.170, Windows 11 25H2.
  D1 covered corrected canonical/UUID/historical-handle routing, old `/lons`
  denial, article and historical parity, ready video/audio playback and signing
  expiry, excerpt transcript, removed/private states, comments/follow/claim,
  extension links/permissions, 390 px layout, keyboard/focus, and privacy. D2
  covered signed-out behavior, detail-only discovery isolation, private 404,
  create/change/persist, cross-user/social isolation, creator rejection,
  keyboard/pending semantics, 390 px layout, privacy, 429 rollback, bounded
  retry, and recovery.

### 13.2 Bounded Staging and cleanup

- Staging project `nkkunkwirvfwhmpwonqz` is aligned through all five D1
  migrations (`20260824120000` through `20260824140000`) and all four D2
  migrations (`20260825120000` through `20260825120300`).
- D1 passed structural/RLS/grant/private-bucket assertions, canonical article
  and historical-handle routing, normal hosted video/audio one-ID processing,
  raw deletion, ready publication, excerpt transcript, same-origin 307 signing,
  Range 206 playback, exact 120-second expiry, refresh, discovery, comments,
  claims confidentiality, and public/log privacy. The bounded `whisper-1`
  fixtures cost approximately $0.0016.
- D2 passed 14/14 structural assertions; session-derived identity; signed-out,
  same-origin/cross-origin, caller-ID, creator, draft, and removed boundaries;
  create/idempotent/change/clear and concurrency; pair limit 20 with unchanged
  HTTP 429 state and `Retry-After: 598`; global limit 100 with unchanged HTTP
  429 state and `Retry-After: 583`; exact-window recovery; vote privacy; and
  discovery/publication/comments/follows/claims/removal/media/worker isolation.
  D2 invoked no hosted processing or external provider and cost $0.
- Every exact disposable Local and Staging user, session, profile, alias, source,
  annotation, target, vote, limiter row, comment, follow, claim, transcript,
  media row, raw object, processed object, temporary file, harness, and server
  process was removed and verified at zero as applicable. Both worker schedules
  remained paused before, during, and after the bounded gates.

### 13.3 Sanitized security findings

- Raw and processed buckets remain private. Public projections and generated
  artifacts expose no raw/processed path, checksum, signed URL, provider
  metadata, claimant data, voter identity graph, private limiter state, full-
  source transcript, or server credential.
- Route, signing, and voting boundaries derive authoritative identity and paths
  server-side, reject caller substitution and non-public states, use bounded no-
  store responses, and leave publication, moderation, social, media, and worker
  state isolated from votes.
- One D1 disposable harness assertion emitted an already short-lived processed-
  media token into private task output. The related object was deleted
  immediately, the token expired, and the corrected closeout harness completed
  without further token-shaped output. No service or user credential was
  exposed.
- One D2 diagnostic emitted only five characters following the standard
  `sb_secret_` prefix. It was not a complete or usable credential. No full key,
  access token, database URL, password, signed URL, or voter identity was
  printed or persisted; optional Staging-secret rotation remains an owner
  defense-in-depth decision.
- No package or lockfile changed. Production was not accessed, no schedule was
  enabled, and nothing was deployed.

Phase D is formally closed. Phase E planning is the next product checkpoint.
