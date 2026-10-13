import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ANNOTATION_VERDICT_LABELS, ANNOTATION_VERDICTS } from "@annotated/shared/annotation-note";
import {
  annotationAuthorType,
  CLAIM_REVIEW_BEST_RATING,
  CLAIM_REVIEW_RATINGS,
  CLAIM_REVIEW_WORST_RATING,
  claimReviewRatingEntries,
  CLAIM_REVIEWED_MAX_LENGTH,
  getAnnotationStructuredData,
  shortenClaimReviewed,
} from "./claim-review-jsonld.ts";
import { serializeJsonLd } from "./json-ld.ts";

const ORIGIN = "https://annotated.example";

const FACTDESK_PASSAGE =
  "Research in the US suggests a typical data centre consumes around 300,000 gallons of water a day, or about as much as 1,000 US households. A larger, 50MW facility could take as much water as 2,200 households per day, and enough electricity to power 22,000 homes, according to Malaysia's central bank.";

const MATT_PASSAGE =
  "\"Not a single drop has come through our taps for the last three months... Our water supply had been reliable until the data centres came,\" Dewi Susanti, one of the protesters, told the BBC.";

const BBC = {
  canonicalUrl: "https://www.bbc.com/news/articles/cqj6j7wlxd5eo",
  title: "The island where locals say data centres are taking their water",
  author: null,
  publisher: "BBC",
  showName: null,
  hostname: "bbc.com",
  type: "article",
  videoId: null,
};

function article(overrides = {}) {
  return {
    id: "99ceece3-b67f-473f-bf27-3e54651a7c26",
    kind: "article",
    title: "These water figures are comparisons, not Batam measurements",
    commentaryText: "The BBC attributes both comparisons.",
    noteType: "fact_check",
    verdict: "needs_context",
    sourceLinks: [
      {
        id: "4512416e-aedb-4529-8086-3d1832b58a44",
        url: "https://www.eesi.org/articles/view/data-centers-and-water-consumption/",
        position: 1,
      },
      {
        id: "fa74cdc0-1b35-490e-be71-b442a3659fc7",
        url: "https://www.bnm.gov.my/documents/20124/19910400/qb25q3_en_box1.pdf",
        position: 2,
      },
    ],
    publishedAt: "2026-10-13T06:41:17.207Z",
    route: {
      creatorHandle: "factdesk",
      annotationSlug: "the-island-where-locals-say-data-centres-are-taking-their-water-99ceece3",
    },
    source: BBC,
    annotator: {
      id: "b373bd38-44fe-46ab-b8f1-327665f73fc0",
      name: "Annotated Fact Desk",
      avatarUrl: null,
    },
    audio: null,
    tweetCapture: null,
    receiptSources: [],
    selectedText: FACTDESK_PASSAGE,
    startMs: null,
    endMs: null,
    ...overrides,
  };
}

export const productionClaimReviewAnnotations = {
  factdesk: article(),
  matt: article({
    id: "f4ea2383-66aa-4329-9790-7fd2e325b33f",
    title: "One resident's account, not a cause",
    commentaryText: "One resident's account is not a measurement of the island.",
    sourceLinks: [
      {
        id: "c76e1741-a03b-4bc7-b769-fe401b02c8b1",
        url: "https://www.bbc.com/news/articles/cqj6j7wlxd5eo",
        position: 1,
      },
    ],
    publishedAt: "2026-10-13T15:14:22.299Z",
    route: {
      creatorHandle: "matt-mahood-85fdb29c",
      annotationSlug: "the-island-where-locals-say-data-centres-are-taking-their-water-f4ea2383",
    },
    annotator: {
      id: "85fdb29c-83e0-40b0-baf0-4795bcccaddb",
      name: "Matt Mahood",
      avatarUrl: null,
    },
    selectedText: MATT_PASSAGE,
  }),
};

function withOrigin(run) {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
}

test("rating scale documents every verdict from False to True", () => {
  assert.equal(CLAIM_REVIEW_WORST_RATING, 1);
  assert.equal(CLAIM_REVIEW_BEST_RATING, 4);
  assert.deepEqual(
    claimReviewRatingEntries().map((entry) => [entry.verdict, entry.alternateName, entry.ratingValue]),
    [
      ["false", "False", 1],
      ["misleading", "Misleading", 2],
      ["needs_context", "Needs context", 3],
      ["true", "True", 4],
    ],
  );
  for (const verdict of ANNOTATION_VERDICTS) {
    assert.equal(CLAIM_REVIEW_RATINGS[verdict].alternateName, ANNOTATION_VERDICT_LABELS[verdict]);
    assert.ok(CLAIM_REVIEW_RATINGS[verdict].ratingValue >= CLAIM_REVIEW_WORST_RATING);
    assert.ok(CLAIM_REVIEW_RATINGS[verdict].ratingValue <= CLAIM_REVIEW_BEST_RATING);
  }
  assert.match(CLAIM_REVIEW_RATINGS.true.meaning, /accurate/i);
});

test("author is an Organization for a desk name and a Person otherwise", () => {
  assert.equal(annotationAuthorType("Annotated Fact Desk"), "Organization");
  assert.equal(annotationAuthorType("Matt Mahood"), "Person");
  assert.equal(annotationAuthorType("Reader One"), "Person");
});

test("claimReviewed stays within about 75 characters and cuts on a word boundary", () => {
  assert.equal(CLAIM_REVIEWED_MAX_LENGTH, 75);
  assert.equal(shortenClaimReviewed("The speaker said <the claim>."), "The speaker said <the claim>.");
  assert.equal(shortenClaimReviewed("x".repeat(75)), "x".repeat(75));
  assert.equal(
    shortenClaimReviewed("Research in the US suggests a typical data centre consumes around 300,000 gallons"),
    "Research in the US suggests a typical data centre consumes around 300,000…",
  );
  const shortened = shortenClaimReviewed(FACTDESK_PASSAGE);
  assert.equal(shortened, "Research in the US suggests a typical data centre consumes around 300,000…");
  assert.ok(shortened.length <= CLAIM_REVIEWED_MAX_LENGTH);
  assert.equal(shortened.endsWith("…"), true);
  assert.equal(shortened.slice(0, -1).includes(" "), true);
  assert.equal(/[^\s]…$/.test(shortened), true);
  assert.equal(shortenClaimReviewed("a".repeat(80)).length, CLAIM_REVIEWED_MAX_LENGTH);
  assert.equal(shortenClaimReviewed("a".repeat(80)).endsWith("…"), true);
});

test("production fact-checks emit ClaimReview for both public URL shapes", () => {
  const documents = withOrigin(() => ({
    factdesk: getAnnotationStructuredData(productionClaimReviewAnnotations.factdesk),
    matt: getAnnotationStructuredData(productionClaimReviewAnnotations.matt),
  }));

  assert.equal(documents.factdesk["@type"], "ClaimReview");
  assert.equal(
    documents.factdesk.url,
    `${ORIGIN}/factdesk/the-island-where-locals-say-data-centres-are-taking-their-water-99ceece3`,
  );
  assert.equal(
    documents.factdesk.claimReviewed,
    "Research in the US suggests a typical data centre consumes around 300,000…",
  );
  assert.notEqual(documents.factdesk.claimReviewed, FACTDESK_PASSAGE);
  assert.equal(documents.factdesk.datePublished, "2026-10-13T06:41:17.207Z");
  assert.deepEqual(documents.factdesk.author, {
    "@type": "Organization",
    name: "Annotated Fact Desk",
    url: `${ORIGIN}/p/b373bd38-44fe-46ab-b8f1-327665f73fc0`,
  });
  assert.deepEqual(documents.factdesk.itemReviewed, {
    "@type": "Claim",
    appearance: {
      "@type": "CreativeWork",
      url: BBC.canonicalUrl,
      headline: BBC.title,
      publisher: { "@type": "Organization", name: "BBC" },
    },
  });
  assert.deepEqual(documents.factdesk.reviewRating, {
    "@type": "Rating",
    alternateName: "Needs context",
    ratingValue: 3,
    bestRating: 4,
    worstRating: 1,
  });
  assert.deepEqual(documents.factdesk.citation, [
    "https://www.eesi.org/articles/view/data-centers-and-water-consumption/",
    "https://www.bnm.gov.my/documents/20124/19910400/qb25q3_en_box1.pdf",
  ]);

  assert.equal(documents.matt["@type"], "ClaimReview");
  assert.equal(
    documents.matt.url,
    `${ORIGIN}/matt-mahood-85fdb29c/the-island-where-locals-say-data-centres-are-taking-their-water-f4ea2383`,
  );
  assert.equal(
    documents.matt.claimReviewed,
    "\"Not a single drop has come through our taps for the last three months...…",
  );
  assert.notEqual(documents.matt.claimReviewed, MATT_PASSAGE);
  assert.equal(documents.matt.author["@type"], "Person");
  assert.equal(documents.matt.author.name, "Matt Mahood");
  assert.equal(documents.matt.author.url, `${ORIGIN}/p/85fdb29c-83e0-40b0-baf0-4795bcccaddb`);
  assert.equal(documents.matt.citation, BBC.canonicalUrl);
  assert.equal(documents.matt.reviewRating.alternateName, "Needs context");
});

test("ClaimReview is only for a fact-check that has a verdict and a passage", () => {
  const data = withOrigin(() => ({
    receipts: getAnnotationStructuredData(article({
      noteType: "receipts",
      verdict: null,
      commentaryText: "A receipts note.",
    })),
    contextWithVerdict: getAnnotationStructuredData(article({
      noteType: "context",
      verdict: "true",
      commentaryText: "Added context.",
    })),
    factWithoutVerdict: getAnnotationStructuredData(article({
      verdict: null,
      commentaryText: "No verdict stored.",
    })),
    videoFact: getAnnotationStructuredData(article({
      kind: "video_hosted",
      selectedText: null,
      startMs: 1_000,
      endMs: 5_000,
      transcript: { text: "  The speaker said <the claim>.  ", language: "en", segments: null },
      verdict: "false",
      commentaryText: "The clip does not say that.",
      sourceLinks: [],
    })),
    videoWithoutPassage: getAnnotationStructuredData(article({
      kind: "video_legacy",
      selectedText: null,
      startMs: 1_000,
      endMs: 5_000,
      verdict: "misleading",
      commentaryText: "No transcript is attached.",
    })),
    empty: getAnnotationStructuredData(article({
      noteType: "hot_take",
      verdict: null,
      commentaryText: "   ",
      selectedText: " \n ",
    })),
  }));

  for (const key of ["receipts", "contextWithVerdict", "factWithoutVerdict", "videoWithoutPassage"]) {
    assert.equal(data[key]["@type"], "Comment", key);
    assert.equal(data[key].about["@type"], "CreativeWork", key);
    assert.notEqual(data[key]["@type"], "ClaimReview", key);
  }
  assert.equal(data.contextWithVerdict.text, "Added context.");
  assert.equal(data.videoFact["@type"], "ClaimReview");
  assert.equal(data.videoFact.claimReviewed, "The speaker said <the claim>.");
  assert.equal(data.videoFact.reviewRating.alternateName, "False");
  assert.equal(data.videoFact.reviewRating.ratingValue, 1);
  assert.equal(data.videoFact.citation, undefined);
  assert.equal(data.videoWithoutPassage.text, "No transcript is attached.");
  assert.equal(data.empty, null);
});

test("appearance omits unknown headline and publisher, and a missing origin emits nothing", () => {
  const sparse = withOrigin(() => getAnnotationStructuredData(article({
    source: { ...BBC, title: "  ", publisher: null },
    selectedText: "  line one \n line two  ",
  })));
  assert.equal(sparse.claimReviewed, "line one line two");
  assert.deepEqual(sparse.itemReviewed.appearance, {
    "@type": "CreativeWork",
    url: BBC.canonicalUrl,
  });

  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    assert.equal(getAnnotationStructuredData(article()), null);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("script serialization escapes < so a passage cannot close the tag", async () => {
  const data = withOrigin(() => getAnnotationStructuredData(article({
    selectedText: "a <script>alert(1)</script> and <!-- comment -->",
    verdict: "false",
  })));
  const html = serializeJsonLd(data);
  assert.equal(html.includes("<"), false);
  assert.match(html, /\\u003cscript>alert\(1\)\\u003c\/script>/);
  assert.match(html, /\\u003c!-- comment -->/);
  assert.equal(JSON.parse(html).claimReviewed, "a <script>alert(1)</script> and <!-- comment -->");

  const component = await readFile(new URL("../app/json-ld.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/public-annotation-page.tsx", import.meta.url), "utf8");
  assert.match(component, /serializeJsonLd/);
  assert.doesNotMatch(component, /JSON\.stringify/);
  assert.match(page, /getAnnotationStructuredData/);
  assert.match(page, /<JsonLd /);
  assert.match(page, /highlighted-quote">\{annotation\.selectedText\}/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
});
