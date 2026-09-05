# Annotated engineering guide

## Product and repository

Annotated is a Chrome side-panel extension and public web app for creating a
commented, attributed annotation of an article passage or a selected media
range. Hosted media is a private, draft-first pipeline; the selected excerpt,
not a full-source transcript or download, is the processing input.

This is a pnpm monorepo:

- `apps/extension`: WXT, React, TypeScript, Chrome Manifest V3 side panel,
  background service worker, and offscreen capture document.
- `apps/web`: Next.js App Router application and trusted server API routes.
- `packages/shared`: source normalization and shared product validation.
- `supabase`: additive PostgreSQL migrations, RLS, Storage configuration, and
  pgTAP tests.
- `docs`: architecture and product-roadmap decisions.

## Durable architecture and security rules

- Preserve the existing article workflow. Article annotations publish
  immediately through their validated RPC and are a regression gate for every
  hosted-media change.
- New hosted video/audio ranges are 1,000-90,000 ms. The 90-second ceiling is a
  product constraint, not a fair-use determination. Preserve historical read
  compatibility where the database architecture explicitly allows it.
- Hosted annotations remain `draft` until processed media is ready, the exact
  excerpt transcript exists, and raw deletion is confirmed. Never infer a
  public/processing state from local recorder completion.
- Browser capture uses the proven `tabCapture -> offscreen -> MediaRecorder`
  flow. The offscreen document owns the Blob and direct upload. Do not route the
  complete Blob through the side panel, use `captureStream()` as production
  architecture, or crop/transcode in the extension.
- The future worker owns probe, geometry/crop validation, low-resolution
  derivative creation, excerpt-only transcription, raw cleanup, and final
  publication.
- Raw and processed hosted-media buckets are private. The server derives the
  exact raw path and issues a short-lived, no-upsert upload authorization.
- The extension may contain only the Supabase publishable key and the user's
  session. Service/secret keys, database passwords, worker credentials, signed
  URLs in logs, and provider secrets must never enter client code or output.
- Authenticate server routes with the user's bearer JWT, verify ownership and
  annotation/media/target relationships, and keep privileged mutations on the
  trusted server or private database boundary. Return bounded error codes.
- A Processing label requires an authoritative owner-status result with the
  expected annotation/media IDs, `processing_status = processing`, and
  `processing_stage = queued` for the Phase B terminal state.
- Browser restart cannot recover an in-memory raw Blob. Persist only safe
  operation/recovery identifiers; reconcile with owner status and offer an
  honest Recapture/Cancel path.
- Production extension permissions are `sidePanel`, `activeTab`, `storage`,
  `scripting`, `identity`, `tabCapture`, `offscreen`, and `tabs`, plus
  `host_permissions` for `http://*/*` and `https://*/*` (owner-authorized
  2026-09-05 for Open source amber apply and surf-follow). Minimum Chrome 116.
  Do not add persistent content scripts or diagnostic UI.
- Keep source attribution, original links, required commentary, claims/takedown,
  no DRM/paywall bypass, and no download action intact.

Read `docs/architecture/media-archive-pipeline.md` before changing hosted-media
state, capture, Storage, worker, transcript, routing, or publication behavior.
Use `docs/product/roadmap.md` to keep work inside the active phase.

## Validation

From the repository root, use the installed pnpm version and stop on unexpected
results:

```powershell
pnpm install --frozen-lockfile
pnpm exec supabase db lint --level error
pnpm exec supabase test db
pnpm --filter @annotated/shared test
pnpm --dir apps/extension test
pnpm --dir apps/extension run compile
pnpm --dir apps/extension run build
pnpm --dir apps/web run test:unit
pnpm --dir apps/web run lint
pnpm --dir apps/web run build
git diff --check
```

Inspect the generated production manifest after extension builds. Automated
validation does not replace empirical Chrome testing. Never report browser
acceptance as passed unless the owner performed it and supplied the result.

## Database, environment, and Git safety

- Migrations are additive and immutable after application. Do not edit applied
  history, use migration repair casually, or reset a linked/remote database.
  Never run `supabase db reset --linked`.
- Distinguish Local and Staging. Staging project ref is
  `nkkunkwirvfwhmpwonqz`; verify it explicitly before remote work. Supabase API
  keys are project-specific. Keep `.env.local`, passwords, and keys untracked
  and never print their values.
- Preserve intentional dirty-worktree changes. Do not reset, clean, discard, or
  stash them without explicit authorization.
- Normal delivery is feature branch -> implementation/tests -> owner manual
  acceptance -> commit/push -> Draft PR -> Staging regression -> review/CI ->
  squash merge. Do not commit, push, deploy, switch branches, or change remote
  state unless the owner authorizes that step.

## Collaboration and manual tests

Work one phase and one important manual behavior at a time. Inspect existing
code first, preserve established architecture, and add a regression test for
every reproduced defect. Report exact files, warnings, failures, security
boundaries, and any architectural deviation.

Manual instructions must state exactly what to open, click/type/run, the
expected result, what evidence to record, and when to stop. Prefer copy/paste
PowerShell commands and explicit Chrome, Supabase, and GitHub click paths for a
capable non-specialist operator.
