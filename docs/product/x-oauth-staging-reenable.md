# Staging X OAuth re-enable — owner checklist

Status: implementation increment for the mid-September bounty submit.
Updated 2026-09-06. Production is not authorized.

This document is the operator checklist for turning X sign-in back on for
**user-facing Staging web and the Chrome extension**. Code in this increment
only flips the existing Staging-project capability plus UI affordances. It does
not configure Supabase, X Developer Portal, or Vercel secrets.

Do **not** open Production Supabase `vnxjktpdzmykmqrqwvks` or a Production X
app. Use Staging project `nkkunkwirvfwhmpwonqz` only.

## What the code now does

- Google stays enabled everywhere.
- Default / Production / Local capabilities stay `{ google: true, x: false }`.
- X becomes executable only when the app URL is exactly
  `https://nkkunkwirvfwhmpwonqz.supabase.co`.
- Set `NEXT_PUBLIC_ANNOTATED_STAGING_X_WEB_AUTH=0` or
  `WXT_ANNOTATED_STAGING_X_EXTENSION_AUTH=0` to hide X on a Staging-pointed
  build without a code change.
- Web start/callback, attempt cookies, token-safe errors, and identity-policy
  checks are unchanged from E2b / Gate 3.
- Extension Chrome identity callback, cancellation, and provider-mismatch
  checks are unchanged from E2c / Gate 3.

A visible **Continue with X** button is not enough. The Staging provider and
X app must be enabled below or the existing token-safe error page appears.

## 1. Confirm the Staging X app (do not invent credentials)

Gate 3 used **Annotated Staging OAuth**, App ID `33378732`. Matt’s X account
for Annotated is related to `matt@cbandcoop.com` / Annotated branding. Reuse
that app if it still exists. Do not create a new Production app.

1. Open [developer.x.com](https://developer.x.com) and sign in as that
   Annotated X account.
2. Open the existing Staging app → **User authentication settings**.
3. Confirm **OAuth 2.0** is on (not the legacy OAuth 1.0a Twitter provider).
4. Type of App: **Web App**.
5. **Request email from users** may stay on; Annotated does not require email
   and must not assume it is present.
6. Callback URL in the X portal is the **Supabase vendor callback**, not the
   Annotated site:

   `https://nkkunkwirvfwhmpwonqz.supabase.co/auth/v1/callback`

7. Website URL can stay the Staging origin:

   `https://annotated-staging.cbandcoop.com`

8. Do not copy Client ID / Client Secret into chat, git, logs, or the
   extension. Those values stay in the X portal and the Supabase Staging
   provider form (masked credentials were retained after Gate 3 rollback).

If the app or secrets are gone, recreate **only** a Staging app with the same
callback and paste the new Client ID / Secret into Staging Supabase. Never
paste them into Vercel `NEXT_PUBLIC_*` or `WXT_*` variables.

## 2. Enable the Supabase Staging X provider

1. Open the Supabase Dashboard.
2. Confirm the project ref in the URL or Settings is
   **`nkkunkwirvfwhmpwonqz`**. Stop if it is `vnxjktpdzmykmqrqwvks`.
3. Go to **Authentication → Sign In / Providers**.
4. Expand **X / Twitter (OAuth 2.0)** — not Twitter OAuth 1.0a.
5. Turn **Enabled** on.
6. If Client ID / Secret are still masked from Gate 3, leave them. Only
   replace them if the X app was regenerated.
7. Save. Leave **Google** enabled.

Supabase also lists the Callback URL on that provider card; it must match the
X portal value above.

## 3. Confirm Staging Auth URL allowlists

In the same Staging project: **Authentication → URL Configuration**.

Keep Google working. Confirm these redirects exist (add only if missing):

| Purpose | URL |
| --- | --- |
| Staging Site URL | `https://annotated-staging.cbandcoop.com` |
| Web callback | `https://annotated-staging.cbandcoop.com/auth/callback` |
| Web wildcard (if already used) | `https://annotated-staging.cbandcoop.com/**` |
| Extension Chrome identity | `https://<EXTENSION_ID>.chromiumapp.org/auth/callback` |
| Extension wildcard (if already used) | `https://<EXTENSION_ID>.chromiumapp.org/**` |

`<EXTENSION_ID>` is the loaded Staging extension ID (chrome://extensions →
Annotated → ID). Gate 3 reused one ID across rebuilds. After a new unpacked
load, copy the current ID and add that exact chromiumapp origin. Do not add a
Production hostname.

Local loopback (`http://127.0.0.1:3000/**`, `http://localhost:54321/**`) may
already exist for Google; this increment does not require Local X.

## 4. Environment variable names (no secret values)

### Staging Vercel web (annotated-staging)

Already required (do not print values):

- `NEXT_PUBLIC_SUPABASE_URL` = `https://nkkunkwirvfwhmpwonqz.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = Staging publishable key only
- `NEXT_PUBLIC_SITE_URL` = `https://annotated-staging.cbandcoop.com`

Optional:

- `NEXT_PUBLIC_ANNOTATED_STAGING_X_WEB_AUTH=1` documents the Staging enable.
  The code also enables X from the exact Staging URL alone.
- `NEXT_PUBLIC_ANNOTATED_STAGING_X_WEB_AUTH=0` hides X without a code change.

Do not add Client ID, Client Secret, or service-role keys to `NEXT_PUBLIC_*`.

### Staging Chrome extension build

In `apps/extension/.env.local` (untracked):

- `WXT_SUPABASE_URL` = `https://nkkunkwirvfwhmpwonqz.supabase.co`
- `WXT_SUPABASE_PUBLISHABLE_KEY` = Staging publishable key only
- `WXT_WEB_APP_URL` = `https://annotated-staging.cbandcoop.com`

Optional:

- `WXT_ANNOTATED_STAGING_X_EXTENSION_AUTH=1` documents the Staging enable.
- `WXT_ANNOTATED_STAGING_X_EXTENSION_AUTH=0` hides X without a code change.

Rebuild and reload the same extension ID after changing these. Production
extension builds that point at Production Supabase stay fail-closed.

## 5. Owner acceptance (required before calling this done)

Automated tests do not replace this. Stop at the first failure.

1. Open `https://annotated-staging.cbandcoop.com` signed out.
2. Confirm **Continue with Google** and **Continue with X**.
3. Cancel the X flow. Expect the token-safe error or return, no codes/tokens
   in the URL bar or page.
4. Sign in with X through **Annotated Staging OAuth**. Expect a session and
   no provider token in application storage.
5. Sign out, then sign in with Google. Google must still work.
6. Reload the Staging extension, open the side panel Account tab, and confirm
   both buttons. Repeat cancel, X success, and Google.
7. Record: Staging project ref, Vercel origin, extension ID used for the
   chromiumapp redirect, and pass/fail. Do not record secrets.

Production remains disabled until separately authorized.
