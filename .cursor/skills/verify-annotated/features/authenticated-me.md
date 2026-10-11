# Authenticated Me and Create

Me on the web is a private bookmark list and the place a signed-in person sets a public handle. Create lives in the Chrome extension, on the button labeled `Create`, not on a public web route. This drive reads `/me` for `cbandcooptest@gmail.com` only. Create stays with [Chrome extension](./chrome-extension.md). The signed-out wall at `/me` is [Me signed out](./me-signed-out.md).

## Sub-features

- `me-signed-out` is the signed-out wall at `/me`. Its recipe is [Me signed out](./me-signed-out.md).
- `me-bookmarks` lists that person's private bookmarks under `Your bookmarks` after sign-in.
- `me-handle` shows `Public handle` and either a claimed `@handle` or `Claim handle`.
- `create-extension` opens the extension `Create` view. It is not reachable from `/me`.

## How to get to it (user POV)

- Choose `Me` in `Primary navigation`, or visit `/me`.
- Signed out, stop at the sign-in wall in [Me signed out](./me-signed-out.md). Signed in, the bookmark list and public handle are on that page, and `Send feedback` opens an external form.
- To create an annotation, open the extension side panel and choose `Create`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are in the environment. The helper never prints them.
- The only address the helper accepts is `cbandcooptest@gmail.com`. Do not pass another email.
- Create still needs the extension loaded. See [Chrome extension](./chrome-extension.md).

- **Signed-out wall.** Follow [Me signed out](./me-signed-out.md). Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive me-signed-out`. Pass and fail observations live in that file.
- **Missing key.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive authenticated-me` with no service-role key. The command prints `verified-unreachable` and `set SUPABASE_SERVICE_ROLE_KEY`, then exits 3. It does not open a browser and does not start Google or X.
- **Authenticated bookmarks and handle.** With the env set, run the same command. It ensures that one auth user exists, exchanges a magic-link token for session cookies, and opens `/me`. Pass requires HTTP 2xx, title `Bookmarks | Annotated`, region `Public handle`, link `Send feedback`, button `Sign out`, and no heading `Sign in to see your bookmarks.` Bookmarks pass when the heading is `No bookmarks yet.` or the list `Your bookmarks` contains `View annotation`. The alert `Bookmarks are temporarily unavailable.` exits 1. Do not click `Claim handle`, `Save handle`, `Change handle`, `Bookmarked`, `Share`, `Sign out`, or `Send feedback`.
- **Create.** Use `drive chrome-extension`. It exits 3 because the side panel is not loaded. Do not look for a `/create` page.

## Gotchas

- Without `SUPABASE_SERVICE_ROLE_KEY` the drive stays exit 3. Do not paste a session into the skill or the evidence notes.
- `/me` accepts the Supabase cookie session from `getUser()`. The Google identity check runs only on the OAuth callback, which this drive does not open. If magic-link verify fails, stop at `mint_verify_failed`. Do not set a password and do not automate Google.
- The helper may create the auth user when that email is missing. It must not create a second user, and it must not write bookmarks, comments, follows, or annotations.
- Do not click `Sign in with Google` or `Continue with X`. Wall pass criteria live in [Me signed out](./me-signed-out.md).
- Signed-in empty copy is `No bookmarks yet.` That is a pass for this drive. It is out of scope for the signed-out wall.
- `Send feedback` is an external form. Do not open it.
- Do not type a handle. Claiming one writes the signed-in profile.
