import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal";

export default function AuthenticationErrorPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-error-title">
        <p className="eyebrow">ANNOTATED</p>
        <h1 id="auth-error-title">Sign-in did not finish</h1>
        <p className="lede">
          The authentication response could not be completed. Return to Annotated
          and try again.
        </p>
        <Link className="button button-primary" href="/">
          Return to sign in
        </Link>
        <p className="auth-legal-links">
          <Link href={LEGAL_PATHS.privacy}>Privacy</Link>
          {" · "}
          <Link href={LEGAL_PATHS.terms}>Terms</Link>
        </p>
      </section>
    </main>
  );
}
