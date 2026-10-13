import type { Metadata } from "next";
import { SiteHeader } from "../site-header";
import { JsonLd } from "../json-ld";
import { getPublicPageStructuredData } from "@/lib/discoverability";
import { readExtensionPackageVersion } from "@/lib/extension-package-version";
import {
  EXTENSION_CHANGELOG,
  EXTENSION_DOWNLOAD_PATH,
  EXTENSION_UPDATE_GUIDE,
  WHATS_NEW_HEADING,
  WHATS_NEW_LEDE,
  WHATS_NEW_PATH,
} from "@/lib/extension-release";

export const dynamic = "force-static";

const extensionVersion = readExtensionPackageVersion();

export const metadata: Metadata = {
  title: "What's new | Annotated",
  description: WHATS_NEW_LEDE,
  alternates: { canonical: WHATS_NEW_PATH },
};

export default function WhatsNewPage() {
  return (
    <>
      <JsonLd data={getPublicPageStructuredData(WHATS_NEW_PATH)} />
      <a className="skip-link" href="#whats-new-content">Skip to main content</a>
      <SiteHeader returnTo={WHATS_NEW_PATH} />
      <main className="legal-main whats-new-main" id="whats-new-content">
        <header className="legal-intro">
          <p className="eyebrow">EXTENSION</p>
          <h1>{WHATS_NEW_HEADING}</h1>
          <p className="lede">{WHATS_NEW_LEDE}</p>
          <p className="whats-new-version">
            Current extension <strong>{extensionVersion}</strong>
          </p>
          <a
            className="button button-primary whats-new-download"
            href={EXTENSION_DOWNLOAD_PATH}
            download="extension.zip"
          >
            Download zip
          </a>
        </header>

        <section className="legal-section" aria-labelledby="whats-new-changelog">
          <h2 id="whats-new-changelog">Changelog</h2>
          {EXTENSION_CHANGELOG.map((release) => (
            <article className="whats-new-release" key={release.version}>
              <h3>{release.version}</h3>
              <ul>
                {release.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="legal-section" aria-labelledby="whats-new-update">
          <h2 id="whats-new-update">Update in 30 seconds</h2>
          <p>Use this when Annotated is already loaded unpacked. You do not sign in again.</p>
          <ol className="install-extension-steps whats-new-steps">
            {EXTENSION_UPDATE_GUIDE.map((step) => (
              <li key={step.text}>
                {step.text}
                {"code" in step && step.code ? (
                  <>
                    {" "}
                    <code>{step.code}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
