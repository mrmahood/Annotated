import {
  ANNOTATION_VERDICT_LABELS,
  type AnnotationVerdict,
} from "@annotated/shared/annotation-note";

export function VerdictPill({ verdict }: { verdict: AnnotationVerdict }) {
  return (
    <span className={`note-verdict note-verdict-${verdict}`}>
      {ANNOTATION_VERDICT_LABELS[verdict]}
    </span>
  );
}
