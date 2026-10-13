import {
  ANNOTATION_NOTE_TYPE_LABELS,
  type AnnotationNoteType,
} from "@annotated/shared/annotation-note";

export function AnnotationTypeLabel({ noteType }: { noteType: AnnotationNoteType }) {
  return <span className="note-type">{ANNOTATION_NOTE_TYPE_LABELS[noteType]}</span>;
}
