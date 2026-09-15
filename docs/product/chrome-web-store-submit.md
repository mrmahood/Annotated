# Chrome Web Store submit — first listing (`0.1.0`)

Owner walkthrough for the first Chrome Web Store upload. This does not
invent or link a live store URL. Until review approves a listing, the
public install path stays the Production zip:

```text
https://annotated.cbandcoop.com/extension.zip
```

Hosting that zip does **not** give auto-updates. Store users auto-update
only after a listing is approved. Staging stays load-unpacked.

Companion packaging and ID notes:
`docs/product/extension-release-versioning.md`. Announcement context:
`docs/product/launch-one-pager.md`. Screenshot drop folder:
`docs/product/chrome-web-store-assets/README.md`.

## Locked decisions for this submit

- First store version is **`0.1.0`**. WXT copies
  `apps/extension/package.json` `version` into `manifest.json`.
- Upload ZIP must be **Production-pinned**, same pins as
  `/extension.zip`:
  - Web: `https://annotated.cbandcoop.com`
  - Supabase: `https://vnxjktpdzmykmqrqwvks.supabase.co`
- Do **not** ship Staging (`annotated-staging.cbandcoop.com` or
  project `nkkunkwirvfwhmpwonqz`) as the runtime target.
- The store listing gets a **new extension ID** unless the owner
  recovers the locked Production PEM and Chrome still accepts it to
  claim the zip ID. Do **not** claim the uploaded zip ID will match
  the store ID. The zip ID
  `dgflcndninfbfgeachchbpjcdhnegcpp` is only guaranteed for
  Load-unpacked installs from `/extension.zip`.
- Privacy:
  `https://annotated.cbandcoop.com/privacy`
- Terms:
  `https://annotated.cbandcoop.com/terms`
- Age: **18+** (legal and marketing already say free beta, ages 18+).

## Pre-submit checklist

Stop at the first failure. Do not upload a Staging build.

### Developer account

1. Open [https://chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   in Chrome.
2. Sign in with the Google account that should own the listing
   (recommended: a mailbox you check; the address cannot be changed
   later without transferring the item).
3. If this is the first visit: accept the Chrome Web Store developer
   agreement and pay the one-time **$5** registration fee.
4. Complete any identity / contact fields the console asks for.
   Developer email for users: `matt@cbandcoop.com`.
5. Confirm you can see **Add new item**. If the fee page is still
   showing, stop — you are not registered yet.

### Assets (before you click Submit)

- [ ] Store icon 128×128 PNG (reuse
      `apps/extension/public/icon/128.png` after a visual check)
- [ ] At least **one** screenshot, 1280×800 (preferred) or 640×400,
      square corners, full bleed. Up to five. See the asset README.
- [ ] Small promo tile **440×280** (Chrome currently treats this as
      required for a complete listing)
- [ ] Optional marquee **1400×560**
- [ ] Privacy and Terms URLs above load in an anonymous window

### Privacy / remote code (console Privacy tab)

- [ ] Single-purpose statement pasted (below)
- [ ] Every permission justification pasted (below)
- [ ] Remote code: **No** (see below)
- [ ] Data-use checkboxes match the Privacy Policy
- [ ] Privacy policy URL set
- [ ] Content rating / age set to **18+**

### Package inspection

- [ ] Manifest `version` is `0.1.0`
- [ ] Manifest `name` is `Annotated`
- [ ] Permissions match the list in this doc
- [ ] No `content_scripts` key
- [ ] Built JS runtime target is Production, not Staging
- [ ] No service-role keys, PEMs, or signed URLs in the zip

## Exact permission justifications

Paste these into the Chrome Web Store **Privacy practices** permission
fields. They match the production manifest in `apps/extension/wxt.config.ts`:

`sidePanel`, `activeTab`, `storage`, `scripting`, `identity`,
`tabCapture`, `offscreen`, `tabs`, plus `host_permissions`
`http://*/*` and `https://*/*`.

There are no persistent content scripts. Capture is
`tabCapture → offscreen → MediaRecorder`. The extension does not
bypass DRM or paywalls and does not scrape full pages into Annotated.

### `sidePanel`

Annotated’s Create, Feed, and Me UI is a Chrome side panel. This
permission opens and owns that panel so the user can write a
source-linked note without covering the page they are annotating.

### `activeTab`

A toolbar or panel gesture binds the current tab as the connected
source. `activeTab` lets that user gesture grant short-lived access
to the tab the user invoked, including minting a `tabCapture` stream
ID in the same click turn. It is not used to read tabs the user has
not invoked.

### `storage`

`chrome.storage.local` holds the signed-in Supabase session and
appearance preference. `chrome.storage.session` holds in-progress
drafts, Create-mode selection, hosted-media operation IDs (never the
raw capture Blob), and pending Open-source highlight targets. Browser
restart cannot recover an in-memory Blob; storage only keeps safe
recovery identifiers.

### `scripting`

One-shot `chrome.scripting.executeScript` on the connected tab:

- read the user’s selected article passage;
- read player time and identity for a 1–90 second clip;
- paint a temporary amber outline / passage highlight when the user
  hovers a Feed card or clicks **Open source**.

Scripts are packaged with the extension. They are not injected on
every page at install time.

### `identity`

Google and X sign-in use `chrome.identity.getRedirectURL` and
`launchWebAuthFlow`. The callback is
`https://<extension-id>.chromiumapp.org/auth/callback`. Tokens stay
in extension storage; they are not logged. The extension ships only
the Supabase publishable key and the user session.

### `tabCapture`

Used only when the user starts a hosted video or audio capture of the
range they selected (1–90 seconds) on the connected tab. Chrome’s
`tabCapture.getMediaStreamId` records what that tab can already play.
It is not used for background recording of browsing.

### `offscreen`

Chrome requires an offscreen document to run `MediaRecorder` on the
tab-capture stream. That document is packaged with the extension, owns
the Blob, and uploads it to a server-issued private path. The complete
Blob is not routed through the side panel.

### `tabs`

Needed so an already-open side panel can follow the active tab
(surf-follow: `tabs.onActivated` / `tabs.onUpdated`) and so **Open
source** can apply the amber highlight when the opened tab finishes
loading. Also used to stop capture if that tab closes. The extension
does not collect or upload general browsing history.

### `host_permissions` — `http://*/*` and `https://*/*`

Reviewers scrutinize broad host access. This grant is **not** a
full-page scrape, a crawler, or a DRM/paywall bypass.

`activeTab` only covers the tab that invoked the extension. Two
product behaviors need a later, one-shot script on a tab the user
already chose, without a second toolbar click:

1. **Open source** opens the original article, video, or audio URL
   and must paint the amber highlight after that tab reaches
   `complete`.
2. **Surf-follow** keeps Create / on-this-source / hover bound to
   the visible http(s) tab while the side panel stays open.

Annotations can be created on ordinary web pages the user opens
(articles, YouTube, TikTok, Spotify, podcasts, readable HTML5 media).
A fixed host allowlist would break that. Scripts still run only as
one-shot `executeScript` on the connected or Open-source tab. No
persistent content script is installed on `http://*/*` or
`https://*/*`. Capture records only the selected excerpt from media
the tab can already play.

## Privacy tab — other fields

### Single purpose

> Let a signed-in adult create a source-linked annotation — a margin
> note on a selected article passage or a 1–90 second video/audio
> excerpt from the current Chrome tab — and publish it to Annotated
> with attribution and a link back to the original.

### Remote code

Select **No, I am not using remote code.**

All extension JavaScript is in the uploaded package (WXT/Vite bundle
plus the offscreen document). The extension calls the Production web
origin and Production Supabase as **HTTPS APIs** (auth, annotation
RPCs, short-lived upload authorization). That is network data, not
execution of remotely hosted scripts. Manifest V3 does not load
remote JS. There is no `eval` of fetched code.

If the console asks which hosts the extension talks to, list only
Production:

- `https://annotated.cbandcoop.com`
- `https://vnxjktpdzmykmqrqwvks.supabase.co`
- Identity-provider OAuth endpoints opened through `chrome.identity`
  (Google, and X when enabled)

Do not list Staging.

### Data use (must match the Privacy Policy)

Disclose, as applicable to the live product:

- Personally identifiable information (name/email from Google or X)
- Authentication information (session needed to stay signed in)
- User activity / user content (annotations, commentary, comments,
  follows, votes, optional voice commentary)
- Website content **limited to** the passage or 1–90 second excerpt
  the user selected, plus source URL/title needed for attribution

Do **not** claim location tracking, browsing-history collection,
full-page archives, or sale of user data. Certify limited use.
Policy: `https://annotated.cbandcoop.com/privacy`.

### Age

Complete the content-rating questionnaire as **18+**. Annotated is
not directed at children. Legal copy: minimum age is 18.

## Draft store listing copy

Use these in the **Store listing** tab. The manifest `name` /
`description` already match the short fields.

### Name

```text
Annotated
```

### Short description (132-character limit; 94 characters)

```text
Source-linked margin notes on articles, plus short video and audio clips from the current tab.
```

### Detailed description

```text
Annotated is a Chrome side panel for source-linked margin notes. You select a passage of text or a 1–90 second clip of video or audio on the page you already have open, add written or recorded commentary, and publish it with the original source still attached.

The public page keeps attribution and a link back to the original. Hosted clips stay private drafts until the excerpt is processed and the raw capture is deleted. There is no download button. Annotated does not bypass DRM or paywalls and does not record more than the range you selected.

What you can do
• Annotate article text from the current tab
• Capture a 1–90 second video or audio excerpt from media the tab can already play
• Add written or recorded commentary
• Open the original source with a temporary amber highlight on the matched passage or player
• Browse a public Feed of source-linked notes, then share or bookmark them on Annotated

Annotated is a free beta for ages 18 and older.

Companion web app: https://annotated.cbandcoop.com
Privacy Policy: https://annotated.cbandcoop.com/privacy
Terms of Service: https://annotated.cbandcoop.com/terms
```

### Category suggestion

**Productivity** (primary). Alternate if the console fits the social
slice better: **Social & Communication**.

### Other listing fields

| Field | Value |
| --- | --- |
| Language | English (United States) |
| Homepage | `https://annotated.cbandcoop.com` |
| Support | `matt@cbandcoop.com` or `https://annotated.cbandcoop.com/legal` |
| Privacy | `https://annotated.cbandcoop.com/privacy` |
| Official URL | leave empty until a store URL exists — do not invent one |

## Asset checklist

### Icons already in the repo

WXT packs these from `apps/extension/public/icon/`:

| File | Size |
| --- | --- |
| `apps/extension/public/icon/16.png` | 16×16 |
| `apps/extension/public/icon/32.png` | 32×32 |
| `apps/extension/public/icon/48.png` | 48×48 |
| `apps/extension/public/icon/96.png` | 96×96 |
| `apps/extension/public/icon/128.png` | 128×128 |

The store listing also wants a 128×128 PNG. Reuse `128.png` after
looking at it on light and dark backgrounds. Chrome’s image guide
prefers ~96×96 artwork with transparent padding inside 128×128.

### Screenshots the owner must capture

Do not invent binaries. Capture from **Production**
(`annotated.cbandcoop.com` + the Production-pinned extension), not
Staging. Filenames and sizes:
`docs/product/chrome-web-store-assets/README.md`.

Need at least one; five is better. 1280×800 preferred, or 640×400.
Square corners, no padding.

Suggested shots (actual UI, current product):

1. Side panel Create — Text, selected passage
2. Side panel Create — Video or Audio, 1–90s range
3. Side panel Feed with nested source cards
4. Public web annotation page (attribution + original link)
5. Open source amber highlight on the connected tab

### Promo tiles

| Asset | Size | Required? |
| --- | --- | --- |
| Small promo | 440×280 | Yes for a complete listing |
| Marquee promo | 1400×560 | Optional (needed only to be featured) |

Promo images are brand tiles, not extra screenshots. Avoid dense
text. No store URL on the tile.

## Build the Production upload ZIP

Same pins as `/extension.zip`. Do not use a Local or Staging
`.env.local` for this zip.

Preferred path (forces Production web + Supabase, same script as the
website zip):

```powershell
pnpm --dir apps/web run package:prod-extension-zip
```

That script always sets:

- `WXT_WEB_APP_URL=https://annotated.cbandcoop.com`
- `WXT_SUPABASE_URL=https://vnxjktpdzmykmqrqwvks.supabase.co`

It reads the Production **publishable** key from
`ANNOTATED_PROD_EXTENSION_PUBLISHABLE_KEY`, or from the web app’s
Production `NEXT_PUBLIC_SUPABASE_*` pair. It does not need the
private PEM. Never print the key.

Output to upload after a successful run:

```text
apps/web/public/extension.zip
```

That file is gitignored. WXT also writes under
`apps/extension/.output/` (zip name follows package `name` +
`version`, currently `annotated` / `0.1.0`). Prefer the
`package-prod-extension-zip` output because it re-asserts Production
pins.

Alternative, if you already have a Production-only
`apps/extension/.env.local` and do not want the website zip:

```powershell
pnpm --dir apps/extension run zip
```

Inspect before upload:

```powershell
Select-String -Path apps/extension/.output/chrome-mv3/manifest.json -Pattern '"version"|"name"|"description"'
```

Confirm `version` is `0.1.0`. Search the built JS for the Production
web origin and Production Supabase host. If you see
`annotated-staging.cbandcoop.com` used as the **runtime** web origin,
or `nkkunkwirvfwhmpwonqz.supabase.co` as the **runtime** Supabase
URL, discard the zip. (The Staging project ref may still appear as
an X-auth comparison constant; that is not the runtime target. See
`docs/product/extension-release-versioning.md`.)

The zip may include a public manifest `key` so Load-unpacked
`/extension.zip` keeps ID `dgflcndninfbfgeachchbpjcdhnegcpp`. The
Chrome Web Store strips `key` on upload. That does **not** assign
the store listing that ID.

### Extension ID and the Production PEM

The matching **private** key is not in git. If it exists, it is in
the owner password manager as `Annotated Production Chrome extension
PEM`. Do not paste or commit PEM contents.

- If the PEM is recovered **and** the current developer dashboard
  still lets a new item claim that keypair, the store ID might match
  the zip ID. Confirm in the console after upload. Do not assume it.
- Otherwise the listing receives a **new** store-assigned ID.

Unpacked Local/Staging, the public zip, and the store listing are
three different ID families until proven otherwise. After approval,
allowlist the **store** `chromiumapp.org` callback even if the zip
callback is already listed.

## Console walkthrough (Matt)

1. Finish the pre-submit checklist and build the Prod ZIP.
2. Open [https://chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole).
3. Click **Add new item**.
4. **Choose file** → the Production zip → **Upload**.
5. If Chrome rejects `0.0.0` or a non-increasing version, stop — this
   package must be `0.1.0`.
6. **Store listing:** paste name, short description, detailed
   description; set category, language, homepage, support; upload
   icon, screenshots, small promo.
7. **Privacy:** paste single purpose and each permission
   justification; remote code = No; data-use checkboxes; privacy URL.
8. **Distribution:** public, worldwide, unless you choose testers
   first. Age / content rating: 18+.
9. Record the **item ID** the console shows after upload. That is
   the candidate store ID. It is not automatically the zip ID.
10. Click **Submit for review**. Prefer **deferred publish**
    (uncheck “publish automatically”) so you can add the new
    `chromiumapp.org` callback before shoppers install from the
    store.
11. Stop. Do not invent a public store URL. Do not change the
    marketing Install CTA yet.

## After approval

Do these in order. Stop if the Supabase project ref is
`nkkunkwirvfwhmpwonqz`.

1. Copy the **approved store extension ID** from the developer
   dashboard (not from this repo’s zip ID unless they are proven
   identical).
2. **Supabase Production** (`vnxjktpdzmykmqrqwvks`) → Authentication
   → URL Configuration. Add:

   ```text
   https://<STORE_ID>.chromiumapp.org/auth/callback
   ```

   Optional wildcard:

   ```text
   https://<STORE_ID>.chromiumapp.org/**
   ```

   Keep the existing zip callback
   `https://dgflcndninfbfgeachchbpjcdhnegcpp.chromiumapp.org/auth/callback`
   for people still on Load unpacked from `/extension.zip`.
3. Google Cloud / X portal redirects stay on the Supabase vendor
   callback
   `https://vnxjktpdzmykmqrqwvks.supabase.co/auth/v1/callback`
   unless you later use a Chrome-application OAuth client directly.
4. Publish the listing if you deferred. Only then does a store URL
   exist.
5. Update the marketing Install CTA at
   `https://www.cbandcoop.com/Annotated` to the **live** store URL.
   Update the web install callout that currently says the product is
   not on the Chrome Web Store yet. Do not type a guessed URL.
6. Tag the git commit that produced the uploaded ZIP:

   ```powershell
   git tag extension-v0.1.0
   git push origin extension-v0.1.0
   ```

7. Keep
   `https://annotated.cbandcoop.com/extension.zip`
   until the store listing is live and you choose to retire the zip.
   The zip is not an auto-update channel.

## Explicit non-claims

- No Chrome Web Store URL is published in this repository.
- The upload zip ID is not promised to equal the store ID.
- Approval does not change Local/Staging Load-unpacked IDs.
- Auto-update starts only after the store listing is approved.
- This submit does not authorize Staging endpoints, PEM contents in
  git, remote code, DRM bypass, or a full-page scrape narrative.
