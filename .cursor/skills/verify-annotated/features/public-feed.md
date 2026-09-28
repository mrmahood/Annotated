# Public feed

The public feed is the signed-out home page. It lists published annotations, newest activity first, with a link to each annotation. The page eyebrow reads `PUBLIC ANNOTATIONS`. There is no `h1`. The document title is `Public annotation feed | Annotated`.

## Sub-features

- `feed-open` opens `/` from the wordmark, the Feed link, or a direct visit.
- `feed-cards` shows at least one published annotation and a `View annotation` link.
- `feed-empty` shows the empty copy when the page has no rows.
- `feed-unavailable` shows an alert when the feed cannot be read.
- `feed-pagination` moves between pages with `Previous` and `Next` inside `Annotation pages`.

## How to get to it (user POV)

- Open the site root `/`.
- Choose `Annotated home` or `Feed` in `Primary navigation`.
- From a later page, choose `Previous` until `Page 1`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- The browser context has no Annotated session.

- **Open the feed.** Visit `/` as a signed-out visitor. Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive public-feed`. The HTTP status is 200. The document title contains `Public annotation feed`. The lede `Your media notations across video, podcasts & text shared with the world.` is visible.
- **See cards.** The list named `Published annotations` contains at least one `article`, and a link named `View annotation` is visible. The command records that link's href in `notes.md` and does not open it.
- **Capture both states.** `feed-loaded.png` is the page as it finished loading. If `Dismiss install reminder` is visible, the command clicks it and then writes `feed.png`. If the callout is absent, `feed.png` is the same view. `feed.aria.txt` is the ARIA snapshot of `main`.
- **Do not mutate.** The command does not activate Share, Bookmark, Follow, comment, or sign-in controls.

A populated list is the passing proof for `feed-cards`. When the alert `The public feed is temporarily unavailable.` is visible, or the heading `No annotations have been published yet.` is visible, the drive exits 1 and still writes the artifacts. That is not a pass.

## Gotchas

- Proof is the document title plus the named list. Do not wait for an `h1`.
- `?page=0`, an empty `page` value, and repeated `page` params redirect to the canonical page URL. Assert the list on `/` or `/?page=2`, not on a non-canonical query.
- Page 2's empty copy is `There are no annotations on this page.`, which is different from the page 1 empty heading.
- The install callout can sit over the header in Chromium. Dismiss it for the result screenshot. Do not treat the callout as the feed.
- Card titles and creators change. Assert the list and `View annotation`, not a specific annotation title.
- This recipe does not sign in. Production OAuth is out of scope.
