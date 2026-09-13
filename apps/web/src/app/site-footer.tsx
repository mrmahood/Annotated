import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LEGAL_PATHS } from "@/lib/legal";
import { LogoMark } from "./logo-mark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <Link className="site-wordmark" href="/" aria-label="Annotated home">
          <LogoMark />
          Annotated
        </Link>
        <nav className="site-footer-nav" aria-label="Legal">
          <Link href={LEGAL_PATHS.index}>Legal</Link>
          <Link href={LEGAL_PATHS.privacy}>Privacy</Link>
          <Link href={LEGAL_PATHS.terms}>Terms</Link>
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
        </nav>
      </div>
      <p className="site-footer-copy">
        © 2026 The CB &amp; Cooper Limited Liability Company
      </p>
    </footer>
  );
}
