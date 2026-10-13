import type { AnnotationConsensusSource } from "@annotated/shared/annotation-note";

function sourceLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const label = `${parsed.hostname}${path}`;
    return label.length > 80 ? `${label.slice(0, 77)}…` : label;
  } catch {
    return url;
  }
}

export function SourceLinks({
  sources,
  onToggleHelpful,
  pendingSourceId = null,
  heading = true,
}: {
  sources: AnnotationConsensusSource[];
  onToggleHelpful?: (sourceId: string) => void;
  pendingSourceId?: string | null;
  heading?: boolean;
}) {
  if (sources.length === 0) return null;
  const showHelpful = heading || Boolean(onToggleHelpful);

  const list = (
      <ol>
        {sources.map((source) => (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {sourceLinkLabel(source.url)}
              <span aria-hidden="true"> ↗</span>
            </a>
            {showHelpful && typeof source.helpfulCount === "number" && (
              <span className="note-source-helpful-count">
                {source.helpfulCount.toLocaleString()} helpful
              </span>
            )}
            {onToggleHelpful && (
              <button
                className="note-source-helpful"
                type="button"
                aria-pressed={source.viewerMarkedHelpful}
                disabled={pendingSourceId === source.id}
                onClick={() => onToggleHelpful(source.id)}
              >
                {source.viewerMarkedHelpful ? "Helpful" : "Mark helpful"}
              </button>
            )}
          </li>
        ))}
      </ol>
  );

  if (!heading) return <div className="note-sources note-sources-inline">{list}</div>;

  return (
    <section className="note-sources" aria-labelledby="note-sources-heading">
      <p className="section-label" id="note-sources-heading">Sources</p>
      {list}
    </section>
  );
}
