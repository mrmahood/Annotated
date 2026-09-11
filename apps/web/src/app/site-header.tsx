import Link from "next/link";
import { getHttpUrl, getOptionalText } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/server";
import { AppearanceControl } from "./appearance-control";
import { LogoMark } from "./logo-mark";
import { SiteHeaderAuth, type HeaderUser } from "./site-header-auth";

export async function SiteHeader({
  active,
  returnTo,
}: {
  active?: "feed";
  returnTo: string;
}) {
  let user: HeaderUser | null = null;

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();

    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", data.user.id)
        .maybeSingle();

      user = {
        id: data.user.id,
        displayName: getOptionalText(profile?.display_name) ?? "Signed in",
        avatarUrl: getHttpUrl(profile?.avatar_url)?.href ?? null,
      };
    }
  } catch {
    // Public reading remains available when authentication is unavailable.
  }

  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="site-wordmark" href="/" aria-label="Annotated home">
          <LogoMark />
          Annotated
        </Link>
        <Link className="site-feed-link" href="/" aria-current={active === "feed" ? "page" : undefined}>
          Feed
        </Link>
      </nav>
      <div className="site-chrome">
        <AppearanceControl compact />
        <SiteHeaderAuth user={user} returnTo={returnTo} />
      </div>
    </header>
  );
}
