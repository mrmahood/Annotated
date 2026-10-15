import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { FEED_LEDE } from "@/lib/discoverability";
import { SITE_SHARE_IMAGE } from "@/lib/share-image";
import {
  APPEARANCE_COOKIE_NAME,
  getAppearanceBootstrapScript,
  parseAppearancePreference,
  resolveAppearanceTheme,
} from "@annotated/shared/appearance";
import { getMetadataBaseOrigin } from "@/lib/public-routes";
import { AppearanceRuntime } from "./appearance-control";
import { SiteFooter } from "./site-footer";
import "./globals.css";

const siteOrigin = getMetadataBaseOrigin();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  ...(siteOrigin ? { metadataBase: new URL(siteOrigin) } : {}),
  title: "Annotated",
  description: FEED_LEDE,
  openGraph: {
    images: [SITE_SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    images: [SITE_SHARE_IMAGE],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const appearance = parseAppearancePreference(
    cookieStore.get(APPEARANCE_COOKIE_NAME)?.value,
  );
  const theme = resolveAppearanceTheme(appearance, false);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
      data-theme={theme}
      data-appearance={appearance}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: getAppearanceBootstrapScript() }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AppearanceRuntime />
        <div className="site-app">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
