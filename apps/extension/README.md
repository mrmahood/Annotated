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
