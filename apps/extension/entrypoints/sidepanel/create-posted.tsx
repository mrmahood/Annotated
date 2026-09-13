import type { CreatePostedConfirmation } from '../../utils/create-posted';

export function CreatePostedPanel({
  confirmation,
  publicUrl,
  onCreateAnother,
}: {
  confirmation: CreatePostedConfirmation;
  publicUrl: string | null;
  onCreateAnother: () => void;
}) {
  return (
    <div className="compact-state hosted-media-progress create-posted" role="status" data-posted-kind={confirmation.kind}>
      <span className="create-posted-mark" aria-hidden="true">✓</span>
      <strong>Posted</strong>
      {publicUrl ? (
        <a className="create-posted-link" href={publicUrl} target="_blank" rel="noreferrer">
          Open posted annotation
        </a>
      ) : (
        <span>The public annotation page is unavailable.</span>
      )}
      <button className="button button-secondary" type="button" onClick={onCreateAnother}>
        Create another
      </button>
    </div>
  );
}
