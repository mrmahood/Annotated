# Annotated verification map

This directory is the maintained source for verifying Annotated's user-facing behavior. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run commands from the repository root with `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs`.
- Launch first. Doctor must print `ready: yes` for that same state before any drive.
- **Prod-public mode** is the default when `apps/web/.env.local` is missing or still has `.env.example` placeholders. Base URL: `https://annotated.cbandcoop.com`. No local server is started. This is the public verification target, not a guess about deploy health beyond the doctor's HTTP and title checks.
- **Local mode** starts `next dev` on `http://127.0.0.1:3000` only when that env file holds a real `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never print those values. Never put a service-role key in the skill or the evidence notes.
- Prod-public is a shared site. Do not comment, follow, bookmark, reshare, vote, or file a claim during a drive. The only session the harness may install is `cbandcooptest@gmail.com` inside `drive authenticated-me`.
- Local port 3000 belongs to one verification run. Do not drive a server this helper did not start.
- Public drives use a fresh signed-out Chromium profile. Do not reuse a personal Chrome profile.

## Driving conventions

- Start every recipe from the launched target unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names. The published list is a `div` with `aria-label="Published annotations"`. The home lede is an `h1`.
- Treat helper commands as literal.
- Stay on the launched origin. Do not follow `Open source` or the annotation page's outbound source button.
- Dismiss `Install for Chrome` only to uncover the subject of a screenshot. The button name is `Dismiss install reminder`.
- Restore nothing on the server. These public recipes do not mutate Annotated data.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the page title or primary heading visible.
- Record the feature ID, entry path, and run id with every artifact.
- Report an unreachable path with the command that was run and the unmet precondition. Exit code 3 means verified-unreachable. On a non-staging target, `authenticated-me` stays there until `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are set. `chrome-extension` exits 0 or 1 and does not mint a session.
- Do not report a skipped entry point as verified through a different path.
- Exit 0 is a card or signed-in proof. Exit 2 is `pass-empty` for the documented Trending and Who to Follow quiet headings. An unavailable alert, a wrong title, or a 5xx is exit 1. Do not report `pass-empty` as populated content. The public feed's empty copy is still a failed proof.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-annotated` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Public feed](./public-feed.md) covers the signed-out home feed at `/`, including populated cards, empty copy, unavailable copy, and pagination.
- [Public annotation](./public-annotation.md) covers opening one published annotation from a card, the canonical `/[creatorHandle]/[annotationSlug]` URL, and the `/a/[annotationId]` compatibility path.
- [Legal](./legal.md) covers the legal center, Privacy Policy, and Terms of Service.
- [Trending](./trending.md) covers the signed-out What's Trending page. A quiet ranking is `pass-empty` (exit 2). Cards are exit 0.
- [Who to Follow](./who-to-follow.md) covers the signed-out suggestion list. An empty suggestion list is `pass-empty` (exit 2). Following stays behind sign-in and is not completed.
- [Me signed out](./me-signed-out.md) covers the signed-out wall at `/me`: title `Bookmarks | Annotated`, headings `Bookmarks` and `Sign in to see your bookmarks.`, and `Sign in with Google`.
- [Chrome extension](./chrome-extension.md) loads the unpacked side panel and drives YouTube Create. It exits 0 or 1 and does not click Publish clip. It does not need `launch` or `doctor`.
- [Authenticated Me and Create](./authenticated-me.md) reads bookmarks and the public-handle region on `/me` for `cbandcooptest@gmail.com`. Without that target's service-role key and public Supabase config it exits 3. A Staging preview uses `SUPABASE_STAGING_SERVICE_ROLE_KEY`. Create stays on [Chrome extension](./chrome-extension.md). The signed-out `/me` wall is [Me signed out](./me-signed-out.md).

## Not a feature file yet

- Public profile `/p/[profileId]` opens from a creator name on a card or annotation. It is a public page and is not yet its own feature file.
- `/ops` is an allowlisted operator console, not a public surface.
- `/auth/error` is the sign-in failure page. Do not start OAuth to reach it.
- `/robots.txt`, `/sitemap.xml`, and `/llms.txt` are public discoverability files on the same origin. They are not a signed-out browser drive.
- `/demo` (`apps/web/src/app/demo/page.tsx`) is the public read-only fact-check demo. Home links it as `Try the demo`. It includes `/demo.mp4`. This map does not drive it.
- `/demo/passage-highlight` (`apps/web/src/app/demo/passage-highlight/page.tsx`) is a noindex highlight fixture, not a signed-out drive.
- `/demo/opengraph-image` (`apps/web/src/app/demo/opengraph-image.tsx`) is the demo social image. It is not a browser drive.
- `/agents` (`apps/web/src/app/agents/page.tsx`) is the public agents guide. The footer nav `About Annotated` links it. ClaimReview markup (`apps/web/src/lib/claim-review-jsonld.ts`) is JSON-LD on annotation pages, not its own route.
- `/whats-new` (`apps/web/src/app/whats-new/page.tsx`) is the public extension changelog. The same footer nav links it.
- The extension update banner (`apps/extension/entrypoints/sidepanel/extension-update-banner.tsx`) and the microphone permission page (`apps/extension/entrypoints/microphone-permission/index.html`) are not part of `drive chrome-extension`.
