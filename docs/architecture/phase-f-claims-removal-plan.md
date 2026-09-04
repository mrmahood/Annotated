# Phase F claims, takedown, and removal plan

Status: **draft for owner approval** (docs only). No Phase F implementation,
migration, Staging, or Production work is authorized by this document until the
owner explicitly approves this plan and then authorizes each implementation
increment.

Baseline: protected `main` at `658b58731f9a5494e11eac7b783501c4d8dfb702`
(`docs: close Phase E live-X Gate 3 (#42)`), 2026-09-02. Phase E is complete,
accepted, merged, and rolled back cleanly in Staging. Phase F is next.
Production has not been accessed or deployed. Worker schedules remain paused.
Migrations on `main` end at `20260825120300_phase_d2b_current_vote_projection.sql`.

This plan is subordinate to durable security and media rules in
`AGENTS.md` and `docs/architecture/media-archive-pipeline.md` (especially §11
and claims/removal guidance). Product requirements for claims/takedown are
FR-090–FR-094 in the Product Requirements Document. Delivery status follows
`docs/product/roadmap.md` when the PRD status table is stale.

## 1. Purpose and non-goals

### 1.1 Purpose

Complete a safe, auditable operator lifecycle for confidential claims and
controlled removal:

- harden claim intake so only publicly claimable annotations accept claims;
- give Matt-only operators a service-side way to review claims;
- support media-only withdrawal of published hosted excerpts with immediate
  playback/transcript revocation and exact Storage cleanup;
- support full annotation hide/remove with discovery isolation;
- allow Matt-only unhide of a mistaken `hidden` annotation with a new audit
  entry;
- keep votes, comments, and follows structurally unable to authorize
  moderation.

### 1.2 Non-goals (this phase)

- Full admin/moderation console or multi-operator RBAC.
- Claimant or creator email notifications.
- Public appeal portal or automatic derivative restore after media withdrawal.
- Extension UI polish / minimalist redesign (sequenced after Phase F).
- Re-enabling X OAuth (sequenced before mid-September bounty submit, outside
  Phase F code).
- Production deployment, DNS/TLS cutover, or enabling paused worker schedules
  except for an explicitly authorized bounded Staging acceptance run.
- Generic webpage-video publication or cross-origin player adapters.
- Legal counsel substitution; this plan encodes owner policy decisions, not
  legal advice.

## 2. Locked owner decisions (2026-09-02)

These decisions are approved by the owner and must not be silently reinterpreted
in implementation:

1. **Operator:** Matt only for now. Gate the moderation caller with an explicit
   allowlist (profile id and/or email in server/env config). No public client
   may supply “operator identity.”
2. **September sequence:** finish Phase F first, then extension UI polish;
   mid-September bounty-ready target. Re-enable X before submit (after F;
   ideally with UI polish).
3. **Transcript on media-only removal:** delete transcript text and segments;
   retain non-sensitive audit metadata only (hashes, sizes, duration,
   dimensions, model/provider labels already treated as audit-safe, actor,
   time, reason, claim linkage, cleanup result). Do **not** keep excerpt text
   for “restricted audit storage” in Phase F.
4. **Notifications:** no claimant/creator emails in Phase F. Existing
   `claimant_email` storage in `public.claims` may remain; do not build email
   workflows or surfaces.
5. **Appeals / restore:** no public appeals. Matt may unhide
   (`hidden` → `published`) with a **new** audit entry. Media-only withdrawal
   is **forward-only**: deleted derivatives and transcript content are not
   rebuilt by moderation restore.
6. **Default action when a claim is valid:** prefer **media-only withdrawal**
   for excerpt/copyright concerns (keep commentary, attribution, original
   link, comments, and claim entry on a published page without player or
   transcript). Escalate to **full hide**, then **remove**, when commentary
   itself is the problem, or the annotation must leave discovery.
7. **Claims never auto-takedown.** Anonymous claim spam must not become a
   takedown mechanism.
8. **Votes never moderate.** Vote rows, totals, and rate-limit state must not
   trigger, prioritize, authorize, or decide claims, hide, remove, or restore.

## 3. Verified current-state inventory (HEAD `658b587`)

### 3.1 Claims

- `public.claims` exists with claimant name/email/relationship/reason/details
  and statuses `submitted | reviewing | resolved | rejected`
  (`supabase/migrations/20260801195100_initial_schema.sql`).
- RLS: public insert of `submitted` only; no client SELECT/UPDATE/DELETE.
  Service role has private review privileges. Privilege regressions exist in
  multiple pgTAP files; there is **no** published-target eligibility test.
- Public UI: `apps/web/src/app/a/[annotationId]/claim-form.tsx` inserts via
  browser Supabase client. Good-faith checkbox is client-only (not stored).
  Wired through `apps/web/src/app/public-annotation-page.tsx`.
- Gap: insert does **not** prove the target annotation is currently public /
  claimable; architecture requires that for Phase F.

### 3.2 Annotation and media states

- `annotations.status` already allows `draft | published | claim_pending |
  hidden | removed` (schema only; no Phase F transition RPCs).
- `annotation_media` has `removed_at`, `removal_claim_id`, and
  `processing_status` including `removed`
  (`supabase/migrations/20260815120000_media_archive_foundation.sql`).
- Owner draft cancel (`cancel_hosted_media_annotation`) can mark **draft,
  non-ready** media `removed`. That is **not** a published takedown path.

### 3.3 Public fail-closed surfaces (already strong)

- Public loaders require `published` for normal pages.
- Media projection supports `ready | removed | unavailable` and a
  `media_removed` presentation that omits player/transcript while retaining
  approved attribution/commentary/claim entry
  (`apps/web/src/lib/data/public-annotation*.ts`, public page components).
- Playback signing
  (`apps/web/src/app/api/media/playback/[annotationId]/route.ts` and helpers)
  requires published + ready + `removed_at is null` + transcript completeness
  checks; removed media cannot mint new signed URLs.
- Migrations of note: `20260824120000`, `20260824123000`, `20260824130000`,
  `20260824133000`.

### 3.4 Cleanup plumbing (partial)

- Reconciler candidates and
  `private.claim_annotation_media_cleanup_v2` /
  `private.confirm_annotation_media_cleanup`
  (`20260824020000_phase_c_durable_terminal_cleanup.sql` and related) can
  delete exact Storage objects after media is `removed`, preserve `removed_at`,
  and currently **DELETE** `annotation_transcripts` rows.
- Worker/reconciler code under `apps/media-worker/` consumes those contracts.
- Gap: nothing marks **published ready** media as removed via a moderated
  service-only RPC; transcript hard-delete conflicts with the locked
  “clear content, keep audit metadata” policy.

### 3.5 What does not exist

- Phase F migrations, plan file (until this document), operator audit table,
  Matt-gated moderation RPCs, claim review queue RPCs, hide/unhide RPCs,
  published media-only removal RPC, Phase F focused acceptance tests, Staging
  claim→remove manual evidence.

## 4. Threat model (Phase F)

| Threat | Mitigation |
| --- | --- |
| Claimant PII leak via public reads, logs, or operator dumps | Keep claims write-only to clients; operator outputs allow-list fields; never log emails/reasons in web/worker logs by default |
| Existence oracle for draft/hidden IDs via claim insert | Trusted submit boundary returns generic outcomes; only accept currently public/claimable targets |
| Client-supplied “operator id” | Service-only moderation functions; empty `search_path`; no `authenticated` execute; Matt allowlist enforced in trusted caller |
| Claim spam auto-takedown | Claims never change annotation/media state |
| Signing race after removal commit | DB revocation (`removed_at` / status) commits before async Storage delete; signing RPC rechecks on every request; 120s TTL bounds stale URLs; still delete objects |
| Stale worker finalize after removal | Fence: worker must not publish/finalize once removal committed; reconciler idempotent |
| Vote-driven moderation | No reads of vote totals inside moderation RPCs; keep D2 isolation tests; add Phase F proofs |
| Accidental restore of copyrighted binaries | No auto rebuild of derivatives; unhide is status-only when media was never destroyed |
| CSRF / confused deputy on operator endpoint | Same-origin or explicit secret + allowlist; confirmation required; no browser cookie session alone for destructive calls unless separately designed and approved |

## 5. State and action matrix

| Action | Preconditions | Effects | Audit |
| --- | --- | --- | --- |
| Submit claim | Target publicly claimable (`published`, or approved removed-media public presentation) | Insert `claims.status=submitted` only | Claim row timestamps |
| Mark reviewing | Matt operator; claim `submitted` | `reviewing` | Audit action |
| Reject claim | Matt operator; `submitted`/`reviewing` | `rejected`; **no** media/annotation change | Audit action |
| Resolve after media-only | Matt operator; media removal committed | `resolved` (+ optional claim link on media) | Audit action |
| Media-only withdraw | Matt operator; published annotation; media ready (or already needing revoke) | Set media `removed` + `removed_at` (+ optional `removal_claim_id`); clear transcript content; keep audit metadata; annotation may stay `published` | Forward-only audit with reason/actor |
| Hide annotation | Matt operator | `annotations.status=hidden`; non-public everywhere | Audit |
| Unhide | Matt operator; currently `hidden`; media policy still satisfied | `published` | **New** audit entry |
| Full remove | Matt operator | `annotations.status=removed`; media revoke if needed; non-public | Forward-only audit |
| Cleanup retry | Reconciler/service | Delete exact known objects; confirm absence | Cleanup result fields |

Votes, follows, and comments never appear as inputs to these transitions.
Comments follow annotation visibility for hide/remove; they need not be
destroyed for media-only withdrawal.

## 6. Decomposition F0–F6

### F0 — Policy and contract audit (this document)

- Inventory paths, grants, RLS, public projections, cleanup, tests.
- Encode locked owner decisions and threat model.
- **Exit:** owner approves this plan.

### F1 — Claim-intake hardening

- Replace or wrap direct table insert with one trusted submission boundary
  (RPC or server route) that:
  - accepts only annotation UUID + bounded claimant fields;
  - verifies target is publicly claimable without leaking non-public existence;
  - returns stable generic success/failure;
  - preserves write-only confidentiality.
- Add database-enforced published/claimable check (preferred) even if a thin
  server route is also used.
- Add abuse controls appropriate to Phase F (at minimum DB/RPC rate bound;
  CAPTCHA only if owner later requires it).
- Update claim form to call the trusted boundary; keep UX generic on errors.
- **Tests:** pgTAP for draft/hidden/removed rejection, published accept,
  no SELECT for anon/authenticated, non-enumerating errors.

**F1a (first code PR after plan approval):** smallest slice — harden submit so
target must be `published` (or explicitly permitted removed-media public page),
plus pgTAP. Form/email fields can remain for storage; no notification work.

### F2 — Matt-only claim review

- Service-only list/get/update RPCs for claim review
  (`submitted` → `reviewing` → `resolved`/`rejected`).
- No client grants. Minimum operator workflow: script or locked server endpoint
  with confirmation and allow-listed output (suppress claimant fields unless
  explicitly requested by the authorized operator session).
- Do **not** build a broad admin UI.

**Landed:** additive migration `20260904020635_phase_f2_claim_review.sql`.
Service-only `list_claims_for_review`, `get_claim_for_review`, and
`update_claim_review` (private implementations + public wrappers granted only to
`service_role`). Locked routes, no admin UI:

- `GET /api/moderation/claims` — list open claims by default (`submitted` and
  `reviewing`); optional `status`, `limit`, `afterCreatedAt`, `afterId`,
  `includeClaimantPii=true`
- `GET /api/moderation/claims/{claimId}` — get one claim
- `POST /api/moderation/claims/{claimId}` — transition; confirmation phrase
  `CLAIM_REVIEW_UPDATE`

Allowed transitions: `submitted→reviewing`, `submitted→rejected` (plan §5 spam /
invalid path without a reviewing hop), `reviewing→resolved`,
`reviewing→rejected`. Review does not hide, remove, or withdraw media. Operator
uses curl/script with a Bearer session; allowlist is
`ANNOTATED_MODERATION_OPERATOR_IDS` /
`ANNOTATED_MODERATION_OPERATOR_EMAILS`. Claimant name/email/details are omitted
unless `includeClaimantPii` is explicitly requested on an allowlisted session.

### F3 — Hide / unhide + append-only audit schema

- Additive immutable migrations for append-only moderation audit
  (actor, action, reason code, annotation id, media id, claim id, timestamps,
  cleanup linkage). Do not edit applied migration history.
- Service-only hide and unhide RPCs with row locks and transition validation.
- Public routes/discovery/extension queries must treat `hidden`/`removed` as
  uniformly non-public (canonical + UUID + SEO + feed + profile + comments +
  transcripts + media).

**Landed:** additive migration `20260904023220_phase_f3_hide_unhide.sql`.
Extends `private.moderation_audit` (no second table) with `annotation_hide` /
`annotation_unhide` actions and reason code `commentary`. Service-only
`moderate_annotation_hide` and `moderate_annotation_unhide` (private
implementations + public wrappers granted only to `service_role`). Locked
routes, no admin UI:

- `POST /api/moderation/annotations/{annotationId}/hide` — confirmation
  phrase `ANNOTATION_HIDE`
- `POST /api/moderation/annotations/{annotationId}/unhide` — confirmation
  phrase `ANNOTATION_UNHIDE`

Reason codes: `operator_request`, `copyright`, `excerpt_claim`, `commentary`.
Hide is `published → hidden` (`already_hidden` is idempotent). Unhide is
`hidden → published` with a **new** audit row (`already_published` is
idempotent). Unhide does not restore F4-cleared transcript content or
derivatives; removed media stays removed. Optional `claimId` is a confidential
audit link only and does not resolve the claim. Operator uses curl/script with
a Bearer session; allowlist is `ANNOTATED_MODERATION_OPERATOR_IDS` /
`ANNOTATED_MODERATION_OPERATOR_EMAILS`. Clients cannot hide/unhide through
table UPDATE.

```bash
# Hide (Matt session JWT). Extra fields such as operatorId are rejected.
curl -X POST "$SITE/api/moderation/annotations/$ANNOTATION_ID/hide" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reasonCode":"operator_request","confirm":"ANNOTATION_HIDE"}'

# Hide with an optional confidential claim link
curl -X POST "$SITE/api/moderation/annotations/$ANNOTATION_ID/hide" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reasonCode":"commentary","confirm":"ANNOTATION_HIDE","claimId":"'"$CLAIM_ID"'"}'

# Unhide (always writes a new audit row on a real hidden → published write)
curl -X POST "$SITE/api/moderation/annotations/$ANNOTATION_ID/unhide" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reasonCode":"operator_request","confirm":"ANNOTATION_UNHIDE"}'
```

### F4 — Published media-only removal + cleanup/transcript policy

- Service-only moderation RPC that, in one transaction where possible:
  - locks annotation/media/(optional) claim rows;
  - validates transition;
  - sets media `removed` + `removed_at` + optional `removal_claim_id`;
  - records audit reason/actor;
  - clears transcript **content/segments** while retaining non-sensitive
    metadata (replace current hard-delete behavior in cleanup confirmation);
  - commits so signing fails closed immediately.
- After commit, reconciler deletes exact raw/processed objects, confirms
  absence, records cleanup success or retryable failure.
- Idempotent under duplicate calls and worker races; worker must not
  finalize/publish after removal.
- Public page remains the accepted removed-media presentation when annotation
  stays `published`.

### F5 — Full-record hide/remove and claim resolution linkage

- Full hide and final remove actions with discovery isolation.
- Operator decision tree defaults to media-only for excerpt/copyright claims;
  escalate per locked policy.
- Claim status transitions linked to actions without exposing claimant data
  publicly.

### F6 — Local automated acceptance + bounded Staging acceptance

- pgTAP + focused web/worker tests for the matrix in §5 and threat model in §4.
- Prove votes cannot influence moderation.
- Run full release gate from `AGENTS.md`; inspect generated extension manifest
  even if permissions unchanged.
- Staging (explicit authorization only): one disposable public hosted fixture →
  claim → media-only withdraw → verify no new playback, transcript absent,
  attribution page retained → one hide/remove case → one cleanup retry case if
  cheap/safe → exact cleanup to zero. Keep schedules paused unless temporarily
  required and re-paused. Production untouched.
- Record evidence in `docs/product/roadmap.md` before closing Phase F.

## 7. First implementation increment (after plan approval)

**Authorized next code step:** F1a only, on a feature branch, unless the owner
widens scope.

Likely files:

- new `supabase/migrations/2026090x_phase_f1a_claim_publish_target.sql`
- new `supabase/tests/database/phase_f1a_claim_intake.test.sql`
- possibly `apps/web/src/app/a/[annotationId]/claim-form.tsx` if switching from
  direct insert to RPC/route
- docs: this plan (already), roadmap status note when F1a merges

Authorization checkpoints:

1. Owner approves this plan.
2. Owner authorizes F1a implementation.
3. Owner manual acceptance (if UI touched) before commit/push.
4. Draft PR → CI → review → squash merge only with owner go-ahead.
5. Staging work only with separate explicit authorization.

Rollback for F1a: revert migration via follow-up additive fix if needed; do not
rewrite applied history; do not `supabase db reset --linked`.

## 8. Operator surface (minimum)

Prefer a small server-only command or authenticated endpoint that:

- requires Matt allowlist + explicit confirmation token/flag;
- supports: list open claims, show claim (PII only when requested),
  media-only withdraw, hide, unhide, full remove, reject/resolve;
- prints allow-listed fields only (ids, statuses, reason codes, cleanup
  results) by default;
- never prints secrets, signed URLs, raw paths, transcript text, or provider
  payloads.

No full moderation console in F1–F4.

## 9. Rollback and forward-only rules

- Disabling the moderation caller is the rollback switch.
- Audit rows are append-only; never erase history to “undo.”
- Unhide is an explicit new action, not silent reversal.
- Media-only withdrawal does not recreate deleted derivatives.
- Worker schedules stay paused unless a Staging test explicitly requires a
  bounded run, then return to paused.

## 10. Test plan (summary)

Must cover:

- claim confidentiality and published-target eligibility;
- non-enumerating errors;
- unauthorized moderation denied;
- valid/invalid transitions; duplicate/concurrent actions;
- signing-versus-removal race;
- immediate transcript content suppression with metadata retention;
- media-only vs full hide/remove presentation;
- exact object cleanup and retry;
- worker/reconciler fencing after removal;
- comments/attribution retention rules;
- public route/discovery isolation;
- vote isolation from moderation.

## 11. Open items deferred (do not block F1a)

- Formal acknowledgment/resolution SLA numbers and public policy pages
  (terms/copyright) — needed before Production (Phase G), not before F1a.
- Repeat-infringer policy text.
- Whether `claim_pending` annotation status is used operationally or remains
  reserved.
- Exact reason-code enum list (propose a small closed set in F3/F4 PR).
- CAPTCHA provider choice.
- Long-term restricted legal hold storage (explicitly out of Phase F per owner
  transcript decision).

## 12. Success criteria for closing Phase F

- F1–F5 contracts merged with tests green on required CI.
- Owner acceptance recorded for Local (and bounded Staging if authorized).
- Roadmap updated with evidence, digests, costs, and cleanup-to-zero proof.
- No Production access; schedules paused unless owner changed that later.
- Bounty-critical “File a claim” remains visible and confidential; media-only
  and full removal are operable by Matt through the minimum safe boundary.

---

**Owner approval required** before any Phase F migration or application code
lands. Approving this document authorizes planning only, not Staging, not
Production, and not schedule enablement.
