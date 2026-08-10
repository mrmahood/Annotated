# Annotated Chrome extension

The Manifest V3 side panel is Annotated's primary interaction shell. Its compact
top-level navigation is Context (the default), Feed, and Me. Annotation detail,
comments, and creator profiles are pushed onto an in-memory navigation stack so
Back returns to the prior panel view without changing browser history or the
connected page.

Context owns the connected-source and capture/publishing state. Social views can
be opened and closed without unmounting that state. Published source annotations,
the public feed, detail, profiles, comments, and follow state are read directly
from Supabase through focused extension data modules; signed-out public reads use
the same RLS-protected records as the companion web app.

After `publish_article_annotation` succeeds, the completed capture and commentary
are cleared and the new annotation opens inside the side panel. The public
`/a/[annotationId]` page remains available as a secondary action; publishing no
longer opens that page automatically.

Authentication continues to use Google OAuth through `chrome.identity`, with the
Supabase session persisted in `chrome.storage.local`. The extension permissions
remain `sidePanel`, `activeTab`, `storage`, `scripting`, and `identity`.

## YouTube time-coded annotations

Supported YouTube watch and `youtu.be` URLs normalize to one canonical watch URL
per video. Clip drafts store only that video identity, millisecond start/end
values, and required text commentary in `chrome.storage.session`. Metadata and
player position are read from the explicitly connected tab with narrowly scoped
`chrome.scripting.executeScript` calls; there is no persistent content script or
media download.

Recorded audio is intentionally article-only for this milestone. A future
milestone can attach optional audio to a YouTube annotation through the existing
`annotation_audio` one-to-one metadata table and owned Storage-object validation,
but it should add a dedicated YouTube-with-audio RPC so the upload verification
and time-range publication remain one database transaction. The current YouTube
publisher must not be expanded by accepting unverified storage metadata.

## Podcast and web-audio time ranges

Annotated supports a connected HTTP(S) page when its top-level document exposes
one safely selectable `HTMLAudioElement`, or an `HTMLVideoElement` that has loaded
metadata and explicitly reports zero video dimensions. Selection prefers the
currently playing usable element, then a unique usable element, and prefers a
real audio element over an audio-only video element. Equally eligible players
produce an ambiguous state instead of being controlled.

The extension reads metadata/player state only through one-shot
`chrome.scripting.executeScript` calls against frame 0 of the explicitly
connected tab. It adds no content script, host permission, monitoring loop, or
media download. Audio clip drafts use `annotated.audioClipDraft.v1` in
`chrome.storage.session` and restore only for the same normalized episode/page.

Useful public manual-test targets (verified to serve a top-level `<audio>`
element as of August 9, 2026) are:

- [Buzzsprout: Podcast hosting—setting up your show](https://podcast.buzzsprout.com/1/episodes/10137707-podcast-hosting-setting-up-your-show-on-buzzsprout)
- [Podnews: How people find new podcasts](https://podnews.net/update/discoverability-shownotestest)
- [Transistor: How Ben and David bootstrapped the Acquired podcast](https://saas.transistor.fm/episodes/acquired)

These pages are test fixtures, not service-specific integrations. Their player
markup can change independently, so manual testing should confirm the element is
still top-level and has a finite duration before treating a failure as an
Annotated regression.

Recorded Annotated audio commentary remains article-only. Future composition
could reuse the existing one-to-one `annotation_audio` metadata model, but it
would require a dedicated atomic audio-clip-with-commentary publishing path;
source audio must still remain on the original site.
