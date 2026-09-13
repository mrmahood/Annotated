import type { ReactNode } from "react";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_LAST_UPDATED,
} from "@/lib/legal";

export function MailLink({ children }: { children?: ReactNode }) {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
      {children ?? LEGAL_CONTACT_EMAIL}
    </a>
  );
}

export function PolicyHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <header className="legal-intro">
      <p className="eyebrow">LEGAL</p>
      <h1>{title}</h1>
      <p className="lede">{intro}</p>
      <dl className="legal-dates">
        <div>
          <dt>Effective</dt>
          <dd>{LEGAL_EFFECTIVE_DATE}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{LEGAL_LAST_UPDATED}</dd>
        </div>
      </dl>
    </header>
  );
}

export function LegalSection({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="legal-section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <span className="legal-section-number">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      <div className="legal-section-body">{children}</div>
    </section>
  );
}

export function LegalToc({ items }: { items: { id: string; title: string }[] }) {
  return (
    <nav className="legal-toc" aria-label="Contents">
      <h2>Contents</h2>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            <span className="legal-toc-number">{String(index + 1).padStart(2, "0")}</span>
            <a href={`#${item.id}`}>{item.title}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ContactBlock() {
  return (
    <address className="legal-contact">
      Matt Mahood
      <br />
      The CB &amp; Cooper Limited Liability Company
      <br />
      120 Academy Street, Suite 102-105
      <br />
      Fort Mill, SC 29715
      <br />
      United States
      <br />
      <MailLink />
    </address>
  );
}
