# Authenticated Me and Create

Me on the web is a private bookmark list and the place a signed-in person sets a public handle. Create lives in the Chrome extension, on the button labeled `Create`, not on a public web route. Signed-in Me and Create are mapped and deferred. They need a real OAuth session, and Create also needs the extension loaded. The signed-out web wall at `/me` is the only part this harness drives.

## Sub-features

- `me-signed-out` shows `Sign in to see your bookmarks.` with `Sign in with Google` and, when X is enabled, `Continue with X`.
- `me-bookmarks` lists that person's private bookmarks under `Your bookmarks` after sign-in.
- `me-handle` shows `Public handle` and either a claimed `@handle` or `Claim handle`.
- `create-extension` opens the extension `Create` view. It is not reachable from `/me`.

## How to get to it (user POV)

- Choose `Me` in `Primary navigation`, or visit `/me`.
- Signed out, stop at the sign-in wall. Signed in, the bookmark list and public handle are on that page, and `Send feedback` opens an external form.
- To create an annotation, open the extension side panel and choose `Create`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes` for the signed-out wall.
- A real Google or X session is required for bookmarks and the handle. This harness does not have one and must not ask the operator to paste one.
- Create additionally needs the extension loaded. See [Chrome extension](./chrome-extension.md).

- **Signed-out wall.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive me-signed-out`. The path is `/me`. The title is `Bookmarks | Annotated`. The heading `Bookmarks` and the heading `Sign in to see your bookmarks.` are visible. `Sign in with Google` is visible. The command does not click it.
- **Authenticated bookmarks and handle.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive authenticated-me`. The command prints `verified-unreachable`, names the unmet precondition `OAuth session for Me`, and exits 3. It does not start Google or X sign-in.
- **Create.** Use `drive chrome-extension`. It exits 3 for the same reason: extension load plus a session. Do not look for a `/create` page.

## Gotchas

- Needs OAuth for signed-in Me, and an extension load for Create. Neither is required for the first public proof.
- Clicking `Sign in with Google` leaves the read-only proof and opens the provider. Do not click it.
- X can be hidden when the deployment turns it off. Do not fail the signed-out wall only because `Continue with X` is absent. Do fail it when `Sign in with Google` is absent.
- Signed-in empty copy is `No bookmarks yet.` That state is not proved by the signed-out wall.
- `Send feedback` is an external form. Do not open it.
- Do not type a handle. Claiming one writes the signed-in profile.
