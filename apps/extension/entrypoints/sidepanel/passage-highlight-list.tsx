import type { PublishedPassage } from '../../utils/passage-highlight';

function passageLabel(passage: PublishedPassage): string {
  const quote = passage.quote.length > 280 ? `${passage.quote.slice(0, 277)}…` : passage.quote;
  return passage.title ? `${passage.title}. ${quote}` : quote;
}

export function PassageHighlightList({
  passages,
  onOpen,
}: {
  passages: PublishedPassage[];
  onOpen: (annotationId: string) => void;
}) {
  if (passages.length === 0) return null;
  return (
    <section className="passage-list" aria-label="Annotated passages">
      <h2>Passages on this page</h2>
      <p>This page blocks in-page highlights, so the published passages are listed here.</p>
      <ul>
        {passages.map((passage) => (
          <li key={passage.annotationId}>
            <button type="button" onClick={() => onOpen(passage.annotationId)}>
              <span className={`passage-swatch passage-swatch-${passage.color}`} aria-hidden="true" />
              <span>
                <span className="passage-quote">{passageLabel(passage)}</span>
                {passage.verdict ? <span className="passage-verdict">{passage.verdict}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
