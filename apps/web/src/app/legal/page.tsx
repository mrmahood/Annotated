import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock } from "../legal-document";
import { SiteHeader } from "../site-header";
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_OPERATOR_STATEMENT,
  LEGAL_PATHS,
  getConfiguredLegalPageUrl,
} from "@/lib/legal";

const title = "Legal | Annotated";
const description =
  "Legal center for Annotated: the Privacy Policy and Terms of Service for the Annotated public web app and Chrome side-panel extension.";

const canonical = getConfiguredLegalPageUrl(LEGAL_PATHS.index);

export const metadata: Metadata = {
  title,
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    type: "website",
    title,
    description,
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

const facts = ["Free beta", "Ages 18+", `Effective ${LEGAL_EFFECTIVE_DATE}`];

export default function LegalIndexPage() {
  return (
    <>
      <SiteHeader returnTo={LEGAL_PATHS.index} />
      <main id="main" className="legal-main">
        <header className="legal-intro">
          <p className="eyebrow">LEGAL</p>
          <h1>Legal center</h1>
          <p className="lede">
            Policies for the Annotated public web app and Chrome extension.
          </p>
        </header>

        <ul className="legal-facts">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>

        <div className="legal-index-grid">
          <article className="legal-index-card">
            <h2>Privacy Policy</h2>
            <p>How Annotated collects, uses, stores, shares, and protects information.</p>
            <Link className="button button-secondary" href={LEGAL_PATHS.privacy}>
              Read the Privacy Policy
            </Link>
          </article>
          <article className="legal-index-card">
            <h2>Terms of Service</h2>
            <p>The rules and responsibilities governing use of Annotated.</p>
            <Link className="button button-secondary" href={LEGAL_PATHS.terms}>
              Read the Terms of Service
            </Link>
          </article>
        </div>

        <section className="legal-index-card" aria-labelledby="product-heading">
          <h2 id="product-heading">Using Annotated</h2>
          <p>
            Annotated runs as a public web app and as a Chrome side-panel extension. These policies
            apply to both.
          </p>
        </section>

        <section className="legal-contact-section" aria-labelledby="contact-heading">
          <h2 id="contact-heading">Contact</h2>
          <p>{LEGAL_OPERATOR_STATEMENT}</p>
          <ContactBlock />
        </section>

        <p className="legal-note">
          Annotated is in beta. These policies describe the service as it is intended to operate at
          public launch and will be updated if its practices change.
        </p>
      </main>
    </>
  );
}
