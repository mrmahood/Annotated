# Annotated verification map

This directory is the maintained source for verifying Annotated's user-facing behavior. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run commands from the repository root with `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs`.
- Launch first. Doctor must print `ready: yes` for that same state before any drive.
- **Prod-public mode** is the default when `apps/web/.env.local` is missing or still has `.env.example` placeholders. Base URL: `https://annotated.cbandcoop.com`. No local server is started. This is the public verification target, not a guess about deploy health beyond the doctor's HTTP and title checks.
- **Local mode** starts `next dev` on `http://127.0.0.1:3000` only when that env file holds a real `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never print those values. Never put a service-role key in the skill or the evidence notes.
- Prod-public is a shared read-only site. Do not sign in, comment, follow, bookmark, reshare, vote, or file a claim during a drive.
- Local port 3000 belongs to one verification run. Do not drive a server this helper did not start.
- The browser context is a fresh signed-out Chromium profile. Do not reuse a personal Chrome profile.

## Driving conventions

- Start every recipe from the launched target unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names. The feed list is the exception: it is a `div` with `aria-label="Published annotations"` and no `h1`.
- Treat helper commands as literal.
- Stay on the launched origin. Do not follow `Open source` or the annotation page's outbound source button.
- Dismiss `Install for Chrome` only to uncover the subject of a screenshot. The button name is `Dismiss install reminder`.
- Restore nothing on the server. These public recipes do not mutate Annotated data.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the page title or primary heading visible.
- Record the feature ID, entry path, and run id with every artifact.
- Report an unreachable path with the command that was run and the unmet precondition. Exit code 3 means verified-unreachable.
- Do not report a skipped entry point as verified through a different path.
- An unavailable alert or an empty state is a completed observation and a failed proof of populated content.

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
- [Trending](./trending.md) covers the signed-out What's Trending page.
- [Who to Follow](./who-to-follow.md) covers the signed-out suggestion list. Following stays behind sign-in and is not completed.
- [Me signed out](./me-signed-out.md) covers the signed-out wall at `/me`: title `Bookmarks | Annotated`, headings `Bookmarks` and `Sign in to see your bookmarks.`, and `Sign in with Google`.
- [Chrome extension](./chrome-extension.md) is mapped and deferred. Create, Feed, and Me inside the side panel need an unpacked extension load.
- [Authenticated Me and Create](./authenticated-me.md) is mapped and deferred. Signed-in bookmarks, the public handle, and Create need a real OAuth session or the extension. The signed-out `/me` wall is [Me signed out](./me-signed-out.md).

## Not a feature file yet

- Public profile `/p/[profileId]` opens from a creator name on a card or annotation. It is a public page and is not yet its own feature file.
- `/ops` is an allowlisted operator console, not a public surface.
- `/auth/error` is the sign-in failure page. Do not start OAuth to reach it.
- `/robots.txt`, `/sitemap.xml`, and `/llms.txt` are public discoverability files on the same origin. They are not a signed-out browser drive.
