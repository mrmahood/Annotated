import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SiteHeader } from "../site-header";
import { canAccessOperatorConsole } from "@/lib/ops-console";
import { getNotFoundMetadata } from "@/lib/public-routes";
import { createClient } from "@/lib/supabase/server";
import { OpsConsole } from "./ops-console";

export const dynamic = "force-dynamic";

const getOperatorSessionUser = cache(async () => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
});

async function operatorMayOpenConsole() {
  return canAccessOperatorConsole(await getOperatorSessionUser());
}

export async function generateMetadata(): Promise<Metadata> {
  if (!await operatorMayOpenConsole()) return getNotFoundMetadata();
  return {
    title: "Operator console | Annotated",
    robots: { index: false, follow: false },
  };
}

export default async function OperatorConsolePage() {
  if (!await operatorMayOpenConsole()) notFound();

  return (
    <>
      <SiteHeader returnTo="/ops" />
      <main className="ops-main">
        <header className="ops-intro">
          <p className="eyebrow">Operator</p>
          <h1>Claim review and annotation tools</h1>
          <p className="lede">
            Allowlisted operators only. Actions reuse the existing moderation
            routes and require a typed confirmation phrase.
          </p>
        </header>
        <OpsConsole />
      </main>
    </>
  );
}
