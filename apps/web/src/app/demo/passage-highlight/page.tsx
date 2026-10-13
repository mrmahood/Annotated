import type { Metadata } from "next";
import { SiteHeader } from "../../site-header";
import { DemoShadowPassage } from "./demo-shadow";
import {
  DEMO_MISQUOTE_LEAD,
  DEMO_MISQUOTE_TAIL,
  DEMO_PAGE_HEADING,
  DEMO_PATH,
  DEMO_PREFIX_SENTENCE,
  DEMO_QUOTE,
  DEMO_SUFFIX_SENTENCE,
} from "./fixture";

export const metadata: Metadata = {
  title: "Passage highlight demo",
  description: "A fixture page for highlighting a published Annotated passage.",
  robots: { index: false, follow: false },
};

export default function PassageHighlightDemoPage() {
  return (
    <>
      <a className="skip-link" href="#passage-demo">Skip to main content</a>
      <SiteHeader returnTo={DEMO_PATH} />
      <main className="legal-main" id="passage-demo">
        <header className="legal-intro">
          <p className="eyebrow">DEMO</p>
          <h1>{DEMO_PAGE_HEADING}</h1>
          <p className="lede">
            This page is the fixture for passage highlights. A non-production
            seed publishes one annotation on the log sentence. The same sentence
            also appears in a misquote and, after the page loads, inside an open
            shadow root.
          </p>
        </header>
        <article>
          <p>{DEMO_PREFIX_SENTENCE}</p>
          <p id="harbor-log">{DEMO_QUOTE}</p>
          <p>{DEMO_SUFFIX_SENTENCE}</p>
          <blockquote>
            {DEMO_MISQUOTE_LEAD}{DEMO_QUOTE}{DEMO_MISQUOTE_TAIL}
          </blockquote>
          <DemoShadowPassage />
        </article>
      </main>
    </>
  );
}
