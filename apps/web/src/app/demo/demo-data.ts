import {
  ANNOTATION_NOTE_TYPE_LABELS,
  ANNOTATION_VERDICT_LABELS,
  type AnnotationNoteType,
  type AnnotationVerdict,
} from "@annotated/shared/annotation-note";

export const DEMO_PAGE_PATH = "/demo";

export const DEMO_PAGE_TITLE = "Annotated demo: the fact-check layer for the web";

export const DEMO_PAGE_DESCRIPTION =
  "Open fact-checks on a sample article with no install and no sign-in. Verdicts, sources, and read-only votes from a published note on the BBC Batam water story.";

export const DEMO_TEASER = "AI research tab — coming next";

export const DEMO_VALUE_PROP =
  "Annotated is the fact-check layer for the web: highlight any claim, attach sources, and they stay attached.";

export const DEMO_GITHUB_URL = "https://github.com/mrmahood/Annotated";

export const DEMO_TOUR_STEPS = [
  { id: "highlight", label: "Highlight", targetId: "demo-highlight-needs-context" },
  { id: "card", label: "Open card", targetId: "demo-fact-check" },
  { id: "verdict", label: "Verdict", targetId: "demo-verdict" },
  { id: "sources", label: "Sources", targetId: "demo-sources" },
  { id: "consensus", label: "Consensus", targetId: "consensus" },
  { id: "preserved", label: "Preserved post", targetId: "demo-preserved" },
  { id: "post", label: "Post to X", targetId: "demo-post" },
] as const;

export type DemoTourStep = (typeof DEMO_TOUR_STEPS)[number];

export type DemoPlayback = "auto" | "play" | "pause";

export function demoTourIsPlaying(playback: DemoPlayback, reducedMotion: boolean): boolean {
  if (playback === "pause") return false;
  if (playback === "play") return true;
  return !reducedMotion;
}

export const DEMO_BBC_URL = "https://www.bbc.com/news/articles/cqj6j7wlxd5eo";

export const DEMO_PUBLISHED_ANNOTATION_URL =
  "https://annotated.cbandcoop.com/factdesk/the-island-where-locals-say-data-centres-are-taking-their-water-99ceece3";

export const DEMO_PASSAGE =
  "Research in the US suggests a typical data centre consumes around 300,000 gallons of water a day, or about as much as 1,000 US households. A larger, 50MW facility could take as much water as 2,200 households per day, and enough electricity to power 22,000 homes, according to Malaysia's central bank.";

export const DEMO_FOLLOWING_SENTENCE =
  "It's unclear how much water or electricity the data centres in Batam are consuming.";

export const DEMO_COMMENTARY_TITLE =
  "These water figures are comparisons, not Batam measurements";

export const DEMO_COMMENTARY =
  "The BBC attributes both comparisons, and the next sentence says it is unclear how much water or electricity the Batam centres use. The 300,000-gallon figure restates an Environmental and Energy Study Institute estimate that a medium-sized US data centre can use up to about 110 million gallons a year, roughly the annual use of 1,000 households. That is a ceiling for one size class, not a measurement of a typical centre or of Batam. The 50MW comparison is Bank Negara Malaysia's illustration: about 22,000 households of electricity and 2,200 of water per day, using assumed household use and a water-usage effectiveness of 2.2. It is not a meter reading from the island.";

export const EESI_SOURCE_URL =
  "https://www.eesi.org/articles/view/data-centers-and-water-consumption/";

export const EESI_SNIPPET =
  "A medium-sized data center can consume up to roughly 110 million gallons of water per year for cooling purposes, equivalent to the annual water usage of approximately 1,000 households.";

export const BNM_SOURCE_URL =
  "https://www.bnm.gov.my/documents/20124/19910400/qb25q3_en_box1.pdf";

export const BNM_SNIPPET =
  "For instance, a 50MW data centre would consume approximately the equivalent power and water usage for ~22,000 and ~2,200 households per day, respectively.";

export type DemoHighlightColor = "yellow" | "amber" | "green" | "red";

export type DemoSource = {
  id: string;
  url: string;
  snippet: string;
  helpfulCount: number;
};

export type DemoNote = {
  id: string;
  noteType: AnnotationNoteType;
  verdict: AnnotationVerdict | null;
  title: string;
  commentary: string;
  passage: string;
  before: string;
  sources: DemoSource[];
  agreeCount: number;
  disagreeCount: number;
  permalink: string;
};

export const DEMO_NOTES: readonly DemoNote[] = [
  {
    id: "needs-context",
    noteType: "fact_check",
    verdict: "needs_context",
    title: DEMO_COMMENTARY_TITLE,
    commentary: DEMO_COMMENTARY,
    passage: DEMO_PASSAGE,
    before: "",
    sources: [
      {
        id: "demo-source-eesi",
        url: EESI_SOURCE_URL,
        snippet: EESI_SNIPPET,
        helpfulCount: 4,
      },
      {
        id: "demo-source-bnm",
        url: BNM_SOURCE_URL,
        snippet: BNM_SNIPPET,
        helpfulCount: 2,
      },
    ],
    agreeCount: 12,
    disagreeCount: 3,
    permalink: DEMO_PUBLISHED_ANNOTATION_URL,
  },
  {
    id: "misleading",
    noteType: "fact_check",
    verdict: "misleading",
    title: "This is not a measurement from Batam",
    commentary:
      "This sentence treats a United States research comparison as a measurement of centres on Batam. The BBC sentence it shortens says the research is from the US, and the next sentence says it is unclear how much water or electricity the Batam centres use. Example annotation.",
    passage: "A typical data centre on Batam consumes around 300,000 gallons of water a day.",
    before: "A shortened claim might read: ",
    sources: [
      {
        id: "demo-source-eesi-misleading",
        url: EESI_SOURCE_URL,
        snippet: EESI_SNIPPET,
        helpfulCount: 3,
      },
    ],
    agreeCount: 9,
    disagreeCount: 2,
    permalink: "https://annotated.cbandcoop.com/demo#misleading",
  },
  {
    id: "receipts",
    noteType: "receipts",
    verdict: null,
    title: "That ceiling is the EESI estimate",
    commentary:
      "The Environmental and Energy Study Institute says a medium-sized data center can consume up to roughly 110 million gallons a year, equivalent to about 1,000 households. This receipts note saves that source. Example annotation.",
    passage:
      "A medium-sized US data centre can use up to about 110 million gallons of water a year, roughly the annual use of 1,000 households.",
    before: "A source note might mark: ",
    sources: [
      {
        id: "demo-source-eesi-receipts",
        url: EESI_SOURCE_URL,
        snippet: EESI_SNIPPET,
        helpfulCount: 5,
      },
    ],
    agreeCount: 6,
    disagreeCount: 1,
    permalink: "https://annotated.cbandcoop.com/demo#receipts",
  },
];

export const DEMO_TWEET = {
  authorName: "Example account",
  authorHandle: "example",
  text: "A typical data centre uses 300,000 gallons a day, so Batam’s centres are taking the island’s water.",
} as const;

export function demoHighlightElementId(noteId: string): string {
  return `demo-highlight-${noteId}`;
}

export function demoOpenGraphImage(origin: string) {
  return {
    url: new URL("/demo/opengraph-image", origin).href,
    width: 1200,
    height: 630,
    alt: DEMO_PAGE_TITLE,
  };
}

export function getDemoNote(id: string): DemoNote | undefined {
  return DEMO_NOTES.find((note) => note.id === id);
}

export function demoHighlightColor(note: DemoNote): DemoHighlightColor {
  if (note.verdict === "true") return "green";
  if (note.verdict === "false") return "red";
  if (note.verdict === "misleading") return "amber";
  return "yellow";
}

export function demoChipLabel(note: DemoNote): string {
  const typeLabel = ANNOTATION_NOTE_TYPE_LABELS[note.noteType];
  if (!note.verdict) return typeLabel;
  return `${typeLabel}, ${ANNOTATION_VERDICT_LABELS[note.verdict]}`;
}

export function demoSourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const label = `${parsed.hostname}${path}`;
    return label.length > 80 ? `${label.slice(0, 77)}…` : label;
  } catch {
    return url;
  }
}

export function helpfulSourceTotal(note: DemoNote): number {
  return note.sources.reduce((total, source) => total + source.helpfulCount, 0);
}

export function composeDemoPostText(note: DemoNote): string {
  const take = note.title.replace(/\s+/g, " ").trim().slice(0, 240).trim();
  return `${take}\n${note.permalink}`;
}
