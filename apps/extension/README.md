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
