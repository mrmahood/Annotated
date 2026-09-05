# UI polish design brief

Status: **owner-approved design brief**. Sprint 1 (tokens, switch, cards)
and Sprint 2 (YouTube `/watch` hover linking) are implemented and
owner-accepted on `main`. Sprint 3 (article/text selection) and Sprint 4
(audio/podcast) hover linking are specify-only follow-ons in this
document. Approving those sections does not authorize application code,
migrations, Staging, Production, X OAuth re-enable, or Phase G.

Baseline: protected `main` after Sprint 2 PR #61 (2026-09-05), with
Phase F F0–F5 and F6 Staging acceptance already recorded. Sequence:
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
- article / text selection and audio / podcast hover linking (Sprint 3
  and Sprint 4, specify only).

The annotation is the product; chrome gets out of the way.

### 1.2 Non-goals (this brief’s implementation slices)

- `/ops` operator console and any broad admin UI.
- X OAuth re-enable.
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
   audio / podcast hover linking. Hover linking was **not** in Sprint 1.
   Sprint 1 and Sprint 2 are **done**; Sprint 3 and Sprint 4 remain
   separately authorized implementation slices.
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

### 5.3 Permissions relevant to hover linking (Sprint 2–4)

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

## 8. Sprint 3 / Sprint 4 — article and audio hover linking (specify only)

Do not implement in this docs change. These slices reuse Sprint 2 visual
grammar and the same permission model. They remain separately authorized.

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

### 8.2 Sprint 3 — article / text selection hover linking (extension)

When the connected tab is the annotation’s article source, hovering
card/commentary paints the matched text range (or a safe wrapper) with the
shared outline + dim. Prefer a range highlight or a non-destructive wrapper
over rewriting page content. If the passage cannot be matched safely, do
nothing.

### 8.3 Sprint 4 — audio / podcast hover linking (extension)

When the connected tab is the annotation’s audio/podcast source page,
hovering card/commentary paints the active player / scrubber range with the
same grammar. Prefer one time-range overlay on a visible scrubber when
several annotations share a player. If the player or range cannot be
identified safely, do nothing.

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
- Sprint 1 owner Chrome acceptance is recorded. Sprint 3 and Sprint 4
  stay specify-only until an implementation PR is separately authorized.

Sprint 1 and Sprint 2 owner Chrome acceptance are recorded. Automated
tests should cover Create-mode guards and card expand/collapse where
behavior is deterministic; they do not replace owner review of
YouTube-in-extension as the primary demo path, or later article/audio
hover slices.

## 10. Out of scope and later options

Out of this brief’s implementation slices:

- `/ops` console, X OAuth re-enable, Production / Phase G, user
  accent-color picker, broad admin UI.
- Multi-operator admin UI, claimant email, rebuilding Feed IA beyond the
  card nest.
- Persistent content scripts, diagnostic UI, or brittle host-specific
  piercing for any hover sprint. `host_permissions` are owner-authorized
  only as documented in §5.3.

Later options (not Sprint 1 unless noted):

- Light theme and follow-system, including a settings toggle.
- User accent presets on that same future settings surface, post-submit.
- Sprint 3 article/text and Sprint 4 audio/podcast hover linking, as
  specified in §8. Each still needs its own implementation authorization.

## 11. Authorization

Approving this document authorizes planning for remaining hover slices
only. Sprint 1 and Sprint 2 are already implemented and accepted. Sprint 3
and Sprint 4 each need their own owner-authorized implementation work. Do
not treat this brief as permission to change capture, hosted-media
publication, claims, or extension permissions.
