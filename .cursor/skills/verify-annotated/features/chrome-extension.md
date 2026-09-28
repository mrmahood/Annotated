# Chrome extension

The Chrome side panel is where a person creates an annotation on the tab they are reading. The panel's top buttons are `Create`, `Feed`, and `Me`. `Create` is the connected-page view. This feature is mapped and deferred. The first public proof does not load the extension.

## Sub-features

- `extension-load` makes the side panel available from the Chrome toolbar after an unpacked load.
- `extension-create` shows the connected page and the capture controls under `Create`.
- `extension-feed` shows the public feed inside the panel.
- `extension-me` shows the signed-in Me view inside the panel, or a sign-in prompt when there is no session.

## How to get to it (user POV)

- Install the unpacked extension, then open the Annotated side panel from the Chrome toolbar icon.
- The in-product install reminder on the public site is titled `Install for Chrome` and offers `Get sidebar`. The site states that Annotated is not on the Chrome Web Store.
- Inside the panel, choose `Create`, `Feed`, or `Me`.

## Driving it with verify-annotated

Preconditions:

- A Chrome profile with the Annotated unpacked extension loaded.
- For a publish proof, a signed-in extension session (Google OAuth through the extension) and a tab the panel can connect to.
- Those preconditions are not met by `launch` or `doctor`.

- **Do not drive it here.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive chrome-extension`. The command prints `verified-unreachable`, names the unmet precondition `Chrome extension load`, and exits 3. It does not download `extension.zip`, does not open `chrome://extensions`, and does not launch Chrome with a load-unpacked profile.

## Gotchas

- Needs an unpacked extension load. Not required for the first public proof.
- There is no web route that renders the side panel. Proving `/` does not prove `Create`.
- The visible button is `Create`. Do not look for a tab labeled `Context`.
- Publishing is a real write (draft annotation, capture, upload). Do not attempt it from this read-only harness.
- Browser restart cannot recover an in-memory recording. This skill does not try.
- No Chrome Web Store listing is part of this map. Do not invent a store URL.
