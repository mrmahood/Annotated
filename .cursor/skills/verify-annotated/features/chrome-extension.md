# Chrome extension

The Chrome side panel is where a person creates an annotation on the tab they are reading. The panel's top buttons are `Create`, `Feed`, and `Me`. `Create` for a YouTube watch page trims with drag handles and `30s` / `60s` presets. There are no typed START/END fields. Publish clip stays disabled until the range is from 1 to 90 seconds and the other publish gates are open. This drive stops before publishing.

## Sub-features

- `extension-load` loads `apps/extension/.output/chrome-mv3` and opens `sidepanel.html` by its extension id.
- `extension-create` drives YouTube Create: presets, drag-trim, the 90-second ceiling, and the Publish gate.
- `extension-audio` repeats those trim checks on a local audio page when the panel connects to it.
- `extension-feed` and `extension-me` stay outside this drive.

## How to get to it (user POV)

- Build the unpacked extension, then open the side panel directly at `chrome-extension://<id>/sidepanel.html` while a YouTube watch tab is active.
- The in-product install reminder on the public site is titled `Install for Chrome` and offers `Get sidebar`. The site states that Annotated is not on the Chrome Web Store.
- Inside the panel, `Create` is the connected-page view. Choose `Video` or `Audio` when the source supports it.

## Driving it with verify-annotated

Preconditions:

- `pnpm --dir apps/extension run build` has written `apps/extension/.output/chrome-mv3`, or `VERIFY_ANNOTATED_EXTENSION_DIR` points at that unpacked directory.
- `launch` and `doctor` are not required. A website session does not open the panel.
- Do not click `Publish clip`.

- **Load and drive Create.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive chrome-extension`. Playwright Chromium launches with `--load-extension`. Headless mode is tried first; if the extension service worker does not start, the drive retries under Xvfb. The command resolves the 32-character extension id, opens the YouTube watch page `https://www.youtube.com/watch?v=aqz-KE-bpKQ`, then opens `chrome-extension://<id>/sidepanel.html`. The YouTube tab stays in front so surf-follow keeps that tab as the connected source. Panel actions run in the side panel document, and that tab stays unfocused.
- **Presets and drag.** `30s` must produce a 30-second span and `60s` a 60-second span. Dragging the end handle past 90 seconds must leave a span of at most 90 seconds and at least 1 second. The readout uses an en dash. Inputs named START or END, other than the `Clip start` and `Clip end` range handles, fail the proof.
- **Publish gate.** With no valid range, or without commentary, Publish clip must not be enabled. After a valid range and commentary, Publish clip is enabled only when the panel is signed in and a player is selected. This drive stays signed out, so the button is absent and the proof records that. The drive does not click it and does not mint a session.
- **Audio, when the fixture connects.** A local page with an `<audio>` element and podcast metadata is opened after YouTube. The same trim checks run. If Audio Create never becomes ready, the notes say `audio: unavailable` and the YouTube result still stands.

Exit 0 is a pass. Exit 1 is a failure, including a missing build. The command does not exit 3.

## Gotchas

- Keep the source tab active. Focusing `sidepanel.html` makes surf-follow retarget the extension URL, and Create loses the player.
- A YouTube player that never becomes visible fails the drive. Do not substitute a different page for the YouTube check.
- When that watch page shows a player but attaches no media source, the drive inserts a sample video on the same tab so the trim checks have a duration longer than 90 seconds. Notes then say `YouTube player: sample`. That is still a pass.
- The 90-second ceiling is enforced by the clip handles. A drag that lands longer than 90 seconds is a product failure.
- Publishing is a real write. This drive must stop before `Publish clip`.
- Browser restart cannot recover an in-memory recording. This skill does not try.
- No Chrome Web Store listing is part of this map. Do not invent a store URL.
