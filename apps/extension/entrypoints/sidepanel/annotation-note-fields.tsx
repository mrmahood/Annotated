import {
  ANNOTATION_NOTE_TYPE_LABELS,
  ANNOTATION_NOTE_TYPES,
  ANNOTATION_SOURCE_URL_LIMIT,
  ANNOTATION_VERDICT_LABELS,
  ANNOTATION_VERDICTS,
  getAnnotationNoteError,
  noteTypeRequiresSourceLinks,
  noteTypeRequiresVerdict,
  type AnnotationNoteType,
  type AnnotationVerdict,
} from '@annotated/shared/annotation-note';

export type AnnotationNoteDraft = {
  noteType: AnnotationNoteType | '';
  verdict: AnnotationVerdict | '';
  sourceUrls: string[];
};

export const EMPTY_ANNOTATION_NOTE_DRAFT: AnnotationNoteDraft = {
  noteType: '',
  verdict: '',
  sourceUrls: [''],
};

export function AnnotationNoteFields({
  idPrefix,
  draft,
  disabled,
  onChange,
}: {
  idPrefix: string;
  draft: AnnotationNoteDraft;
  disabled: boolean;
  onChange: (draft: AnnotationNoteDraft) => void;
}) {
  const error = getAnnotationNoteError(draft);
  const urls = draft.sourceUrls.length > 0 ? draft.sourceUrls : [''];

  return (
    <fieldset className="annotation-note-fields" disabled={disabled}>
      <legend className="visually-hidden">Annotation type</legend>
      <div className="annotation-field">
        <label htmlFor={`${idPrefix}-note-type`}>Annotation type</label>
        <select
          id={`${idPrefix}-note-type`}
          value={draft.noteType}
          onChange={(event) => onChange({
            ...draft,
            noteType: event.target.value as AnnotationNoteDraft['noteType'],
          })}
        >
          <option value="">Choose a type</option>
          {ANNOTATION_NOTE_TYPES.map((noteType) => (
            <option key={noteType} value={noteType}>{ANNOTATION_NOTE_TYPE_LABELS[noteType]}</option>
          ))}
        </select>
      </div>
      <div className="annotation-field">
        <label htmlFor={`${idPrefix}-verdict`}>
          Verdict{draft.noteType && noteTypeRequiresVerdict(draft.noteType) ? '' : ' (optional)'}
        </label>
        <select
          id={`${idPrefix}-verdict`}
          value={draft.verdict}
          onChange={(event) => onChange({
            ...draft,
            verdict: event.target.value as AnnotationNoteDraft['verdict'],
          })}
        >
          <option value="">{draft.noteType && noteTypeRequiresVerdict(draft.noteType) ? 'Choose a verdict' : 'No verdict'}</option>
          {ANNOTATION_VERDICTS.map((verdict) => (
            <option key={verdict} value={verdict}>{ANNOTATION_VERDICT_LABELS[verdict]}</option>
          ))}
        </select>
      </div>
      <div className="annotation-field">
        <span id={`${idPrefix}-sources-label`}>Source links</span>
        {urls.map((url, index) => (
          <input
            key={`${idPrefix}-source-${index}`}
            aria-labelledby={`${idPrefix}-sources-label`}
            type="url"
            inputMode="url"
            placeholder="https://"
            maxLength={2_000}
            value={url}
            onChange={(event) => {
              const sourceUrls = [...urls];
              sourceUrls[index] = event.target.value;
              onChange({ ...draft, sourceUrls });
            }}
          />
        ))}
        {urls.length < ANNOTATION_SOURCE_URL_LIMIT && (
          <button
            className="text-button"
            type="button"
            onClick={() => onChange({ ...draft, sourceUrls: [...urls, ''] })}
          >
            Add source link
          </button>
        )}
        <span className="field-hint">
          {draft.noteType && noteTypeRequiresSourceLinks(draft.noteType)
            ? 'Add at least one source link.'
            : 'Optional unless this is a fact check or receipts.'}
        </span>
      </div>
      {error && draft.noteType ? (
        <p className="inline-error" role="status">{error}</p>
      ) : error ? (
        <p className="field-hint">{error}</p>
      ) : null}
    </fieldset>
  );
}
