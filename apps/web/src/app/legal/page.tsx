import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_EFFECTIVE_ON,
  LEGAL_OPERATOR,
  LEGAL_PATHS,
} from "@/lib/legal";
import { LegalOperatorAddress, LegalOperatorLead } from "../legal-document";
import { SiteHeader } from "../site-header";

export const metadata: Metadata = {
  title: "Legal | Annotated",
  description: "Privacy Policy and Terms of Service for the Annotated public web app and Chrome extension.",
};

export default function LegalCenterPage() {
  return (
    <>
      <a className="skip-link" href="#legal-content">Skip to main content</a>
      <SiteHeader returnTo={LEGAL_PATHS.center} />
      <main className="legal-main" id="legal-content">
        <header className="legal-intro">
          <p className="eyebrow">LEGAL</p>
          <h1>Policies for Annotated</h1>
          <p className="lede">
            These policies apply to the Annotated public web application and the
            Chrome side-panel extension.
          </p>
          <ul className="legal-facts">
            <li>Free beta</li>
            <li>Ages 18+</li>
            <li>Effective {LEGAL_EFFECTIVE_ON}</li>
          </ul>
        </header>

        <div className="legal-index">
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

        <section className="legal-section" aria-labelledby="legal-using-heading">
          <h2 id="legal-using-heading">Using Annotated</h2>
          <p>
            Annotated runs as a public web app and as a Chrome side-panel
            extension. These policies apply to both.
          </p>
        </section>

        <section className="legal-section" aria-labelledby="legal-contact-heading">
          <h2 id="legal-contact-heading">Contact</h2>
          <p><LegalOperatorLead /></p>
          <LegalOperatorAddress />
          <p>
            Annotated is in beta. These policies describe the service as it is
            intended to operate at public launch and will be updated if its
            practices change.
          </p>
          <p>
            <a href={`mailto:${LEGAL_OPERATOR.email}`}>{LEGAL_OPERATOR.email}</a>
          </p>
        </section>
      </main>
    </>
  );
}
