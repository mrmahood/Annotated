"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnnotationTypeLabel } from "@/components/annotation-note/annotation-type-label";
import { ConsensusMeter } from "@/components/annotation-note/consensus-meter";
import { VerdictPill } from "@/components/annotation-note/verdict-pill";
import { EXTENSION_WHATS_NEW_PATH } from "@/lib/extension-install";
import {
  DEMO_BBC_URL,
  DEMO_FOLLOWING_SENTENCE,
  DEMO_GITHUB_URL,
  DEMO_NOTES,
  DEMO_PUBLISHED_ANNOTATION_URL,
  DEMO_TEASER,
  DEMO_TOUR_STEPS,
  DEMO_TWEET,
  DEMO_VALUE_PROP,
  composeDemoPostText,
  demoChipLabel,
  demoHighlightColor,
  demoSourceLabel,
  demoTourIsPlaying,
  getDemoNote,
  helpfulSourceTotal,
  type DemoNote,
  type DemoPlayback,
} from "./demo-data";

const PANEL_ID = "demo-fact-check";
const TOUR_STEP_MS = 3200;

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function reducedMotionServerSnapshot() {
  return false;
}

function scrollTourTarget(targetId: string, behavior: ScrollBehavior) {
  const node = document.getElementById(targetId);
  if (!node) return;
  const panel = document.getElementById(PANEL_ID);
  if (panel && panel.contains(node) && panel !== node) {
    const top = node.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    panel.scrollTo({ top: Math.max(0, panel.scrollTop + top - 12), behavior });
    return;
  }
  if (panel === node) {
    panel.scrollTo({ top: 0, behavior });
    if (getComputedStyle(panel).position === "fixed") return;
    const rect = panel.getBoundingClientRect();
    const delta = rect.top - 76;
    if (Math.abs(delta) > 4) window.scrollBy({ top: delta, behavior });
    return;
  }
  node.scrollIntoView({ block: "nearest", behavior });
}

function Highlight({
  note,
  pressed,
  spotlight,
  onOpen,
}: {
  note: DemoNote;
  pressed: boolean;
  spotlight: boolean;
  onOpen: (id: string) => void;
}) {
  const color = demoHighlightColor(note);
  const receipts = note.noteType === "receipts";
  return (
    <button
      id={`demo-highlight-${note.id}`}
      className={`demo-highlight demo-highlight-${color}${receipts ? " demo-highlight-receipts" : ""}${spotlight ? " demo-spotlight" : ""}`}
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

function FactCheckCard({ note, spotlightId }: { note: DemoNote; spotlightId: string | null }) {
  return (
    <div className="note-block demo-note-block">
      <p
        className={`note-pills${spotlightId === "demo-verdict" ? " demo-spotlight" : ""}`}
        id="demo-verdict"
      >
        <AnnotationTypeLabel noteType={note.noteType} />
        {note.verdict ? <VerdictPill verdict={note.verdict} /> : null}
      </p>
      <h2 id="demo-fact-check-title" className="demo-note-title">{note.title}</h2>
      <p className="commentary-text">{note.commentary}</p>
      <section
        className={`note-sources${spotlightId === "demo-sources" ? " demo-spotlight" : ""}`}
        id="demo-sources"
        aria-labelledby="demo-sources-heading"
      >
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
      <div className={spotlightId === "consensus" ? "demo-spotlight" : undefined}>
        <ConsensusMeter
          agreeCount={note.agreeCount}
          disagreeCount={note.disagreeCount}
          helpfulSourceCount={helpfulSourceTotal(note)}
          countsAvailable
        />
      </div>
    </div>
  );
}

export function DemoExperience() {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    reducedMotionServerSnapshot,
  );
  const [playback, setPlayback] = useState<DemoPlayback>("auto");
  const [stepIndex, setStepIndex] = useState(0);
  const [guided, setGuided] = useState(true);
  const [overrideId, setOverrideId] = useState<string | null | undefined>(undefined);
  const userOpened = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const step = DEMO_TOUR_STEPS[stepIndex] ?? DEMO_TOUR_STEPS[0];
  const playing = guided && demoTourIsPlaying(playback, reducedMotion);
  const tourNoteId = guided && step.id !== "highlight" ? "needs-context" : null;
  const activeId = overrideId !== undefined ? overrideId : tourNoteId;
  const note = activeId ? getDemoNote(activeId) : undefined;
  const [needsContext, misleading, receipts] = DEMO_NOTES;
  const spotlightId = guided ? step.targetId : null;

  const finished = stepIndex >= DEMO_TOUR_STEPS.length - 1;
  const running = playing && !finished;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setStepIndex((current) => Math.min(current + 1, DEMO_TOUR_STEPS.length - 1));
    }, TOUR_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [running, stepIndex]);

  useEffect(() => {
    if (!guided || (playback === "auto" && reducedMotion)) return;
    scrollTourTarget(step.targetId, reducedMotion ? "auto" : "smooth");
  }, [guided, playback, reducedMotion, step.targetId, note]);

  useEffect(() => {
    if (!activeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOverrideId(null);
      setPlayback("pause");
      setGuided(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  useEffect(() => {
    if (!userOpened.current || !activeId) return;
    userOpened.current = false;
    panelRef.current?.querySelector<HTMLElement>("[data-demo-close]")?.focus();
  }, [activeId]);

  const takeOver = (id: string | null) => {
    if (id) userOpened.current = true;
    setOverrideId(id);
    setPlayback("pause");
    setGuided(false);
  };

  const replay = () => {
    userOpened.current = false;
    setOverrideId(undefined);
    setGuided(true);
    setStepIndex(0);
    setPlayback("play");
  };

  const togglePlayback = () => {
    if (!running && finished) {
      replay();
      return;
    }
    setPlayback(running ? "pause" : "play");
  };

  return (
    <>
      <header className="demo-intro">
        <p className="eyebrow">DEMO</p>
        <h1 id="demo-value">{DEMO_VALUE_PROP}</h1>
      </header>

      {guided ? (
        <div className="demo-tour" role="region" aria-label="Guided tour">
          <p className="demo-tour-status" aria-live="polite">
            <span className="demo-tour-count">{stepIndex + 1} / {DEMO_TOUR_STEPS.length}</span>
            {step.label}
          </p>
          <div className="demo-tour-controls">
            <button
              className="demo-tour-button"
              type="button"
              aria-pressed={running}
              onClick={togglePlayback}
            >
              {running ? "Pause" : "Play"}
            </button>
            <button className="demo-tour-button" type="button" onClick={replay}>
              Replay
            </button>
            <button
              className="demo-tour-button"
              type="button"
              onClick={() => {
                setPlayback("pause");
                setGuided(false);
              }}
            >
              Skip
            </button>
          </div>
        </div>
      ) : (
        <div className="demo-tour" role="region" aria-label="Guided tour">
          <div className="demo-tour-controls">
            <button className="demo-tour-button" type="button" onClick={replay}>
              Replay
            </button>
          </div>
        </div>
      )}

      <ul className="demo-legend" aria-label="How to read the highlights">
        <li><span className="demo-swatch demo-swatch-yellow" aria-hidden="true" />Needs context</li>
        <li><span className="demo-swatch demo-swatch-amber" aria-hidden="true" />Misleading</li>
        <li><span className="demo-swatch demo-swatch-receipts" aria-hidden="true" />Receipts</li>
        <li>Sources are the link and the quotation it supports.</li>
        <li>Consensus and helpful votes show what readers marked. They stay read-only here.</li>
      </ul>

      <div className="demo-layout">
        <div className="demo-copy">
          <article id="demo-article" aria-labelledby="demo-article-title">
            <h2 id="demo-article-title">The island where locals say data centres are taking their water</h2>
            <p className="demo-byline">
              <a href={DEMO_BBC_URL} target="_blank" rel="noopener noreferrer">
                BBC
                <span aria-hidden="true"> ↗</span>
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              {" · "}
              <a href={DEMO_PUBLISHED_ANNOTATION_URL}>Fact-check by @factdesk</a>
            </p>
            <p>
              Residents on Batam say the taps ran dry while data centres at Nongsa Digital Park kept water for their machines.
            </p>
            <p>
              {needsContext ? (
                <Highlight
                  note={needsContext}
                  pressed={activeId === needsContext.id}
                  spotlight={spotlightId === `demo-highlight-${needsContext.id}`}
                  onOpen={takeOver}
                />
              ) : null}
            </p>
            <p>{DEMO_FOLLOWING_SENTENCE}</p>
            <p>
              {misleading ? (
                <>
                  {misleading.before}
                  <Highlight
                    note={misleading}
                    pressed={activeId === misleading.id}
                    spotlight={false}
                    onOpen={takeOver}
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
                    spotlight={false}
                    onOpen={takeOver}
                  />
                </>
              ) : null}
            </p>
          </article>

          <section className="demo-why" aria-labelledby="demo-why-heading">
            <h2 id="demo-why-heading">Why this matters</h2>
            <ul>
              <li>Fact-checking happens in place, on the passage.</li>
              <li>Sources stay attached to the claim.</li>
              <li>Posts are preserved even if they are deleted.</li>
            </ul>
          </section>
        </div>

        {note ? (
          <>
            <button
              className="demo-backdrop"
              type="button"
              aria-label="Close fact-check"
              onClick={() => takeOver(null)}
            />
            <aside
              ref={panelRef}
              className={`demo-panel${spotlightId === PANEL_ID ? " demo-spotlight" : ""}`}
              id={PANEL_ID}
              role="dialog"
              aria-modal="false"
              aria-labelledby="demo-fact-check-title"
            >
              <div className="demo-panel-handle" aria-hidden="true" />
              <div className="demo-panel-toolbar">
                <p className="section-label">Fact-check</p>
                <button className="demo-close" type="button" data-demo-close="" onClick={() => takeOver(null)}>
                  Close
                </button>
              </div>
              <FactCheckCard note={note} spotlightId={spotlightId} />
              <section
                className={`preserved-post demo-preserved${spotlightId === "demo-preserved" ? " demo-spotlight" : ""}`}
                id="demo-preserved"
                aria-labelledby="demo-preserved-heading"
              >
                <p className="demo-example-flag">Example content</p>
                <p className="section-label">Preserved post</p>
                <h2 id="demo-preserved-heading">Post on X</h2>
                <p className="preserved-post-note">Saved with this annotation. The post stays here if it is later deleted.</p>
                <p className="preserved-post-author">
                  {DEMO_TWEET.authorName} · @{DEMO_TWEET.authorHandle}
                </p>
                <blockquote>{DEMO_TWEET.text}</blockquote>
              </section>
              <section
                className={`demo-post-section${spotlightId === "demo-post" ? " demo-spotlight" : ""}`}
                id="demo-post"
                aria-labelledby="demo-post-heading"
              >
                <p className="section-label" id="demo-post-heading">Post to X</p>
                <p className="demo-preview-note">Composed text only. This demo does not post.</p>
                <pre className="demo-post-preview">{composeDemoPostText(note)}</pre>
              </section>
            </aside>
          </>
        ) : (
          <aside className="demo-panel demo-panel-idle" aria-label="Fact-check panel">
            <p className="section-label">Fact-check</p>
          </aside>
        )}
      </div>

      <footer className="demo-close-band">
        <p className="demo-teaser">{DEMO_TEASER}</p>
        <div className="demo-actions">
          <Link className="public-button public-button-primary" href={EXTENSION_WHATS_NEW_PATH}>
            Install for Chrome
          </Link>
          <Link className="public-button" href="/">
            View the feed
          </Link>
          <a className="public-button" href={DEMO_GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
            <span aria-hidden="true"> ↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>
      </footer>
    </>
  );
}
