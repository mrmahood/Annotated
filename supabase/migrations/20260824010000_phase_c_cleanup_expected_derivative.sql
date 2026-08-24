-- Phase C C6 corrective retention contract: a derivative upload may succeed
-- before its path is staged on annotation_media. Return the deterministic path
-- separately while preserving the original row facts for stale confirmation.

create function private.claim_annotation_media_cleanup_v2(p_media_id uuid)
returns table (
  media_id uuid,
  cleanup_reason text,
  raw_storage_path text,
  processed_storage_path text,
  expected_processed_storage_path text,
  observed_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select media.id,
    case when media.processing_status in ('capture_pending', 'uploading')
      then 'abandoned_cleanup' else 'terminal_raw_cleanup' end,
    media.raw_storage_path,
    media.processed_storage_path,
    annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
      case when media.media_type = 'video' then '/excerpt.mp4' else '/excerpt.m4a' end,
    media.updated_at
  from public.annotation_media as media
  join public.annotations as annotations on annotations.id = media.annotation_id
  where media.id = p_media_id
    and (
      (media.processing_status in ('capture_pending', 'uploading')
        and media.updated_at <= pg_catalog.now() - interval '24 hours')
      or (media.processing_status = 'failed'
        and media.raw_storage_path is not null
        and media.updated_at <= pg_catalog.now() - interval '72 hours')
    )
  for update of media;
end;
$$;

revoke all on function private.claim_annotation_media_cleanup_v2(uuid)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_cleanup_v2(uuid)
  to service_role, annotated_media_worker;

comment on function private.claim_annotation_media_cleanup_v2(uuid) is
  'Claims an eligible retention row and returns both staged facts and the deterministic processed path so pre-staging derivative uploads cannot be orphaned.';
