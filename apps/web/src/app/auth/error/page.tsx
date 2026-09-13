import Link from "next/link";
import { LegalLinks } from "../../legal-links";

export default function AuthenticationErrorPage() {
  return (
    <main id="main" className="auth-shell">
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
        <LegalLinks />
      </section>
    </main>
  );
}
