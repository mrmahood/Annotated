import type { ReactNode } from "react";
import {
  LEGAL_EFFECTIVE_ON,
  LEGAL_OPERATOR,
  LEGAL_UPDATED_ON,
  type LegalSectionNav,
} from "@/lib/legal";
import { JsonLd } from "./json-ld";
import { SiteHeader } from "./site-header";

export function LegalDocument({
  eyebrow,
  title,
  lede,
  returnTo,
  sections,
  structuredData = null,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  returnTo: string;
  sections: readonly LegalSectionNav[];
  structuredData?: Record<string, unknown> | null;
  children: ReactNode;
}) {
  return (
    <>
      <JsonLd data={structuredData} />
      <a className="skip-link" href="#legal-content">Skip to main content</a>
      <SiteHeader returnTo={returnTo} />
      <main className="legal-main" id="legal-content">
        <header className="legal-intro">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          <dl className="legal-dates">
            <div>
              <dt>Effective</dt>
              <dd><time dateTime="2026-08-30">{LEGAL_EFFECTIVE_ON}</time></dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd><time dateTime="2026-08-30">{LEGAL_UPDATED_ON}</time></dd>
            </div>
          </dl>
        </header>

        <nav className="legal-toc" aria-label="Contents">
          <h2>Contents</h2>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <span className="legal-toc-number">{section.number}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="legal-body">
          {children}
        </div>
      </main>
    </>
  );
}

export function LegalSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="legal-section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <span className="legal-section-number">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalOperatorAddress() {
  return (
    <address className="legal-address">
      <span>{LEGAL_OPERATOR.person}</span>
      <span>{LEGAL_OPERATOR.company}</span>
      <span>{LEGAL_OPERATOR.street}</span>
      <span>{LEGAL_OPERATOR.locality}</span>
      <span>{LEGAL_OPERATOR.country}</span>
      <a href={`mailto:${LEGAL_OPERATOR.email}`}>{LEGAL_OPERATOR.email}</a>
    </address>
  );
}

export function LegalOperatorLead() {
  return (
    <>
      Annotated is operated by {LEGAL_OPERATOR.person} through {LEGAL_OPERATOR.company},{" "}
      {LEGAL_OPERATOR.jurisdiction}.
    </>
  );
}

export function LegalMailto() {
  return <a href={`mailto:${LEGAL_OPERATOR.email}`}>{LEGAL_OPERATOR.email}</a>;
}
