# Annotated — launch one-pager

Owner + social announcement context. Facts as of 2026-09-14; refreshed
2026-09-16. Do not invent a Chrome Web Store URL. Staging is not a
public demo.

## What Annotated is

Annotated is a Chrome side panel and public web app for commenting on a
passage of text or a short clip of video or audio, then publishing that
notation with the source still attached.

You pick a range — a sentence, a 1–90 second clip — write or record
commentary, and share it. The public page keeps attribution and a link
back to the original. Hosted media stays draft until the excerpt is
processed and the raw capture is gone. There is no download button and
no DRM or paywall bypass.

## What’s live now

- **Public web:** [https://annotated.cbandcoop.com](https://annotated.cbandcoop.com)
  (Vercel project `annotated`, DNS live)
- **Public Feed lede:** “Your media notations across video, podcasts &
  text shared with the world.” Eyebrow: PUBLIC ANNOTATIONS (no h1)
- **Create** in the Chrome side panel: Text, Video, and Audio on a
  connected tab
- **Google + X** sign-in on Production
- **Claim / rename username** on web `/me` and extension Me
- **Share, Bookmark, What’s Trending, Who to Follow** on Production
- **Feedback** (signed-in Me only): [Tally form](https://tally.so/r/1ALx44)
- **Legal:** [Privacy](https://annotated.cbandcoop.com/privacy) and
  [Terms](https://annotated.cbandcoop.com/terms)
- Production media-worker jobs and schedulers are **on** (after Create
  smoke). Staging schedulers stay paused.

## How to install today

Chrome Web Store submit has **not** happened. There is no store listing
and no auto-update yet.

1. Open [https://www.cbandcoop.com/Annotated](https://www.cbandcoop.com/Annotated)
   or download
   [https://annotated.cbandcoop.com/extension.zip](https://annotated.cbandcoop.com/extension.zip)
2. In Chrome: `chrome://extensions` → Developer mode → **Load unpacked**
   → select the unzipped folder
3. Pin the side panel and sign in with Google or X

The public zip uses pinned Chrome ID
`dgflcndninfbfgeachchbpjcdhnegcpp` so Production OAuth works from that
install. Load-unpacked from a Local/Staging build is a different ID.

The marketing page Install CTA still points at this zip path. The
install walkthrough, [How to Install the Annotated Chrome Extension](https://www.loom.com/share/65279b7ca270450cbf585ff25d75ea49),
is live on Loom and is the Walkthrough on
[https://www.cbandcoop.com/Annotated](https://www.cbandcoop.com/Annotated).

## Product highlights / story angles

- **Multimedia margin notes.** Not a full-source transcript or a
  download. A short, attributed comment on the exact excerpt.
- **Public Feed tied to sources.** Video, podcasts, and text share one
  discovery surface. Cards keep the original link.
- **Chrome sidebar Create.** Capture happens in the side panel on the
  tab you already have open. Hosted ranges are 1–90 seconds.
- **Social slice.** Share (in-ecosystem reshare), private Bookmark,
  What’s Trending, Who to Follow — live on Production.
- **Feedback from signed-in Me.** Tally form on web `/me` and extension
  Me only. Not a public footer dump.

## What’s next

- Chrome Web Store submit (auto-update after review). Bump
  `apps/extension/package.json` off `0.0.0` before the first upload.
  See `docs/product/extension-release-versioning.md`.
- Chrome notification when a clip is ready (queued)
- Staging demo rehearsal checklist
- Parked Create polish: multi-click Publish first-error; header-icon
  capture quirk; `raw_delete_unconfirmed` race

## Explicit non-goals / parked

- **Fox / Brightcove / proprietary cross-origin news-site embeds** —
  tabled indefinitely. Opaque players fail closed.
- **Navigate-away / zero-toolbar Recapture** — parked. A browser restart
  cannot recover an in-memory raw Blob; Recapture / Cancel stays honest.

## Key links

| What | URL |
| --- | --- |
| Production web | https://annotated.cbandcoop.com |
| Marketing / Install | https://www.cbandcoop.com/Annotated |
| Install walkthrough | https://www.loom.com/share/65279b7ca270450cbf585ff25d75ea49 |
| Extension zip | https://annotated.cbandcoop.com/extension.zip |
| Privacy | https://annotated.cbandcoop.com/privacy |
| Terms | https://annotated.cbandcoop.com/terms |
| Feedback (signed-in Me) | https://tally.so/r/1ALx44 |

Do not publish a Chrome Web Store URL. It does not exist yet.

## Owner note

**Staging** (`https://annotated-staging.cbandcoop.com`, Supabase
`nkkunkwirvfwhmpwonqz`) is locked behind Vercel Authentication (`all`).
Do not demo Staging publicly without SSO. Public story, screenshots, and
install CTAs use Production only (`vnxjktpdzmykmqrqwvks`). `/ops` is
allowlisted for owner profiles — not a public nav item.
