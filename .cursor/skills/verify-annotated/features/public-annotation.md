# Public annotation

A public annotation page shows one published annotation: the author, the commentary, the source it points at, and comments. A note may also show a type label, a verdict, a Sources region, and a Consensus region. `File a claim` and `Post to X` are on the page and must stay unclicked. Signed-out visitors can read it. Share, bookmark, vote, and comment use one panel headed `Sign in to share, save, vote, or comment`. Follow in the author row uses `Sign in to follow`. Canonical URLs look like `/[creatorHandle]/[annotationSlug]`. `/a/[annotationId]` remains a compatibility URL.

## Sub-features

- `annotation-from-feed` opens the detail page from `View annotation` on a feed card.
- `annotation-canonical` lands on `/[creatorHandle]/[annotationSlug]` when the annotation has a public route.
- `annotation-uuid-fallback` keeps a historical row readable at `/a/[annotationId]` when no canonical path exists. When a canonical path does exist, `/a/[annotationId]` redirects to it.
- `annotation-source` shows an outbound source link and does not replace the annotation page with that site.
- `annotation-comments` shows the `Comments` section.

## How to get to it (user POV)

- On a feed card, a `/trending` card, or a profile card, choose `View annotation`. The home `Active this week` strip links the whole card and is not named `View annotation`.
- Open a shared canonical URL `/{creatorHandle}/{annotationSlug}`.
- Open a legacy URL `/a/{annotationId}`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- `public-feed` can see at least one `View annotation` link. This recipe uses that link. It does not invent an id.

- **Open the first card.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive public-annotation`. The command loads `/`, records the first `View annotation` href, and follows that link.
- **Land on the detail page.** The final URL stays on the launched origin. The path is either `/{handle}/{slug}` or `/a/{annotationId}`. The document title starts with `Annotation on `.
- **See the source and the discussion.** A link named `Open clip on YouTube`, `Open clip on TikTok`, `Open clip on Spotify`, `Open original source`, or `View original source` is visible. The heading `Comments` is visible. The heading `Sign in to share, save, vote, or comment` is visible, and the button `Sign in to follow` is visible. The command does not activate the source link, the sign-in panel, or Follow.
- **Proof.** `loaded.png` is the feed before the click. `result.png` is the detail page. `result.aria.txt` and `notes.md` record the href that was opened, the final path, and whether the sign-in panel and `Sign in to follow` were visible.

Exit 1 if the feed has no `View annotation` link, the detail title does not start with `Annotation on `, the source link is missing, the sign-in panel heading is missing, or `Sign in to follow` is missing.

## Gotchas

- Do not follow the outbound source control. Leaving the origin drops the proof.
- `/a/{annotationId}` often redirects to the canonical path. Assert the document the browser settles on, not the URL before the redirect.
- Some annotations lead with a visible title and some with a visually hidden `Annotation` heading. The document title prefix is the stable check.
- Comments may be empty (`No comments yet. Start the conversation.`) or an alert (`Comments are temporarily unavailable. Please try again later.`). The `Comments` heading is still required.
- The signed-out panel `Sign in to share, save, vote, or comment` sits above Share, Bookmark, Votes, and Comments, with `Continue with Google` and `Continue with X`. Share, Bookmark, Upvote, Downvote, and Post comment open that same panel in a dialog and return with `?intent=`. Do not click the panel, those controls, or the provider buttons.
- Follow in the author row is `Sign in to follow` and `Continue with X`. Do not click them.
- Do not click `File a claim`, `Post to X`, or a control that marks a source helpful. Those write. The drive checks the source link and the `Comments` heading, not a particular verdict.
