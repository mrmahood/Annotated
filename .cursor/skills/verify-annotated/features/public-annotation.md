# Public annotation

A public annotation page shows one published annotation: the author, the commentary, the source it points at, and comments. Signed-out visitors can read it. Canonical URLs look like `/[creatorHandle]/[annotationSlug]`. `/a/[annotationId]` remains a compatibility URL.

## Sub-features

- `annotation-from-feed` opens the detail page from `View annotation` on a feed card.
- `annotation-canonical` lands on `/[creatorHandle]/[annotationSlug]` when the annotation has a public route.
- `annotation-uuid-fallback` keeps a historical row readable at `/a/[annotationId]` when no canonical path exists. When a canonical path does exist, `/a/[annotationId]` redirects to it.
- `annotation-source` shows an outbound source link and does not replace the annotation page with that site.
- `annotation-comments` shows the `Comments` section.

## How to get to it (user POV)

- On the feed, a trending card, or a profile, choose `View annotation`.
- Open a shared canonical URL `/{creatorHandle}/{annotationSlug}`.
- Open a legacy URL `/a/{annotationId}`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- `public-feed` can see at least one `View annotation` link. This recipe uses that link. It does not invent an id.

- **Open the first card.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive public-annotation`. The command loads `/`, records the first `View annotation` href, and follows that link.
- **Land on the detail page.** The final URL stays on the launched origin. The path is either `/{handle}/{slug}` or `/a/{annotationId}`. The document title starts with `Annotation on `.
- **See the source and the discussion.** A link named `Open clip on YouTube`, `Open clip on TikTok`, `Open clip on Spotify`, `Open original source`, or `View original source` is visible. The heading `Comments` is visible. The command does not activate the source link.
- **Proof.** `loaded.png` is the feed before the click. `result.png` is the detail page. `result.aria.txt` and `notes.md` record the href that was opened and the final path.

Exit 1 if the feed has no `View annotation` link or the detail title does not start with `Annotation on `.

## Gotchas

- Do not follow the outbound source control. Leaving the origin drops the proof.
- `/a/{annotationId}` often redirects to the canonical path. Assert the document the browser settles on, not the URL before the redirect.
- Some annotations lead with a visible title and some with a visually hidden `Annotation` or `Voice commentary` heading. The document title prefix is the stable check.
- Comments may be empty (`No comments yet. Start the conversation.`) or an alert (`Comments are temporarily unavailable.`). The `Comments` heading is still required.
- Share, bookmark, vote, follow, and comment composer actions ask a signed-out visitor to continue with Google or X. Do not click them.
