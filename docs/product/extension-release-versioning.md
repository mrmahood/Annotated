# Chrome extension release and versioning

Operator note for shipping the Manifest V3 side panel. This does not
authorize a Production store submit; bumping the version and uploading
to the Chrome Web Store remain explicit owner steps.

## Canonical distribution

End users get auto-updates from the **Chrome Web Store**. That listing is
the only supported update channel.

The submit landing at `https://www.cbandcoop.com/Annotated` should link
the store listing once it is live. Do not treat a ZIP hosted on the
marketing site as an auto-update path.

## What does not auto-update

These installs stay on the files the operator loaded. Chrome will not
replace them from the store:

- Load unpacked (Local / Staging / any `.output/chrome-mv3` folder)
- A ZIP or CRX downloaded from the website or email

Unpacked and store installs also have different extension IDs. Do not
mix them when checking OAuth `chromiumapp.org` redirects.

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
- [ ] Optional: mirror a **dated** ZIP for reviewers or internal load-
      unpacked only, clearly labeled secondary (not the end-user install
      path)

## Website ZIP mirror

An optional CI or site mirror of a dated ZIP is fine for reviewers and
dev. It remains secondary. The primary CTA on the marketing landing stays
the Chrome Web Store listing. Hosting a ZIP does not give auto-updates.
