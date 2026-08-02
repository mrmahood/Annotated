import { AuthAccount } from "./auth-account";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getMetadataText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSafeAvatarUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  let user: {
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null = null;
  let serverError: string | null = null;
  let profileError: string | null = null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error && error.code !== "session_not_found") {
      serverError = "Your session could not be verified. Please try again.";
    }

    if (data.user) {
      const { data: profile, error: profileQueryError } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileQueryError) {
        profileError = "Your Annotated profile could not be verified.";
      } else if (!profile) {
        profileError =
          process.env.NODE_ENV === "development"
            ? "Development error: authentication succeeded, but the profiles trigger did not create a profile for this user."
            : "Your Annotated profile is not available. Please contact support.";
      }

      const metadataName =
        getMetadataText(data.user.user_metadata.full_name) ||
        getMetadataText(data.user.user_metadata.name);
      const profileName = getMetadataText(profile?.display_name);
      const email = data.user.email ?? "Email unavailable";

      user = {
        name: profileName || metadataName || email,
        email,
        avatarUrl:
          getSafeAvatarUrl(profile?.avatar_url) ??
          getSafeAvatarUrl(data.user.user_metadata.avatar_url) ??
          getSafeAvatarUrl(data.user.user_metadata.picture),
      };
    }
  } catch {
    serverError =
      process.env.NODE_ENV === "development"
        ? "Supabase is not configured. Check apps/web/.env.local."
        : "Authentication is temporarily unavailable.";
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">ANNOTATED</p>
        <h1 id="auth-title">Keep your reading connected.</h1>
        <p className="lede">
          Sign in with Google to restore your Annotated account. Publishing is
          not enabled yet.
        </p>
        <AuthAccount user={user} serverError={serverError} profileError={profileError} />
      </section>
    </main>
  );
}
