import type { Metadata } from "next";
import { SiteHeader } from "../site-header";
import { DemoExperience } from "./demo-experience";
import {
  DEMO_PAGE_DESCRIPTION,
  DEMO_PAGE_PATH,
  DEMO_PAGE_TITLE,
} from "./demo-data";

export const metadata: Metadata = {
  title: DEMO_PAGE_TITLE,
  description: DEMO_PAGE_DESCRIPTION,
  alternates: { canonical: DEMO_PAGE_PATH },
  openGraph: {
    title: DEMO_PAGE_TITLE,
    description: DEMO_PAGE_DESCRIPTION,
    url: DEMO_PAGE_PATH,
  },
};

export default function DemoPage() {
  return (
    <>
      <a className="skip-link" href="#demo-article">Skip to main content</a>
      <SiteHeader returnTo={DEMO_PAGE_PATH} />
      <main className="demo-main">
        <DemoExperience />
      </main>
    </>
  );
}
