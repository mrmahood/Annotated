import { parseAnnotationConsensus, type AnnotationConsensus } from "@annotated/shared/annotation-note";
import { isUuid } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/server";

export async function getAnnotationConsensus(
  annotationId: string,
): Promise<AnnotationConsensus | null> {
  if (!isUuid(annotationId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_annotation_consensus", {
      p_annotation_id: annotationId,
    });
    if (error) return null;
    return parseAnnotationConsensus(data);
  } catch {
    return null;
  }
}
