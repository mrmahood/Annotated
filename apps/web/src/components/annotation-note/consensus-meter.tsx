export function ConsensusMeter({
  agreeCount,
  disagreeCount,
  helpfulSourceCount,
  countsAvailable = true,
  currentAgreement = null,
  onAgree,
  onDisagree,
  pending = false,
}: {
  agreeCount: number;
  disagreeCount: number;
  helpfulSourceCount: number;
  countsAvailable?: boolean;
  currentAgreement?: -1 | 1 | null;
  onAgree?: () => void;
  onDisagree?: () => void;
  pending?: boolean;
}) {
  const total = agreeCount + disagreeCount;
  const agreeShare = total > 0 ? (agreeCount / total) * 100 : 0;
  const disagreeShare = total > 0 ? (disagreeCount / total) * 100 : 0;

  return (
    <section className="note-consensus" id="consensus" aria-labelledby="consensus-heading">
      <p className="section-label" id="consensus-heading">Consensus</p>
      {countsAvailable ? (
        <>
          <p className="note-consensus-counts">
            <span>{agreeCount.toLocaleString()} agree</span>
            <span>{disagreeCount.toLocaleString()} disagree</span>
            <span>
              {helpfulSourceCount.toLocaleString()} helpful {helpfulSourceCount === 1 ? "source rating" : "source ratings"}
            </span>
          </p>
          <div
            className="note-consensus-bar"
            role="img"
            aria-label={total > 0
              ? `${agreeCount.toLocaleString()} agree and ${disagreeCount.toLocaleString()} disagree`
              : "No agree or disagree votes yet"}
          >
            {total > 0 ? (
              <>
                <span className="note-consensus-agree" style={{ width: `${agreeShare}%` }} />
                <span className="note-consensus-disagree" style={{ width: `${disagreeShare}%` }} />
              </>
            ) : (
              <span className="note-consensus-empty" />
            )}
          </div>
          {onAgree && onDisagree && (
            <div className="note-consensus-actions" role="group" aria-label="Agree or disagree">
              <button
                className="note-consensus-button"
                type="button"
                aria-pressed={currentAgreement === 1}
                disabled={pending}
                onClick={onAgree}
              >
                Agree
              </button>
              <button
                className="note-consensus-button"
                type="button"
                aria-pressed={currentAgreement === -1}
                disabled={pending}
                onClick={onDisagree}
              >
                Disagree
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="note-consensus-unavailable" role="alert">Community consensus is temporarily unavailable.</p>
      )}
    </section>
  );
}
