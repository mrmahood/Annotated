# Spotify episode hosted capture

Status: implemented on this branch (Create/publish identity + hover).
Owner-authorized 2026-09-05/06. Staging-only migration. Do not touch
Production. Do not unpause Cloud Run schedules.

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
- DRM / stream-URL scraping is out of scope. The adapter fail-closes
  unless now-playing clocks are readable and the player is within 2 s
  of the requested start.

Hover on the now-playing bar is included in this increment (natural
audio/TikTok parallel).

## Fail-closed cases

Rejected as Spotify episode identity:

- Home, search, show-only (`/show/<id>`), login/signup walls
- `spotify.link`, `spotify:episode:`, `play.spotify.com`
- Unreadable now-playing time
- Player more than 2 seconds off the requested start (no brittle
  progress-bar seek)

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

Rebuild/reload the extension after pulling this branch.

1. Sign in to Spotify in Chrome.
2. Open a public episode, for example:
   `https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ`
   Variants that should classify the same: `?si=`, `/embed/`,
   `/intl-en/`.
3. Connect the tab. Create should classify **Spotify** (not generic
   webpage audio). Audio mode available; Video unavailable.
4. Play until now-playing clocks are readable. Set start / Set end or
   type times. Range must be 1–90 s.
5. **Seek Spotify to the clip start** before Publish. The adapter
   fail-closes if the player is more than 2 s off.
6. Publish → tabCapture → Processing. Draft stays draft until the
   worker finishes. Do not unpause Cloud Run; one-shot the dispatcher
   if needed.
7. Fail closed: home, search, show page, logged-out wall.
8. Hover: Feed card on a connected episode tab outlines the
   now-playing bar.

Never report Chrome acceptance as passed unless the owner performed it
and supplied the result.
