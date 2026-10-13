import { buildXPostIntentUrl } from '@annotated/shared/x-intent';
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
  const postToXUrl = publicUrl
    ? buildXPostIntentUrl({ take: confirmation.take, permalink: publicUrl })
    : null;
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
      {postToXUrl ? (
        <a className="button button-secondary create-posted-x" href={postToXUrl} target="_blank" rel="noopener noreferrer">
          Post to X
        </a>
      ) : null}
      <button className="button button-secondary" type="button" onClick={onCreateAnother}>
        Create another
      </button>
    </div>
  );
}
