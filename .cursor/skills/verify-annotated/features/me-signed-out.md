# Me signed out

A signed-out visitor who opens Me sees a sign-in wall instead of a bookmark list. The document title is `Bookmarks | Annotated`. The page heading is `Bookmarks`, and the wall heading is `Sign in to see your bookmarks.` The button `Sign in with Google` is visible. `Continue with X` appears only when that provider is enabled.

## Sub-features

- `me-signed-out` shows the `/me` sign-in wall: heading `Sign in to see your bookmarks.` and the button `Sign in with Google`. Private bookmarks stay behind sign-in.

## How to get to it (user POV)

- Choose `Me` in `Primary navigation`.
- Visit `/me` while signed out.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- The visitor is signed out. Leave both sign-in buttons unclicked.

- **Open the wall.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive me-signed-out`. The path is `/me`. The document title is `Bookmarks | Annotated`. The heading `Bookmarks` and the heading `Sign in to see your bookmarks.` are visible. `Sign in with Google` is visible. The command does not click it.
- **Proof.** `result.png`, `result.aria.txt`, and `notes.md` record the wall. A pass requires that title, both headings, and `Sign in with Google`. `Continue with X` may be absent. Do not fail only because X is hidden.

## Gotchas

- Do not click `Sign in with Google` or `Continue with X`. Either click leaves the read-only proof and opens a provider.
- `Continue with X` can be hidden when the deployment turns X off. Absence of that control is not a failure. Absence of `Sign in with Google` is.
- Authenticated empty copy `No bookmarks yet.` is out of scope. This drive stays signed out and does not prove that state.
- `Send feedback` and `Claim handle` appear after sign-in. They are out of scope.
