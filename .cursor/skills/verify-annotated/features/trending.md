# Trending

Trending is a public ranking of published annotations from the last 7 days, one card per author. Signed-out visitors can read it. The document title is `What’s Trending | Annotated`. The heading is `This week’s most active annotations.`

## Sub-features

- `trending-open` opens `/trending` from the header or a direct visit.
- `trending-cards` lists ranked annotations when the window has enough activity.
- `trending-quiet` explains when fewer than two annotations score in the window.
- `trending-unavailable` shows an alert when the ranking cannot be read.

## How to get to it (user POV)

- Choose `Trending` in `Primary navigation`.
- Visit `/trending`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- The visitor is signed out.

- **Open trending.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive trending`. The path is `/trending`. The document title is `What’s Trending | Annotated`. The heading `This week’s most active annotations.` is visible. `Trending` in `Primary navigation` is the current page.
- **Read the body.** One of these is visible: a list named `Trending annotations` with a `View annotation` link, the heading `Not enough trending activity yet.`, or the alert heading `Trending is temporarily unavailable.`
- **Proof.** A passing card proof requires the named list. The quiet and unavailable headings are written to `notes.md` and exit 1. `result.png` and `result.aria.txt` still record what rendered.

## Gotchas

- The title and heading use a curly apostrophe (`What’s`, `week’s`). Match that character.
- The feed's trending strip on `/` is not this page. Prove `/trending` itself.
- Quiet is a successful render of an empty ranking and a failed proof of cards. Say which one you observed.
- Do not sign in to try to change the ranking.
