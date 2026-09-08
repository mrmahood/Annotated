# Spotify episode hosted capture

Status: implemented on `main` (Create/publish identity + hover; hover
promo/outline fix PR #90). Owner Chrome and Staging acceptance remain
required. Owner-authorized 2026-09-05/06. Staging-only migration. Do not
touch Production. Do not unpause Cloud Run schedules.

## Product choice

First-class `source_type = 'spotify'` and
`begin_hosted_spotify_annotation`, **not** reuse of generic `podcast`.

Why this is the cleaner fit (TikTok Sprint 6 precedent):

- Distinct Feed card `kind: 'spotify'` (chip **Spotify**, not Audio).
- Stable episode URL identity:
  `https://open.spotify.com/episode/<22-char-id>`.
- Generic podcast/HTML5 audio stays on `begin_hosted_audio_annotation`
  and now **rejects** Spotify episode URLs.
- Spotify web player is opaque; it is not webpage `<audio>`.
- Annotation type remains `audio_clip`; media type `audio`; hosted
  player is the existing audio player.
- Capture uses the proven `tabCapture → offscreen → MediaRecorder`
  audio-only path (`kind: 'spotify'`).
- Public playback is Annotated's hosted derivative (same as
  YouTube / TikTok / podcast), **not** a live Spotify embed of the
  full episode. Annotated listeners do not need a Spotify login.
- DRM / stream-URL scraping is out of scope. Capture is only what
  the connected tab can already play. Preview / Jump and Publish
  drive the now-playing bar to the clip start, then fail closed
  unless clocks are readable and the playhead is within 2 s.

Hover on the now-playing bar is included in this increment (natural
audio/TikTok parallel).

## Product framing (owner, 2026-09-05 ET)

- A **logged-out limited preview** is a valid capture surface when
  that tab is already playing / audible. Login is not required.
- A **logged-in listener** can take up to the 90 s hosted ceiling so
  Annotated users can hear that snip with the annotation.
- Mechanism stays tabCapture of the connected tab. No stream-URL
  scraping, DRM piercing, or Spotify API download.
- Fail closed when the tab cannot play: true login / signup wall,
  DRM, missing episode identity, or unreadable time.

## Fail-closed cases

Rejected as Spotify episode identity or capture:

- Home, search, show-only (`/show/<id>`)
- True login/signup walls where the tab cannot play
- `spotify.link`, `spotify:episode:`, `play.spotify.com`
- Unreadable now-playing time
- Seek is impossible (no now-playing bar / slider, true DRM or
  login wall). After a successful seek the playhead must be within
  2 s of the requested start.

## Staging apply (owner only)

Project ref: `nkkunkwirvfwhmpwonqz`. Production is not authorized.

Migration:

`20260906031846_begin_hosted_spotify_annotation`

What it does:

- Extends `sources_source_type_check` with `'spotify'`
- Adds `begin_hosted_spotify_annotation(...)`
- Updates `begin_hosted_audio_annotation` to reject Spotify episode URLs

Owner applies Staging only (Dashboard SQL editor or linked CLI). Do
**not** run `supabase db reset --linked`. Do not apply to Production.

## Manual test notes (Matt)

Rebuild/reload the extension after pulling this branch. Chrome →
`chrome://extensions` → Annotated → Reload. Then reopen the side
panel on the episode tab.

1. Open the owner repro episode:
   `https://open.spotify.com/episode/6EMoFpxEsLelogfZz8eAC2`
   Logged-out free preview is valid. Leave the “Preview of Spotify…
   Sign up free” banner as-is. Press play until the tab is audible
   and Create shows **Using Spotify now playing**.
2. Set START `05:00` and END `06:00` (or `00:08`–`01:30`). Leave
   the Spotify bar wherever it is (for example ~`5:59`).
3. Click **Preview / Jump to start**. The now-playing playhead
   must move to the clip start (within ~2 s). It must not stay
   put. If seek is impossible, the red error must say
   **The Spotify player could not seek to the clip start.**
   — not a silent no-op.
4. Click **Publish clip** (or Recapture) while the playhead is
   away from start. Expected: the extension seeks, then
   tabCapture starts → upload → **Processing**. Do not require
   manual scrubbing.
5. Repeat once logged-in if you have a session. Same seek path.
6. Fail closed: home, search, show page, a login wall that cannot
   play, DRM, unreadable time. YouTube/TikTok/podcast Jump still
   uses the HTML5/player currentTime path.
7. Hover: Feed card on a connected episode tab outlines the
   now-playing bar.

Never report Chrome acceptance as passed unless the owner performed it
and supplied the result.
