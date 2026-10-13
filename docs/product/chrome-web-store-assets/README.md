# Chrome Web Store listing assets

Screenshots are **1280×800**, square corners, full bleed. Walkthrough:
`docs/product/chrome-web-store-submit.md`. The store listing accepts
five. Privacy and Terms are listing URLs, not screenshots.

## Generated from public web pages

These are real pages, not placeholders. Regenerate them from Production
after `/whats-new` is deployed. Until that deploy, `screenshot-03` may
be captured from the local `/whats-new` page at 1280×800.

| Filename | Source |
| --- | --- |
| `screenshot-01-public-feed-1280x800.png` | `https://annotated.cbandcoop.com/` |
| `screenshot-02-public-annotation-1280x800.png` | A public annotation page on Production |
| `screenshot-03-whats-new-1280x800.png` | `/whats-new` |

## Side panel shots Matt still captures

Capture from the Production-pinned extension, not Staging. Do not invent
these files.

| Filename | Suggested content |
| --- | --- |
| `screenshot-04-create-text-1280x800.png` | Create → Text, selected passage |
| `screenshot-05-create-media-1280x800.png` | Create → Video or Audio, 1–90s range |

Optional if a slot is free later: side panel Feed, and the Open source
amber highlight on the connected tab.

## Promo tiles

| Filename | Size | Notes |
| --- | --- | --- |
| `promo-small-440x280.png` | 440×280 | Required for a complete listing. Matt supplies this brand tile. |
| `promo-marquee-1400x560.png` | 1400×560 | Optional; needed to be featured |

Promo tiles are brand images, not extra screenshots. Avoid dense text
and do not print a store URL.

## Icons already in the extension package

These ship in the upload ZIP. Reuse `128.png` as the store icon after
a visual check.

| File | Size |
| --- | --- |
| `apps/extension/public/icon/16.png` | 16×16 |
| `apps/extension/public/icon/32.png` | 32×32 |
| `apps/extension/public/icon/48.png` | 48×48 |
| `apps/extension/public/icon/96.png` | 96×96 |
| `apps/extension/public/icon/128.png` | 128×128 |
