---
name: verify-annotated
description: "Drive Annotated's public Next.js web app and capture proof. Use for verify-annotated, a scripted check of the public feed, an annotation page, legal pages, trending, who-to-follow, the signed-out /me wall, or read-only signed-in /me for the dedicated test user, against local apps/web or the production public site https://annotated.cbandcoop.com."
---

# Verify Annotated

Annotated's primary scripted surface is the public Next.js app in `apps/web`. Public drives stay signed out. `authenticated-me` is the one signed-in drive. It mints a Supabase session for `cbandcooptest@gmail.com` only, then reads `/me`. It does not start Google or X. The Chrome side panel stays deferred because this harness does not load an unpacked extension, and a website session does not open the side panel.

The harness is `verify-annotated` (`helpers/verify-annotated.mjs`). It launches one target, checks it, drives a feature in a fresh browser, and writes proof under `evidence/`. Run every command from the repository root.

## Launch

Pick one target. Do not start a second local server. Public drives do not sign in.

**Production public (default when local secrets are missing).** This cloud and CI checkout often has no `apps/web/.env.local`. That is a valid verification mode. The public target is `https://annotated.cbandcoop.com`. Launch does not build or start Next.js. It records a prod-public run and leaves no server process. The site is shared. Do not comment, follow, bookmark, reshare, vote, or submit a claim. The only session this skill may install is the dedicated test user inside `drive authenticated-me`, and that drive is read-only.

**Local.** Use this only when `apps/web/.env.local` exists and both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are real values (not the `YOUR_PROJECT_REF` / `YOUR_SUPABASE_PUBLISHABLE_KEY` placeholders from `apps/web/.env.example`). `SUPABASE_SERVICE_ROLE_KEY` is not required for these public reads and must never be printed. From a clean checkout, install first:

```bash
pnpm install --frozen-lockfile
```

Local launch then runs, in the background, from the repository root:

```bash
pnpm --dir apps/web exec next dev --hostname 127.0.0.1 --port 3000
```

Ready means `http://127.0.0.1:3000/` returns HTTP 200 and the document title contains `Public annotation feed`. Next writes that title from the home page metadata. The feed has no `h1`.

One local instance owns port 3000. If something else is already listening, launch exits without adopting it. Two verification runs must not share one local server.

Force a target with `VERIFY_ANNOTATED_TARGET=prod` or `VERIFY_ANNOTATED_TARGET=local`. `local` fails closed when `.env.local` is missing or still placeholder. The helper never prints env values.

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs launch
```

Launch writes `/tmp/verify-annotated/state.json` (mode, base URL, run id, and the local pid when it started one). A healthy state already recorded by this helper is reused. Run cleanup before starting a different target.

## Doctor

Read-only. Run it before the first drive and again after anything surprising (a failed drive, a restart, a title that does not match).

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs doctor
```

Doctor requires a state file from launch. It then:

- Refuses to continue when `launched` is not this helper's state.
- Fetches `{baseUrl}/` and requires HTTP 200 and a title containing `Public annotation feed`.
- In `prod-public` mode, reports `ownedProcess: n/a`. There is no local pid to check. A non-200 or wrong title means the public site is not worth driving.
- In `local` mode, requires the recorded pid to still be alive and port 3000 to be held by that process group. A foreign listener is a failed doctor. Do not drive it.

Exit 0 prints `ready: yes` plus `mode` and `baseUrl`. Anything else exits 1. Do not drive a target that has not just passed doctor.

## Drive

Prefer accessible names and routes over coordinates and CSS order. Public drives open a fresh Chromium context with no cookies, so the visitor is signed out. `authenticated-me` adds only the session cookies returned for `cbandcooptest@gmail.com`. Headless Chromium is treated as Chrome, so the dismissible `Install for Chrome` callout can appear. Dismiss it with the button named `Dismiss install reminder` only when it covers the subject of the shot. That click writes localStorage in the throwaway browser and does not change the server.

Drive one feature per invocation. Public commands:

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive public-feed
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive public-annotation
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive legal
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive trending
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive who-to-follow
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive me-signed-out
```

`me-signed-out` only checks the signed-out wall at `/me`. It does not click `Sign in with Google` or `Continue with X`.

`authenticated-me` reads bookmarks and the public-handle region on `/me`. Without `SUPABASE_SERVICE_ROLE_KEY` it prints `verified-unreachable`, prints `set SUPABASE_SERVICE_ROLE_KEY`, and exits 3. It does not open Google. With the key set, it also needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Those values must come from the environment. Never print them.

`chrome-extension` stays exit 3. The side panel is an unpacked Manifest V3 extension. This harness does not load it, and cookies on the website do not open it.

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive chrome-extension
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive authenticated-me
```

Stable handles used by the public drives:

- Home: title `Public annotation feed`, list `[aria-label="Published annotations"]`, link `View annotation`, nav `Primary navigation`, link `Annotated home`.
- Annotation detail: title prefix `Annotation on `, heading `Comments`, source link name matching `Open clip on YouTube`, `Open clip on TikTok`, `Open clip on Spotify`, `Open original source`, or `View original source`. Do not follow that source link.
- Legal: `/legal` heading `Policies for Annotated`, `/privacy` heading `Privacy Policy`, `/terms` heading `Terms of Service`, footer nav `Legal`.
- Trending: `/trending`, title `What’s Trending`, heading `This week’s most active annotations.`
- Who to Follow: `/who-to-follow`, heading `Accounts worth following.`
- Signed-out Me: `/me`, heading `Sign in to see your bookmarks.`
- Signed-in Me: `/me`, region `Public handle`, link `Send feedback`, button `Sign out`. Do not click those controls.

Recipes and pass/fail observations live in `features/`. A card list is exit 0. The documented quiet headings `Not enough trending activity yet.` and `No suggestions right now.` are exit 2, result `pass-empty`, when the title is right and the page is HTTP 2xx. An unavailable alert, a wrong title, a 5xx, or any other unrecognized body is exit 1. Do not report `pass-empty` as a card proof.

## Evidence

Each successful or failed drive writes a directory that cleanup must leave in place:

`.cursor/skills/verify-annotated/evidence/<feature-id>/<run-id>/`

A public-feed proof contains:

- `feed-loaded.png` — the page after navigation, before any callout dismissal
- `feed.png` — the published list after the callout is out of the way
- `feed.aria.txt` — Playwright ARIA snapshot of `main`
- `notes.md` — feature id, entry URL, HTTP status, title, card count, first `View annotation` href, and whether the callout was dismissed

Other features write the same kind of set under their feature id (`loaded.png`, `result.png`, `result.aria.txt`, `notes.md`).

Proof standards:

- Exercise the real page. Do not call internal setters or test-only routes. The service-role key is used only by `authenticated-me`, only to ensure `cbandcooptest@gmail.com` and to mint that user's session. It must never be printed, logged, or written into `notes.md`.
- Record the action and the resulting state. A final screenshot alone is not the proof.
- Public drives are read-only. Confirm that by the notes: no sign-in, no comment, no follow, no bookmark, no reshare, no vote. `authenticated-me` may create that one auth user when the email is missing. It must not bookmark, comment, follow, reshare, vote, or claim a handle.
- Do not mock the public site. Local mode is the real `next dev` server. Prod-public mode is the real production origin.
- An unavailable alert is a failed proof. A quiet heading on Trending or Who to Follow is `pass-empty`, not a card proof.

## Cleanup

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs cleanup
```

Cleanup stops only the local Next.js process group this launch started (POSIX process group, or `taskkill /T` on Windows) and deletes `/tmp/verify-annotated/state.json` plus `/tmp/verify-annotated/logs/`. It does not kill by process name. It does not delete `evidence/`. It does not delete the Playwright cache at `/tmp/verify-annotated/tools/`.

After cleanup, the evidence directory from the drive must still exist. A cleanup that removes the proof has failed.

Run cleanup after a failed launch or drive too, so a half-started local server is not left on port 3000.

## Helpers

Invoke the harness with Node from the repository root. `node --help` is not required; pass `help`:

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs help
node --test .cursor/skills/verify-annotated/helpers/verify-annotated.test.mjs
```

`helpers/verify-annotated.mjs` drives the browser. `helpers/drive-outcome.mjs` classifies quiet discovery pages. `helpers/mint-test-session.mjs` mints the dedicated test session. The mint helper refuses every email other than `cbandcooptest@gmail.com`. When the service-role key is present, install dependencies first so `@supabase/ssr` can write the same cookies the app reads:

```bash
pnpm install --frozen-lockfile
```

On first `drive` of a browser feature, the helper installs Playwright and Chromium under `/tmp/verify-annotated/tools` (not in the repo) and sets `PLAYWRIGHT_BROWSERS_PATH` to that tree. It does not add a repository dependency and does not print secrets.

Exit codes: `0` ready or card proof, `1` launch, doctor, or drive failure, `2` `pass-empty` for a correctly rendered Trending or Who to Follow quiet page, `3` verified-unreachable. `chrome-extension` is always `3`. `authenticated-me` is `3` until `SUPABASE_SERVICE_ROLE_KEY` is set.

`/me` treats a visitor as signed in when `getUser()` returns a user id from the Supabase SSR cookies. The Google provider check lives only in the OAuth callback at `apps/web/src/lib/auth/auth-boundary.ts`. This drive does not open that callback. It asks the admin API for a magic-link token for the existing user with that email, exchanges the token with the publishable key, and injects the cookies `@supabase/ssr` stored. A Google-created user is reused. The helper does not run when `generate_link` is for any other email. If verify fails, the drive exits 1 with `mint_verify_failed` and stops. Do not set a password and do not automate Google.

## Maintenance

When the app changes, update this skill with `/maintain-verification-skill` rather than drifting the map by hand. That pass re-reads every feature file and drives the ones this launch model can reach.
