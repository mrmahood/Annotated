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
- Public playback is Annotated's hosted derivative (same as
  YouTube / TikTok / podcast), **not** a live Spotify embed of the
  full episode. Annotated listeners do not need a Spotify login.
- DRM / stream-URL scraping is out of scope. Capture is only what
  the connected tab can already play. The adapter fail-closes unless
  now-playing clocks are readable and the player is within 2 s of the
  requested start.

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

1. Open a public episode, for example:
   `https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ`
   Variants that should classify the same: `?si=`, `/embed/`,
   `/intl-en/`.
2. **Logged-out preview (if Spotify offers one):** play until the
   tab is audible and now-playing clocks are readable. That is a
   valid capture surface. Do not require sign-in.
3. **Logged-in listen:** also valid. Connect the tab. Create should
   classify **Spotify** (not generic webpage audio). Audio mode
   available; Video unavailable.
4. Play until now-playing clocks are readable. Set start / Set end or
   type times. Range must be 1–90 s.
5. **Seek Spotify to the clip start** before Publish. The adapter
   fail-closes if the player is more than 2 s off.
6. Publish → tabCapture → Processing. Draft stays draft until the
   worker finishes. Public playback is the hosted derivative, not a
   Spotify embed. Do not unpause Cloud Run; one-shot the dispatcher
   if needed.
7. Fail closed: home, search, show page, a login wall that cannot
   play, DRM, unreadable time.
8. Hover: Feed card on a connected episode tab outlines the
   now-playing bar.

Never report Chrome acceptance as passed unless the owner performed it
and supplied the result.
