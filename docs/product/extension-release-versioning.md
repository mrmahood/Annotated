# Chrome extension release and versioning

Operator note for shipping the Manifest V3 side panel. This does not
authorize a Production store submit; bumping the version and uploading
to the Chrome Web Store remain explicit owner steps. Public zip +
pinned ID are live on Production as of 2026-09-14; announcement
context: `docs/product/launch-one-pager.md`.

## Canonical distribution

The Chrome Web Store listing will be the auto-update channel once it
exists. That submit remains an explicit owner step. Do not invent or
link a store URL before it is live.

Until then, the public install path is a Production-flavored zip served
by the web app:

```text
https://annotated.cbandcoop.com/extension.zip
```

The Feed/shell install callout and modal download that path. Hosting a
ZIP does not give auto-updates. Load-unpacked installs stay on the files
the operator loaded.

The submit landing at `https://www.cbandcoop.com/Annotated` should link
the store listing once it is live. Until then it can point at the same
stable zip path. Do not treat the zip as an auto-update channel.

## What does not auto-update

These installs stay on the files the operator loaded. Chrome will not
replace them from the store:

- Load unpacked (Local / Staging / any `.output/chrome-mv3` folder)
- A ZIP or CRX downloaded from the website or email

Unpacked installs without a manifest `key`, the public Prod zip, and a
future Chrome Web Store listing have different extension IDs. Do not
mix path-based IDs with the pinned public-zip ID when checking OAuth
`chromiumapp.org` redirects.

## Versioning

WXT copies `apps/extension/package.json` `version` into the generated
`manifest.json`. Use semver there (`X.Y.Z`).

**Tech debt before first store submit:** that field is still `0.0.0`
(WXT starter). Chrome rejects a later upload that is not strictly greater
than a version already on the store, so do not ship `0.0.0`. Pick a real
first version (for example `0.1.0`) in a dedicated change; this note does
not bump it.

Rules:

- Every Chrome Web Store upload must bump the version. Chrome requires
  monotonically increasing versions; you cannot reuse or lower one.
- Tag the git commit that produced the uploaded build as
  `extension-vX.Y.Z`.

Do not bump the version on ordinary feature PRs. Bump only when preparing
a store build.

## Staging vs Production

Keep two builds. Do not ship Staging endpoints in the public store
package.

| | Staging (dev) | Production (store) |
| --- | --- | --- |
| Install | Load unpacked from `.output/chrome-mv3` | Chrome Web Store |
| Web origin | `https://annotated-staging.cbandcoop.com` | `https://annotated.cbandcoop.com` |
| Supabase | Staging project `nkkunkwirvfwhmpwonqz` | Production project only |
| Env file | `apps/extension/.env.local` (untracked) | Separate Prod `.env.local` for the store build |

Set `WXT_WEB_APP_URL`, `WXT_SUPABASE_URL`, and
`WXT_SUPABASE_PUBLISHABLE_KEY` to the matching target before building.
Inspect `apps/extension/.output/chrome-mv3/manifest.json` after a Prod
build. Confirm the version and that you did not build against Staging.

Rebuild and reload unpacked after env changes. A store user will not see
those files until a reviewed store release.

## Release checklist

Use this for a store ship. Stop at the first failure.

- [ ] Bump `apps/extension/package.json` `version` (semver; greater than
      every version already uploaded to the store)
- [ ] Point `apps/extension/.env.local` at Production
      (`WXT_WEB_APP_URL=https://annotated.cbandcoop.com`, Production
      Supabase URL and publishable key). Do not use Staging.
- [ ] Build the Prod extension:
      `pnpm --dir apps/extension run build`
      For an uploadable ZIP from the same WXT prod output:
      `pnpm --dir apps/extension run zip`
- [ ] Inspect `.output/chrome-mv3/manifest.json` (version, permissions,
      no extra diagnostic UI)
- [ ] Smoke on the Prod host (`annotated.cbandcoop.com`): sign-in, article
      publish, and one hosted capture path the owner cares about for this
      release
- [ ] Tag `extension-vX.Y.Z` on the commit that produced the ZIP
- [ ] Upload the ZIP to the Chrome Web Store and submit for review
- [ ] After approval: store users auto-update. Update the landing CTA at
      `https://www.cbandcoop.com/Annotated` if the store URL changed
- [ ] Optional: keep `https://annotated.cbandcoop.com/extension.zip` as a
      load-unpacked fallback, or retire it once the store listing is the
      only supported public install path

## Website ZIP (`/extension.zip`)

Stable public path: `https://annotated.cbandcoop.com/extension.zip`.

The zip is a Prod-flavored unpacked Chrome MV3 package (WXT `zip` of
`.output/chrome-mv3`). It is **not** committed. `scripts/package-prod-extension-zip.mjs`
builds it. The Production Vercel web build generates it:

```powershell
pnpm --dir apps/web run package:prod-extension-zip
```

`apps/web` `build` runs that script first, then `next build`. The
script always pins:

- `WXT_WEB_APP_URL=https://annotated.cbandcoop.com`
- `WXT_SUPABASE_URL=https://vnxjktpdzmykmqrqwvks.supabase.co`

It reads the Production publishable key from, in order:

1. `ANNOTATED_PROD_EXTENSION_PUBLISHABLE_KEY`
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` when `NEXT_PUBLIC_SUPABASE_URL`
   is the Production project
3. `WXT_SUPABASE_PUBLISHABLE_KEY` when `WXT_SUPABASE_URL` is the
   Production project

If those are missing, Local/CI/Staging builds skip the zip. A Production
web build (`NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_SUPABASE_URL` pointing
at Production) fails instead of shipping a 404 download.

After packaging, the script requires the inlined `WXT_SUPABASE_URL` and
`WXT_WEB_APP_URL` values to be Production. The Staging project ref
(`nkkunkwirvfwhmpwonqz`) may still appear as the X-auth capability
comparison constant; that is not treated as the runtime target.

The generated file is gitignored at `apps/web/public/extension.zip`.
Vercel serves it as a static asset. Reload unpacked after a new deploy
if you are testing a freshly downloaded zip.

### Pinned extension ID (public zip only)

Load-unpacked without a manifest `key` derives the Chrome extension ID
from the unzip path. Each downloader then gets a new
`https://<ID>.chromiumapp.org/auth/callback` and the Prod allowlist
misses it.

The Prod zip only bakes a stable public `key`. Ordinary Local / Staging
`wxt build` / Load unpacked stays path-based unless you set
`ANNOTATED_PROD_EXTENSION_PUBLIC_KEY` yourself.

Every Load-unpacked install from
`https://annotated.cbandcoop.com/extension.zip` must get this ID:

```text
dgflcndninfbfgeachchbpjcdhnegcpp
```

`chrome.identity.getRedirectURL('auth/callback')` is then always:

```text
https://dgflcndninfbfgeachchbpjcdhnegcpp.chromiumapp.org/auth/callback
```

Print that ID after `package:prod-extension-zip`, or run:

```powershell
node scripts/prod-extension-key.mjs
```

The public key (Chrome manifest `key` / base64 SPKI) is committed at
`apps/extension/prod-extension-public-key.txt`. It is not a secret.
Packaging injects it through `ANNOTATED_PROD_EXTENSION_PUBLIC_KEY` and
also writes `key` onto the chrome-mv3 `manifest.json` before zipping, so
two Prod zips compute the same ID. A Vercel/build env value of
`ANNOTATED_PROD_EXTENSION_PUBLIC_KEY` overrides the committed file; do
that only if you intend to change the public zip ID.

The matching **private** key is not in git. Store it in the owner
password manager as `Annotated Production Chrome extension PEM`. It is
not required to keep shipping this zip ID. It is only required later if
a Chrome Web Store upload must reuse this same ID. A store listing
otherwise receives a store-assigned ID and supersedes the zip as the
public install path. Do not invent or link a store URL before it is
live.

Do not mix these IDs when debugging OAuth:

- Path-based IDs from Local / Staging Load unpacked (no `key`)
- This pinned public-zip ID
- A future Chrome Web Store ID

### One-time Production allowlist

Do this once after the first pinned zip is the public download. Stop if
the Supabase project ref is `nkkunkwirvfwhmpwonqz`.

**Supabase Production** (`vnxjktpdzmykmqrqwvks`) → Authentication → URL
Configuration. Add:

| Purpose | URL |
| --- | --- |
| Prod zip Chrome identity | `https://dgflcndninfbfgeachchbpjcdhnegcpp.chromiumapp.org/auth/callback` |
| Optional wildcard | `https://dgflcndninfbfgeachchbpjcdhnegcpp.chromiumapp.org/**` |

**Google Cloud OAuth** authorized redirect URIs for the Production
Google provider used by Supabase stay the vendor callback. Google
returns to Supabase; Supabase returns to chromiumapp:

```text
https://vnxjktpdzmykmqrqwvks.supabase.co/auth/v1/callback
```

Do not add per-downloader chromiumapp URIs to Google Cloud. If a
Chrome-application OAuth client is later used directly with
`chrome.identity`, add the same pinned callback.

**X** uses the same `chrome.identity` callback. If Production X is
enabled for the zip-installed extension, allowlist that same
chromiumapp URL in Supabase Production. The X portal still uses the
Supabase vendor callback, not chromiumapp.

### Rotating the Prod zip keypair

Do not regenerate the keypair to refresh an ordinary zip. A new
keypair changes the public zip ID and needs a new allowlist.

```powershell
node scripts/generate-prod-extension-keypair.mjs --private-key-out $HOME/annotated-prod-extension.pem --public-key-out apps/extension/prod-extension-public-key.txt
```

Store the new PEM in the password manager. Commit only the public key
file. Never commit `*.pem`.
