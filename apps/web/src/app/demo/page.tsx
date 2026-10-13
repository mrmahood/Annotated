import type { Metadata } from "next";
import { getMetadataBaseOrigin } from "@/lib/public-routes";
import { SiteHeader } from "../site-header";
import { DemoExperience } from "./demo-experience";
import {
  DEMO_PAGE_DESCRIPTION,
  DEMO_PAGE_PATH,
  DEMO_PAGE_TITLE,
  demoOpenGraphImage,
} from "./demo-data";

const metadataOrigin = getMetadataBaseOrigin();
const demoImage = metadataOrigin ? demoOpenGraphImage(metadataOrigin) : undefined;

export const metadata: Metadata = {
  title: DEMO_PAGE_TITLE,
  description: DEMO_PAGE_DESCRIPTION,
  alternates: { canonical: DEMO_PAGE_PATH },
  openGraph: {
    title: DEMO_PAGE_TITLE,
    description: DEMO_PAGE_DESCRIPTION,
    url: DEMO_PAGE_PATH,
    ...(demoImage ? { images: [demoImage] } : {}),
  },
  ...(demoImage ? { twitter: { images: [demoImage] } } : {}),
};

export default function DemoPage() {
  return (
    <>
      <a className="skip-link" href="#demo-value">Skip to main content</a>
      <SiteHeader returnTo={DEMO_PAGE_PATH} installCallout={false} />
      <main className="demo-main">
        <DemoExperience />
      </main>
    </>
  );
}
