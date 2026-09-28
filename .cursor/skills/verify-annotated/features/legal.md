# Legal

Legal pages explain how Annotated handles privacy and the terms of use. They are public and do not require a session. The center links to the Privacy Policy and the Terms of Service. The same links sit in the footer nav named `Legal`.

## Sub-features

- `legal-center` opens `/legal` and shows `Policies for Annotated`.
- `legal-privacy` opens the Privacy Policy from the center and from the footer.
- `legal-terms` opens the Terms of Service from the center and from the footer.
- `legal-contact` shows the operator email `matt@cbandcoop.com` as a mailto link.

## How to get to it (user POV)

- Visit `/legal`, `/privacy`, or `/terms`.
- In the footer nav `Legal`, choose `Privacy`, `Terms`, or `Legal`.
- On `/legal`, choose `Read the Privacy Policy` or `Read the Terms of Service`.

## Driving it with verify-annotated

Preconditions:

- `verify-annotated doctor` prints `ready: yes`.
- No session is required.

- **Open the center.** Run `node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive legal`. The command visits `/legal`. The document title is `Legal | Annotated`. The heading `Policies for Annotated` is visible, including the facts `Free beta`, `Ages 18+`, and an effective date.
- **Open privacy.** The command chooses `Read the Privacy Policy`. The path is `/privacy`, the title is `Privacy Policy | Annotated`, and the heading `Privacy Policy` is visible. The contents nav includes `Who operates Annotated`.
- **Open terms.** The command then visits `/terms`. The title is `Terms of Service | Annotated` and the heading `Terms of Service` is visible. The contents nav includes `Agreement to the terms`.
- **Proof.** `loaded.png` is `/legal` before the privacy link. `result.png` is the Privacy Policy. `notes.md` records all three titles and paths. The Terms page is included in the ARIA snapshot file `terms.aria.txt`.

## Gotchas

- Footer links and the in-page buttons go to the same paths. Proving the center buttons does not by itself prove the footer. The footer nav `Legal` is asserted on `/legal` before navigation.
- These pages are static policy text. Do not treat a missing feed card as a legal failure.
- The effective date is part of the page (`August 30, 2026` at the time this map was written). If the product changes the date, update this map from the rendered page rather than from memory.
- Mailto links leave the browser's page. Do not activate them during the drive.
