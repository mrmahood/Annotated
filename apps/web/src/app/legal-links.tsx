import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal";

export function LegalLinks({
  className = "legal-inline-links",
}: {
  className?: string;
}) {
  return (
    <nav className={className} aria-label="Legal">
      <Link href={LEGAL_PATHS.privacy}>Privacy</Link>
      <Link href={LEGAL_PATHS.terms}>Terms</Link>
    </nav>
  );
}
