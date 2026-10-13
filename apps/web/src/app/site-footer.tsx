import Link from "next/link";
import { WHATS_NEW_PATH } from "@/lib/extension-release";
import { LEGAL_OPERATOR, LEGAL_PATHS } from "@/lib/legal";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-nav">
        <nav aria-label="Legal">
          <Link href={LEGAL_PATHS.privacy}>Privacy</Link>
          <Link href={LEGAL_PATHS.terms}>Terms</Link>
          <Link href={LEGAL_PATHS.center}>Legal</Link>
          <a href={`mailto:${LEGAL_OPERATOR.email}`}>{LEGAL_OPERATOR.email}</a>
        </nav>
        <nav aria-label="About Annotated">
          <Link href={WHATS_NEW_PATH}>{"What's new"}</Link>
        </nav>
      </div>
      <p className="site-footer-copy">
        © 2026 {LEGAL_OPERATOR.company}
      </p>
    </footer>
  );
}
