"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnnotationTypeLabel } from "@/components/annotation-note/annotation-type-label";
import { ConsensusMeter } from "@/components/annotation-note/consensus-meter";
import { VerdictPill } from "@/components/annotation-note/verdict-pill";
import { EXTENSION_WHATS_NEW_PATH } from "@/lib/extension-install";
import {
  DEMO_BBC_URL,
  DEMO_FOLLOWING_SENTENCE,
  DEMO_NOTES,
  DEMO_PAGE_DESCRIPTION,
  DEMO_PUBLISHED_ANNOTATION_URL,
  DEMO_STEPS,
  DEMO_TEASER,
  DEMO_TWEET,
  composeDemoPostText,
  demoChipLabel,
  demoHighlightColor,
  demoSourceLabel,
  getDemoNote,
  helpfulSourceTotal,
  type DemoNote,
} from "./demo-data";

const PANEL_ID = "demo-fact-check";

function Highlight({
  note,
  pressed,
  onOpen,
}: {
  note: DemoNote;
  pressed: boolean;
  onOpen: (id: string) => void;
}) {
  const color = demoHighlightColor(note);
  const receipts = note.noteType === "receipts";
  return (
    <button
      id={`demo-highlight-${note.id}`}
      className={`demo-highlight demo-highlight-${color}${receipts ? " demo-highlight-receipts" : ""}`}
      type="button"
      aria-pressed={pressed}
      aria-expanded={pressed}
      aria-controls={PANEL_ID}
      aria-label={`${note.passage} ${demoChipLabel(note)}. Open fact-check.`}
      onClick={() => onOpen(note.id)}
    >
      {note.passage}
    </button>
  );
}

function FactCheckCard({ note }: { note: DemoNote }) {
  return (
    <div className="note-block demo-note-block">
      <p className="note-pills">
        <AnnotationTypeLabel noteType={note.noteType} />
        {note.verdict ? <VerdictPill verdict={note.verdict} /> : null}
      </p>
      <h2 id="demo-fact-check-title" className="demo-note-title">{note.title}</h2>
      <p className="commentary-text">{note.commentary}</p>
      <section className="note-sources" aria-labelledby="demo-sources-heading">
        <p className="section-label" id="demo-sources-heading">Sources</p>
        <ol>
          {note.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {demoSourceLabel(source.url)}
                <span aria-hidden="true"> ↗</span>
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              <span className="note-source-helpful-count">{source.helpfulCount} helpful</span>
              <blockquote className="demo-snippet">{source.snippet}</blockquote>
            </li>
          ))}
        </ol>
      </section>
      <ConsensusMeter
        agreeCount={note.agreeCount}
        disagreeCount={note.disagreeCount}
        helpfulSourceCount={helpfulSourceTotal(note)}
        countsAvailable
      />
      <p className="demo-vote-note">Example votes. This demo does not save a rating.</p>
    </div>
  );
}

export function DemoExperience() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const note = activeId ? getDemoNote(activeId) : undefined;
  const [needsContext, misleading, receipts] = DEMO_NOTES;

  useEffect(() => {
    const previous = activeIdRef.current;
    activeIdRef.current = activeId;
    if (!activeId) {
      if (previous) document.getElementById(`demo-highlight-${previous}`)?.focus();
      return;
    }
    panelRef.current?.querySelector<HTMLElement>("[data-demo-close]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  return (
    <div className="demo-layout">
      <div className="demo-copy">
      <header className="demo-intro">
        <p className="eyebrow">DEMO</p>
        <h1>The island where locals say data centres are taking their water</h1>
        <p className="lede">{DEMO_PAGE_DESCRIPTION}</p>
        <p className="demo-credit">
          Sample article from the{" "}
          <a href={DEMO_BBC_URL} target="_blank" rel="noopener noreferrer">
            BBC story
            <span aria-hidden="true"> ↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          . The Needs context note reuses the published fact-check{" "}
          <a href={DEMO_PUBLISHED_ANNOTATION_URL}>by @factdesk</a>.
          {" "}No install, no sign-in, and nothing on this page is saved.
        </p>
      </header>

      <ol className="demo-steps" aria-label="How to use this demo">
        {DEMO_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

        <article id="demo-article" aria-labelledby="demo-article-title">
          <h2 id="demo-article-title" className="visually-hidden">Sample article</h2>
          <p>
            Residents on the Indonesian island of Batam have protested water cuts they connect to data centres at Nongsa Digital Park. Officials have blamed a long dry spell. This sample follows the BBC report and keeps the passage that a published Annotated fact-check marks.
          </p>
          <p>The published fact-check marks this passage from the BBC story:</p>
          <p>
            {needsContext ? (
              <Highlight
                note={needsContext}
                pressed={activeId === needsContext.id}
                onOpen={setActiveId}
              />
            ) : null}
          </p>
          <p>{DEMO_FOLLOWING_SENTENCE}</p>

          <h2 className="demo-subhead">Example claims</h2>
          <p>The next two passages are example copy for this demo. They are not sentences from the BBC story.</p>
          <p>
            {misleading ? (
              <>
                {misleading.before}
                <Highlight
                  note={misleading}
                  pressed={activeId === misleading.id}
                  onOpen={setActiveId}
                />
              </>
            ) : null}
          </p>
          <p>
            {receipts ? (
              <>
                {receipts.before}
                <Highlight
                  note={receipts}
                  pressed={activeId === receipts.id}
                  onOpen={setActiveId}
                />
              </>
            ) : null}
          </p>
        </article>

      <div className="demo-actions">
        <Link className="public-button public-button-primary" href={EXTENSION_WHATS_NEW_PATH}>
          Install for Chrome
        </Link>
        <Link className="public-button" href="/">
          View the feed
        </Link>
      </div>
      <p className="demo-teaser">{DEMO_TEASER}</p>
      </div>

        {note ? (
          <>
            <button
              className="demo-backdrop"
              type="button"
              aria-label="Close fact-check"
              onClick={() => setActiveId(null)}
            />
            <aside
              ref={panelRef}
              className="demo-panel"
              id={PANEL_ID}
              role="dialog"
              aria-modal="false"
              aria-labelledby="demo-fact-check-title"
            >
              <div className="demo-panel-handle" aria-hidden="true" />
              <div className="demo-panel-toolbar">
                <p className="section-label">Fact-check</p>
                <button
                  className="demo-close"
                  type="button"
                  data-demo-close=""
                  onClick={() => setActiveId(null)}
                >
                  Close
                </button>
              </div>
              <FactCheckCard note={note} />
              <section className="preserved-post demo-preserved" aria-labelledby="demo-preserved-heading">
                <p className="demo-example-flag">Example content</p>
                <p className="section-label">Preserved post</p>
                <h2 id="demo-preserved-heading">Post on X</h2>
                <p className="preserved-post-note">
                  Example content for this demo. This is not a live embed and it is not a post captured from X.
                </p>
                <p className="preserved-post-author">
                  {DEMO_TWEET.authorName} · @{DEMO_TWEET.authorHandle}
                </p>
                <blockquote>{DEMO_TWEET.text}</blockquote>
              </section>
              <section className="demo-post-section" aria-labelledby="demo-post-heading">
                <p className="section-label" id="demo-post-heading">Post to X</p>
                <p className="demo-preview-note">Composed text only. This demo does not post.</p>
                <pre className="demo-post-preview">{composeDemoPostText(note)}</pre>
              </section>
            </aside>
          </>
        ) : (
          <aside className="demo-panel demo-panel-idle" aria-label="Fact-check panel">
            <p className="section-label">Fact-check</p>
            <p>Select a highlighted passage. The note opens here on a wide screen, and as a sheet on a phone.</p>
          </aside>
        )}
    </div>
  );
}
