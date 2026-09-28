# Who to Follow

Who to Follow lists curated public profiles. Signed-out visitors can see the suggestions. Choosing Follow asks them to continue with Google or X and does not follow anyone until they finish sign-in.

## Sub-features

- `follow-open` opens `/who-to-follow` from the header or a direct visit.
- `follow-suggestions` shows the suggestion list when curated profiles are available.
- `follow-empty` shows the empty copy when there is nothing to suggest.
- `follow-unavailable` shows an alert when suggestions cannot be read.
- `follow-sign-in` is the signed-out gate on Follow. This harness does not complete it.

## How to get to it (user POV)

- Choose `Follow` in `Primary navigation`.
- Visit `/who-to-follow`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- The visitor is signed out.

- **Open the page.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive who-to-follow`. The path is `/who-to-follow`. The document title is `Who to Follow | Annotated`. The heading `Accounts worth following.` is visible. `Follow` in `Primary navigation` is the current page.
- **Read suggestions.** One of these is visible: a region named `Suggested accounts`, the heading `No suggestions right now.`, or the alert heading `Who to Follow is temporarily unavailable.`
- **Leave Follow alone.** The command does not click `Follow`, `Sign in to follow`, or `Continue with X`.
- **Proof.** A passing suggestion proof requires `Suggested accounts`. Empty and unavailable states exit 1 after the artifacts are written.

## Gotchas

- The header link is named `Follow`, not `Who to Follow`. The page heading is `Accounts worth following.`
- A signed-out Follow control starts OAuth. Clicking it abandons the read-only proof.
- Accounts the signed-in viewer already follows are hidden. This recipe stays signed out so it does not depend on that filter.
- Suggestions are curated. An empty list can be true without the page being broken. Record the heading you saw.
