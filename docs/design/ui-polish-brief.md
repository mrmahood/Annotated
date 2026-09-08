# UI polish design brief

Status: **owner-approved design brief**. Sprint 1 (tokens, switch, cards)
and Sprint 2 (YouTube `/watch` hover linking) are implemented and
owner-accepted on `main`. Sprint 3 (article/text selection hover) is
implemented on `main`. Sprint 4 (audio/podcast hover linking) is
implemented pending owner Chrome acceptance. Sprint 5 (generic
page-video hover linking) is implemented pending owner Chrome
acceptance. Sprint 6 (TikTok hosted capture/publish + hover) is
implemented on `main` (squash-merged PR #78) pending owner Chrome
and Staging acceptance. After TikTok Sprint 6, Spotify podcast /
episode audio capture + hover is implemented on `main`
(`docs/product/spotify-episode-capture.md`); the hover promo/outline
fix is PR #90. Typed clip range entry
(type start/end such as `1:00`–`2:30` in addition to Set start /
Set end) is a separate Create UX follow-on; it is implemented on
`main`. Fox / Brightcove / proprietary cross-origin news-site embeds
are tabled indefinitely (Phase G / later-horizon) and are not a
bounty blocker. Approving the polish sections does not authorize
Staging apply, Production, or Phase G. X OAuth Staging re-enable is a separate
owner-authorized increment (`docs/product/x-oauth-staging-reenable.md`).

Baseline: protected `main` after Sprint 2 PR #61 (2026-09-05), with
Phase F F0–F5, F6 Staging acceptance, and 2026-09-07/08 media-worker
Storage cleanup-to-zero already recorded. Sequence:
polish after Phase F, before X re-enable and the mid-September bounty
submit. Sprint 1 and Sprint 2 of that polish are done. Production has
not been accessed. Worker schedules remain paused.

This brief is subordinate to durable security and media rules in `AGENTS.md`
and `docs/architecture/media-archive-pipeline.md`. Product sequencing follows
`docs/product/roadmap.md`. Existing Create-mode, capture, draft, and
publication behavior stays as shipped in Phase E unless a later
implementation PR is explicitly authorized to change it.

## 1. Purpose and non-goals

### 1.1 Purpose

Define one card language and one quiet visual system, then specify the
remaining hover-link follow-ons:

- dark-first design tokens for the extension sidepanel and the public web
  annotation-card surfaces (Sprint 1, **done**);
- replace the Create-mode radio cards with a sliding segmented control
  (Sprint 1, **done**);
- restack Feed and web annotation cards as nested, commentary-led threads
  (Sprint 1, **done**);
- YouTube `/watch` hover linking (Sprint 2, **done**);
- article / text selection hover linking (Sprint 3, **done**);
- audio / podcast hover linking (Sprint 4, **implemented**; owner Chrome
  acceptance still required);
- generic page-video hover linking (Sprint 5, **implemented**; owner
  Chrome acceptance still required). YouTube `/watch` remains Sprint 2;
- TikTok hosted capture, Feed Video/TikTok cards, and hover (Sprint 6,
  **implemented** on `main` via PR #78; owner Chrome and Staging
  acceptance still required);
- after Sprint 6, Spotify podcast / episode audio capture + hover
  (implemented on `main`; hover promo/outline fix PR #90; see
  `docs/product/spotify-episode-capture.md`).

The annotation is the product; chrome gets out of the way.

### 1.2 Non-goals (this brief’s implementation slices)

- `/ops` operator console and any broad admin UI.
- X OAuth re-enable inside a polish sprint (it is a separate
  owner-authorized increment; see
  `docs/product/x-oauth-staging-reenable.md`).
- Production / Phase G styling or launch work.
- User-selectable accent-color picker or accent presets.
- Rebuilding Feed information architecture beyond the card nest.
- Multi-operator admin UI or claimant email.
- Hover linking in Sprint 1 (historical; Sprint 2 shipped YouTube only).
- Persistent content scripts, diagnostic UI, or host-specific shadow-DOM
  piercing in any hover sprint. `host_permissions` were later
  owner-authorized on 2026-09-05 for Open source amber apply and
  surf-follow; see §5.3.
- Forcing a shared-package extract of card components unless the monorepo
  already makes that extract natural.

## 2. Locked owner decisions

These decisions are approved by the owner and must not be silently
reinterpreted in implementation:

1. **Surfaces.** First polish covers the extension sidepanel and public web
   annotation cards in the **same pass**. One card language, two surfaces.
2. **Sprint split.** Sprint 1 is tokens (dark-first), the Create-mode
   segmented switch, and nested annotation cards (extension Feed + web).
   Sprint 2 is extension ↔ page hover linking (YouTube `/watch` only).
   Sprint 3 is article / text selection hover linking. Sprint 4 is
   audio / podcast hover linking. Sprint 5 is generic page-video hover
   linking (non-YouTube news/HTML5/embed chrome). Hover linking was
   **not** in Sprint 1. Sprint 1, Sprint 2, and Sprint 3 are **done**;
   Sprint 4 and Sprint 5 are implemented and wait on owner Chrome
   acceptance. Sprint 6 is TikTok hosted watch (YouTube-parallel
   identity, not article/webpage-video), implemented on `main` via
   PR #78. After TikTok Sprint 6, Spotify podcast / episode audio
   is the next platform follow-on (roadmap only). Sprint 2 remains
   YouTube `/watch` only.
3. **Demo path.** Primary judge demo path is **YouTube video annotations in
   the extension**.
4. **Copy and marks.** No existing fonts, logo mark, or copy is sacred.
   Full permission to simplify.
5. **Theme.** Dark-first for Sprint 1 tokens. Light theme and “follow
   system” are later options; do not implement them in Sprint 1 unless
   trivial token hooks. No user-selectable accent presets for the bounty;
   one locked quiet accent. Accent presets may later ride a settings surface
   with the light/system toggle, after submit.
6. **Create switch.** A true three-mode segmented control (Text | Video |
   Audio), not a binary cycling toggle. Preserve the existing create-mode
   selection, capability, and draft state machine; this is a visual and
   interaction skin unless a tiny accessibility affordance is required.
7. **Cards.** Creator first, then commentary as the visual lead, then source
   nested below like a quoted reply. Expand is in-card preview. **Open
   source** is always visible and jumps out. Do both.
8. **Motion.** Under ~200 ms, ease-out, purposeful. No bounce theater.

## 3. North star

Minimalist brush inspired by calm modern AI tooling: quiet chrome,
less-is-more. Pin line: **“The annotation is the product; chrome gets out
of the way.”**

- Quiet surfaces, soft borders, generous sidepanel negative space.
- Body type for human words. Mono only for timestamps and technical crumbs.
- Strip self-explaining section labels where hierarchy can do the work
  (for example, avoid redundant “Commentary” / “Clip” labels when structure
  is already clear).
- Near-monochrome plus **one quiet accent**, used sparingly for selected and
  linked states. Not a rainbow per media type.
- Motion under ~200 ms, ease-out, purposeful.

## 4. Theme and tokens (Sprint 1)

### 4.1 Dark-first

Sprint 1 ships a dark-first token set and applies it consistently on the
extension sidepanel and the web card surfaces touched by the implementation
PR(s). Existing `:root` custom properties in
`apps/extension/entrypoints/sidepanel/style.css` and
`apps/web/src/app/globals.css` are already dark; Sprint 1 may refine,
rename, and add tokens (including the locked quiet accent and motion
values). It need not preserve current hex values, radii, or typefaces.

Light theme and “follow system” are planned follow-ons. Document token
hooks if they are trivial (for example, a later `[data-theme]` or
`color-scheme` switch). Do not ship a light theme, system follower, or
settings toggle in Sprint 1.

### 4.2 Accent

One locked quiet accent for selected and linked states. No user-selectable
accent presets for the bounty. Implementation chooses a single restrained
value in tokens; it must not color-code Text / Video / Audio as distinct
brand hues.

Accent presets may later appear on a settings surface together with the
light/system theme toggle, after bounty submit. That surface is out of
scope here.

### 4.3 Type

Replace or simplify current type freely (extension Inter, web Geist, and
the `[Annotated]` wordmark treatment are not protected). Human copy —
commentary, titles, display names, help — uses body type. Mono is reserved
for timestamps, clip ranges, handles if treated as crumbs, and other
technical metadata.

### 4.4 Motion tokens

Prefer CSS custom properties for duration and easing (target under 200 ms,
ease-out). Use them for the segmented thumb, create-panel crossfade, and
later hover-link fades. No spring/bounce presets.

## 5. Verified current-state inventory

### 5.1 Create-mode switch

- Modes remain `text | video | audio` in
  `apps/extension/utils/create-mode.ts`.
- The Create surface renders three bordered radio cards
  (`.create-mode-option`) with a radio, short label, and per-card
  Available / Unavailable / Recommended / Checking / Draft-saved line
  (`apps/extension/entrypoints/sidepanel/App.tsx`, styles in
  `apps/extension/entrypoints/sidepanel/style.css`).
- A shared status line (`.create-mode-status`, `role="status"`) already
  exists below the cards.
- Mode switching is guarded by `apps/extension/utils/operation-guards.ts`.
  An in-flight hosted range requires `confirm-cancel` before abandoning
  capture/upload. The confirm UI is the mode-switch dialog in `App.tsx`.
- Independent per-mode drafts, recommended vs selected vs available, and
  honest restart/recovery are Phase E behavior and stay.
- Hosted Video / Audio range entry is **Set start** / **Set end** at
  the current playback position, plus typed start and end fields
  (`m:ss` / `h:mm:ss`, e.g. `1:00`–`2:30`) that validate 1–90 s and
  clip bounds and stay in sync with the buttons. See
  `docs/product/roadmap.md`.

### 5.2 Annotation cards

- Extension Feed card:
  `AnnotationCard` in
  `apps/extension/entrypoints/sidepanel/social-components.tsx`
  (`.social-card`). Order today is creator row, then a single button that
  stacks source kicker, title, passage/clip, then commentary. Footer has
  comments and an original-source link. The whole main block navigates to
  detail.
- Public web card: `apps/web/src/app/annotation-card.tsx` (`.annotation-card`
  in `apps/web/src/app/globals.css`). Order today is creator, then source
  block with section labels, then passage or “Clip” range, then
  “Commentary,” then footer actions including “View annotation” and
  YouTube / episode / original-source links. Used on the discovery feed
  (`apps/web/src/app/page.tsx`) and profile
  (`apps/web/src/app/p/[profileId]/page.tsx`).
- YouTube jump URLs already go through
  `getYouTubeTimestampUrl` in `packages/shared`. Keep using that helper.
- Detail routes remain for share and deep link; this brief does not replace
  them with in-feed expand.

### 5.3 Permissions relevant to hover linking (Sprint 2–5)

Owner override, 2026-09-05 (Matt): production permissions now include
`tabs` plus `host_permissions` for `http://*/*` and `https://*/*`, in
addition to `sidePanel`, `activeTab`, `storage`, `scripting`, `identity`,
`tabCapture`, and `offscreen`. This is an explicit replacement of the
earlier “no `host_permissions`” rule. The grant exists so:

1. Feed **Open source** can `executeScript` the amber article highlight
   after the opened tab reaches `status === 'complete'`, without a later
   toolbar-icon click. Amber is the source of truth; a text fragment is
   optional.
2. Keeping the side panel open while surfing can follow the active tab
   (`tabs.onActivated` / `tabs.onUpdated`) so Create, on-this-source, and
   article/YouTube hover connections stay current without re-clicking the
   action icon.

Do not add persistent content scripts, `defineContentScript` entrypoints,
or diagnostic UI. Hover and Open source still use one-shot
`scripting.executeScript` only. Capture, `tabCapture`, and auth stay on
their existing boundaries. Fail closed on passage match failure (miss
UI). Historical Sprint 2–3 slices shipped under `activeTab` only; this
override is what makes Open source amber and surf-follow reliable.

## 6. Sprint 1 — tokens, switch, cards

Sprint 1 is implemented and owner-accepted (PR #56). The slices below
remain the Sprint 1 contract.

### 6.1 Design tokens

Apply the dark-first token set across the extension sidepanel and the web
card surfaces the PR(s) touch. Quiet surfaces, soft borders, generous
sidepanel padding. One quiet accent for selected (and, later, linked)
states. Unify visual language; do not require a shared CSS package in
Sprint 1 if parallel token files are clearer.

Public site chrome outside the card (global nav, account, claims form,
detail page layout) is not a restyle target except where a shared token
rename would otherwise regress it. Acceptance forbids public nav chrome
regressions.

### 6.2 Create media switch

Replace the three bordered radio cards with **one sliding segmented
control**: Text | Video | Audio (icon + short label).

- Selected = a filled thumb that slides under the active segment.
- Unavailable = muted and non-interactive.
- Reason, recommended mode, draft-saved, and checking copy live in **one
  status line below** the control, not as per-segment secondary lines.
- Checking = a subtle shimmer on that segment only.
- “Haptic” delight = a short CSS crossfade of the create panel plus soft
  thumb motion. Optional `navigator.vibrate` only where the browser
  allows; desktop may be silent.
- Keep the existing cancel-capture confirm when a hosted range is in
  flight; restyle that dialog quieter to match tokens. Do not remove the
  guard.
- Do **not** use a binary cycling toggle. Three modes need a true
  segmented control.
- Preserve `chooseCreateMode` / capability / draft / `confirm-cancel`
  behavior. Keyboard: a `radiogroup` or equivalent segmented pattern
  (arrow keys between segments, disabled segments skipped). Visible
  focus ring from the token set.

Likely files (guidance, not a file lock):
`apps/extension/entrypoints/sidepanel/App.tsx`,
`apps/extension/entrypoints/sidepanel/style.css`, existing Create-mode
tests under `apps/extension`. Do not change
`apps/extension/utils/create-mode.ts` or
`apps/extension/utils/operation-guards.ts` unless a tiny accessibility
affordance requires it.

### 6.3 Annotation cards — email-thread nesting

Same hierarchy in the extension Feed and on public web cards.

Priority: (1) who created, (2) what they annotated / source media, (3) what
they said — with **commentary as the visual lead** after the creator row,
and source nested below like a quoted reply.

Proposed stack:

1. **Creator row** — avatar + display name + relative (or compact) time.
2. **Commentary lead** — the take, about 2–4 lines. No “Commentary” label.
3. **Nested source block** — indented / softer surface:
   - Media chip (video clip / text passage / audio) + source title + host.
   - Collapsed by default.
   - Click the block **body** → expand **in card**: larger player, fuller
     passage, longer audio scrubber, and optional transcript peek when
     those assets exist.
   - Always-visible one-line **Open source** control. YouTube uses the
     timestamp URL via `getYouTubeTimestampUrl`. Expand = preview; Open
     source = jump. Do both.

Rules:

- Only render expand targets for media that **exist** for that annotation.
  No empty video, audio, or text expanders.
- Feed stays skim-first. Detail routes remain for share and deep link.
  In-feed expand must not become the only way to read an annotation.
- Align extension `social-components` `AnnotationCard` and web
  `annotation-card.tsx` to this hierarchy (shared visual language). Share
  components across packages only if that extract is already easy; do not
  force a risky cross-package move in Sprint 1.
- Strip redundant section labels (“Commentary”, “Clip”, “YouTube video”)
  when the nested chip and hierarchy already identify the source.
- Existing comment counts and “view annotation” / detail navigation may
  remain as quiet secondary actions; they are not the visual lead.

## 7. Sprint 2 — YouTube hover linking (implemented)

Sprint 2 is implemented and owner-accepted (PR #61). YouTube `/watch` only
was intentional. Article/text and audio/podcast hover linking are Sprint 3
and Sprint 4 below.

When the connected tab is the annotation’s YouTube `/watch` source,
hovering card regions paints the page target:

- Commentary or card hover → soft ring on the matched player (or wrapper).
- Nested media chip → same target, slightly stronger.
- Expanded transcript line → seek and highlight that time window when
  feasible.

Visual grammar: outline plus **light page dim** (~8–12% on non-target
chrome) where safe. Debounce leave ~120 ms. When many annotations share
one player, prefer a **time-range** overlay on the scrubber rather than
stacked rings.

Known constraint: YouTube shadow DOM and fullscreen may mean the highlight
lands on an injected wrapper rather than native player chrome. Sprint 2
documented that limitation and used light-DOM best-effort; do not chase a
brittle piercing of YouTube internals.

Sprint 2 originally shipped under `activeTab` / `scripting` with no
`host_permissions`. The 2026-09-05 owner override now lets YouTube hover
use the surf-followed tab context the same way article hover does. Still
no persistent content scripts. Fail closed when the tab is not the watch
source.

## 8. Sprint 3 / Sprint 4 — article and audio hover linking

These slices reuse Sprint 2 visual grammar and the same permission model.
Sprint 3 is implemented on `main`. Sprint 4 is implemented pending owner
Chrome acceptance. Owner authorization for Sprint 4 (2026-09-05, after
#73): hover over an Audio card should scroll to and highlight the audio
player on the annotation’s source page, just like text and video.

### 8.1 Shared grammar and permissions

- Outline plus light page dim (~8–12% on non-target chrome) where safe.
- Debounce leave ~120 ms.
- Nested media chip may use a slightly stronger ring than commentary/card
  hover.
- Fail closed when the connected tab is not that annotation’s source page,
  when identity cannot be confirmed, or when scripting fails.
- Production permissions follow §5.3: `host_permissions` and `tabs` are
  owner-authorized for Open source amber and surf-follow. Still no
  persistent content scripts, no diagnostic UI. On-demand `scripting`
  against the live surf-followed tab only.
- The YouTube shadow-DOM limitation does not apply the same way to article
  ranges or typical audio players. Still fail closed and avoid brittle
  host-specific piercing of player or page internals.

### 8.2 Sprint 3 — article / text selection hover linking (implemented)

When the connected tab is the annotation’s article source, hovering
card/commentary paints the matched text range (or a safe wrapper) with the
shared outline + dim. Prefer a range highlight or a non-destructive wrapper
over rewriting page content. If the passage cannot be matched safely, do
nothing. Open source writes a pending amber target and applies it when the
surf-followed tab finishes loading.

### 8.3 Sprint 4 — audio / podcast hover linking (implemented)

When the connected / surf-followed tab is the annotation’s podcast/audio
source page (normalized URL + `source_type = podcast`), hovering the Audio
card, nested chip, or commentary:

- scrolls the page so the active / primary audio player (or its visible
  scrubber/chrome) is in view;
- paints that player with the shared outline + light page dim;
- prefers one time-range overlay on a visible scrubber when clip start/end
  and a safe duration are known. If a range overlay is not possible, the
  player chrome is still highlighted and scrolled.

Identity uses `(normalized_url, source_type)` so a page that also has an
article annotation does not steal audio hover. Soft hover never seeks or
plays the host player. Nested chip uses the stronger ring. Leave debounce
is ~120 ms; Open source / idle clear uses the same long TTL pattern as
article hover so a 120 ms leave cannot flash-clear a just-applied
highlight.

Open source from an Audio card writes `annotatedAudioHoverPending` and
applies scroll + highlight when the opened or already-connected tab is
ready. Player targeting is generic (`<audio>`, audio-only `<video>`,
visible player chrome / scrubber / play control). Fail closed when the tab
is not that annotation’s audio source, identity cannot be confirmed, no
safe player target exists, or scripting fails. No persistent content
scripts, no diagnostic UI, no host-specific piercing.

### 8.4 Sprint 5 — generic page-video hover linking (implemented)

Owner authorization (2026-09-05), after Sprint 4 audio hover
scroll+highlight was verified: hover/scroll is **not** locked across all
video players. Sprint 2 remains YouTube `/watch` only. Matt then
authorized generic page-video hover for non-YouTube source pages (news
players, HTML5 `<video>`, common embed chrome — e.g. Fox News
article/video pages).

When the connected / surf-followed tab is the annotation’s non-YouTube
video source page, hovering the Video card, nested chip, or commentary:

- scrolls the page so the active / primary video player (or visible
  player chrome / scrubber) is in view;
- paints that player with the shared outline + light page dim;
- prefers one time-range overlay on a visible scrubber when clip
  start/end and a safe duration are known. Otherwise still scroll + ring
  the player chrome.

YouTube `/watch` annotations stay on the dedicated Sprint 2
`youtubeHover` path. Sprint 5 never replaces that path. Identity uses
`(normalized_url, source_type)` plus Feed `kind` so a page that also has
article and/or podcast annotations does not steal or lose those hovers.
Soft hover never seeks or plays the host player. Nested chip uses the
stronger ring. Leave debounce is ~120 ms; Open source / idle clear uses
the same long TTL pattern as article/audio hover so leave cannot
flash-clear a just-applied highlight.

Open source from a webpage Video card writes
`annotatedPageVideoHoverPending` and applies scroll + highlight when the
opened or already-connected tab is ready. Player targeting is generic
(`<video>` with a visual frame, visible player chrome / play / scrubber,
common embed iframe chrome). Fail closed when the tab is not that
annotation’s video source, identity cannot be confirmed, no safe player
target exists, or scripting fails. No persistent content scripts, no
diagnostic UI, no Fox-only or host-specific selectors.

Feed projection: webpage video cards are `video_clip` rows whose source
identity is the article page (`source_type = article`), distinct from
YouTube `video_clip` + `youtube`. Generic webpage-video **hosted
publish** is implemented as an article-backed begin RPC plus Feed/detail
projection. Sprint 5 Chrome acceptance still needs a readable HTML5
fixture. Fox / Brightcove / proprietary cross-origin adapters are
tabled indefinitely (Phase G / later-horizon) and are not a bounty
blocker. Owner later concluded readable HTML5 webpage-video
is too rare for real demos; Sprint 6 is the TikTok watch path.

### 8.5 Sprint 6 — TikTok hosted capture, Feed cards, and hover (implemented)

Owner authorization (2026-09-05): lock Sprint 6 to TikTok hosted
capture/publish + hover. Do not force TikTok through
`source_type = article` or the webpage-video RPC.

Create → Video when the connected tab is a desktop TikTok watch URL
(`https://www.tiktok.com/@handle/video/<id>`; `m.` / `www.` variants
normalize to that). Capture uses the proven
`tabCapture → offscreen → MediaRecorder` path with `kind: 'tiktok'`.
`begin_hosted_tiktok_annotation` writes a draft `video_clip` on a
`tiktok` source, media `capture_pending`, then the same upload →
Processing → ready/published pipeline as YouTube. Feed/web project
`kind: tiktok` so cards stay distinct from YouTube and from webpage
`video_clip` + article. Uniqueness remains `(normalized_url, source_type)`.

When the connected tab is that watch URL, hovering a TikTok Video card
scrolls to and outlines/dims best-effort player chrome
(`[data-e2e="browse-video"]`, `[data-e2e="video-player"]`,
`#main-content-video_detail`, `.xgplayer`, or a visible `<video>`).
Soft hover must not re-seek or call `.play()`. Leave debounce is
~120 ms. Open source writes `annotatedTikTokHoverPending` (12 min TTL)
and applies on connection / surf-follow.

Known v1 limits — fail closed:

- login walls and region/age gates;
- For You / Following feeds without a stable `/@handle/video/<id>` URL;
- live rooms and photo posts;
- `vm.tiktok.com`, `vt.tiktok.com`, and `/t/` short links (no network
  resolve);
- DRM / encrypted playback;
- opaque player chrome when identity or a visible target cannot be
  confirmed;
- mobile-only surfaces.

Webpage HTML5 publish remains the niche article-backed path.
Fox / Brightcove / proprietary cross-origin news-site embeds are
tabled indefinitely (Phase G / later-horizon) and are not a
mid-September bounty blocker. No X OAuth.

### 8.6 After Sprint 6 — Spotify podcast / episode capture + hover

Implemented on `main` (hover promo/outline fix PR #90). First-class
`source_type = spotify`,
Create → Audio, Feed chip **Spotify**, and now-playing-bar hover.
Capture is tabCapture of what the connected tab can already play
(logged-in listen or a logged-out limited preview that is already
audible). Public playback is the hosted derivative, not a Spotify
embed. See `docs/product/spotify-episode-capture.md`. DRM /
stream-URL scraping stay out of scope. Fox / Brightcove /
proprietary cross-origin news-site embeds are tabled indefinitely
(Phase G / later-horizon), not the next platform after Spotify.

## 9. Acceptance criteria (Sprint 1)

- Dark tokens applied consistently in the extension sidepanel and the web
  card surfaces touched by the PR(s).
- Create mode uses the segmented control; unavailable modes are greyed;
  the status line explains unavailability (and recommended / draft /
  checking as needed); mode switch still respects draft and cancel guards.
- Feed and web cards show creator → commentary → nested source; **Open
  source** is always present; in-feed expand works only for available
  media types.
- No public nav chrome regressions.
- Accessibility: keyboard-operable switch; expanded regions announced
  reasonably (`aria-expanded` / live region as appropriate).
- Sprint 1 owner Chrome acceptance is recorded. Sprint 3 is implemented
  on `main`. Sprint 4 waits on owner Chrome verification of scroll +
  highlight on the source-page audio player. Sprint 5 waits on owner
  Chrome verification of generic page-video hover/scroll on a
  readable HTML5 webpage-video fixture, plus YouTube `/watch` and
  article/audio regression. Sprint 6 waits on owner Chrome
  verification of a public TikTok watch URL (prefer a news-publisher
  clip): Create Video → capture 1–90 s → publish → dispatcher
  one-shot if needed → Feed Video/TikTok card → hover
  scroll+outline on the TikTok tab, plus YouTube / NYT text/audio /
  webpage-video regression. Opaque Brightcove/Fox cross-origin
  players are tabled indefinitely (Phase G / later-horizon) and
  remain out of sprint scope unless they are already same-origin
  readable.

Sprint 1 and Sprint 2 owner Chrome acceptance are recorded. Automated
tests should cover Create-mode guards, card expand/collapse, and hover
wiring where behavior is deterministic; they do not replace owner review
of YouTube-in-extension as the primary demo path, or article/audio/page-
video hover on live source pages.

## 10. Out of scope and later options

Out of this brief’s implementation slices:

- `/ops` console (shipped separately as PR #91; not a polish sprint),
  Production / Phase G, user
  accent-color picker, broad admin UI. X OAuth Staging re-enable is a
  separate increment, not a polish sprint.
- Multi-operator admin UI, claimant email, rebuilding Feed IA beyond the
  card nest.
- Persistent content scripts, diagnostic UI, or brittle host-specific
  piercing for any hover sprint. `host_permissions` are owner-authorized
  only as documented in §5.3.
- Spotify Production apply or Cloud Run unpause. Staging apply for
  `20260906031846_begin_hosted_spotify_annotation` is owner-only.
- Typed clip range entry is implemented as a separate Create UX
  increment, not as part of the hover sprints.

Later options (not Sprint 1 unless noted):

- Light theme and follow-system, including a settings toggle.
- User accent presets on that same future settings surface, post-submit.

## 11. Authorization

Approving this document authorizes the polish slices described here.
Sprint 1, Sprint 2, and Sprint 3 are already implemented and accepted.
Sprint 4 and Sprint 5 are implemented pending owner Chrome acceptance.
Sprint 6 is implemented on `main` (PR #78) pending owner Chrome and
Staging acceptance. Spotify episode capture + hover is implemented
on `main` (hover promo/outline fix PR #90) pending owner Chrome and
Staging acceptance. Typed
start/end clip fields are a separate Create UX follow-on and are
not authorized here. Do not treat this brief as permission to
change capture, hosted-media publication, claims, or extension
permissions beyond the later owner-authorized webpage-video
publication increment and the owner-authorized Sprint 6 TikTok
increment. Brightcove / cross-origin adapters are tabled
indefinitely (Phase G / later-horizon) and remain out of Sprint
5 and Sprint 6 and the mid-September bounty submit.
