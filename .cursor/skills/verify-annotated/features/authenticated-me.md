# Authenticated Me and Create

Me on the web is a private bookmark list and the place a signed-in person sets a public handle. Create lives in the Chrome extension, on the button labeled `Create`, not on a public web route. Signed-in Me and Create are mapped and deferred. They need a real OAuth session, and Create also needs the extension loaded. The signed-out wall at `/me` is [Me signed out](./me-signed-out.md).

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
- A real Google or X session is required for bookmarks and the handle. This harness does not have one and must not ask the operator to paste one.
- Create additionally needs the extension loaded. See [Chrome extension](./chrome-extension.md).

- **Signed-out wall.** Follow [Me signed out](./me-signed-out.md). Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive me-signed-out`. Pass and fail observations live in that file.
- **Authenticated bookmarks and handle.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive authenticated-me`. The command prints `verified-unreachable`, names the unmet precondition `OAuth session for Me`, and exits 3. It does not start Google or X sign-in.
- **Create.** Use `drive chrome-extension`. It exits 3 for the same reason: extension load plus a session. Do not look for a `/create` page.

## Gotchas

- Needs OAuth for signed-in Me, and an extension load for Create. The public signed-out wall is a separate drive.
- Do not click `Sign in with Google` or `Continue with X`. Wall pass criteria, including a hidden X button, live in [Me signed out](./me-signed-out.md).
- Signed-in empty copy is `No bookmarks yet.` That state is out of scope for the signed-out wall.
- `Send feedback` is an external form. Do not open it.
- Do not type a handle. Claiming one writes the signed-in profile.
