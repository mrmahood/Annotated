---
name: verify-annotated
description: "Drive Annotated's public Next.js web app the way a signed-out visitor does and capture proof. Use for verify-annotated, a scripted check of the public feed, an annotation page, legal pages, trending, or who-to-follow, against local apps/web or the production public site https://annotated.cbandcoop.com."
---

# Verify Annotated

Annotated's primary scripted surface is the public Next.js app in `apps/web`. The Chrome side panel (`apps/extension`) and signed-in Me/Create are mapped and deferred: they need a real OAuth session or an unpacked extension, and this skill does not start either.

The harness is `verify-annotated` (`helpers/verify-annotated.mjs`). It launches one target, checks it, drives a feature in a fresh signed-out browser, and writes proof under `evidence/`. Run every command from the repository root.

## Launch

Pick one target. Do not start a second local server, and do not sign in on either target.

**Production public (default when local secrets are missing).** This cloud and CI checkout often has no `apps/web/.env.local`. That is a valid verification mode. The public target is `https://annotated.cbandcoop.com`. Launch does not build or start Next.js. It records a prod-public run and leaves no server process. The site is shared and read-only for this skill: do not sign in, comment, follow, bookmark, reshare, vote, or submit a claim.

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

Prefer accessible names and routes over coordinates and CSS order. The helper opens a fresh Chromium context with no cookies, so the visitor is signed out. Headless Chromium is treated as Chrome, so the dismissible `Install for Chrome` callout can appear. Dismiss it with the button named `Dismiss install reminder` only when it covers the subject of the shot. That click writes localStorage in the throwaway browser and does not change the server.

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

Deferred commands exit 3 and print `verified-unreachable`. They do not open OAuth and do not load the extension:

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

Recipes and pass/fail observations live in `features/`. A drive that renders the unavailable or empty copy for that feature is a finished drive with a failed proof. Do not report it as verified.

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

- Exercise the real signed-out page. Do not call internal setters, test-only routes, or Supabase with a service key.
- Record the action and the resulting state. A final screenshot alone is not the proof.
- These public drives are read-only. Confirm that by the notes: no sign-in, no comment, no follow, no bookmark, no reshare, no vote. There is no local file or database side effect on the prod-public target.
- Do not mock the public site. Local mode is the real `next dev` server. Prod-public mode is the real production origin.
- An unavailable alert or an empty heading is evidence of that state, not evidence that cards or suggestions rendered.

## Cleanup

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs cleanup
```

Cleanup stops only the local Next.js process group this launch started (POSIX process group, or `taskkill /T` on Windows) and deletes `/tmp/verify-annotated/state.json` plus `/tmp/verify-annotated/logs/`. It does not kill by process name. It does not delete `evidence/`. It does not delete the Playwright cache at `/tmp/verify-annotated/tools/`.

After cleanup, the evidence directory from the drive must still exist. A cleanup that removes the proof has failed.

Run cleanup after a failed launch or drive too, so a half-started local server is not left on port 3000.

## Helpers

`helpers/verify-annotated.mjs` is the only helper. Invoke it with Node from the repository root. `node --help` is not required; pass `help`:

```bash
node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs help
```

On first `drive`, the helper installs Playwright and Chromium under `/tmp/verify-annotated/tools` (not in the repo) and sets `PLAYWRIGHT_BROWSERS_PATH` to that tree. It does not add a repository dependency and does not print secrets.

Exit codes: `0` ready or proved, `1` launch, doctor, or drive failure, `3` mapped feature that is verified-unreachable (extension load or an authenticated Me/Create session).

## Maintenance

When the app changes, update this skill with `/maintain-verification-skill` rather than drifting the map by hand. That pass re-reads every feature file and drives the ones this launch model can reach.
