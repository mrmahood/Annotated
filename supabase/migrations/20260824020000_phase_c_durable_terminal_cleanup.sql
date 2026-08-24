-- Phase C corrective retention contract: user cancellation suppresses access
-- immediately, but private-object cleanup remains durable until Storage absence
-- is confirmed. Terminal processing rows are also cleanup-eligible when raw was
-- already deleted but a processed derivative or transcript remains.

create or replace function private.list_annotation_media_reconciliation_candidates(
  p_limit integer default 100
)
returns table (media_id uuid, reconciliation_action text, attempt_count smallint, eligible_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Candidate limit must be between 1 and 500.';
  end if;
  return query
  select media.id,
    case
      when media.processing_status = 'processing' and (media.capture_metadata ->> 'version') is distinct from '2'
        then 'recapture_required'
      when media.processing_status = 'processing' and media.created_at <= pg_catalog.now() - interval '72 hours'
        then 'processing_deadline_exceeded'
      when media.processing_status = 'processing' and media.attempt_count >= 3
        then 'attempts_exhausted'
      when media.processing_status = 'processing' and media.lease_expires_at <= pg_catalog.now()
        then 'lease_expired'
      when media.processing_status = 'removed'
        then 'removed_cleanup'
      when media.processing_status in ('capture_pending', 'uploading')
        then 'abandoned_cleanup'
      when media.processing_status = 'failed'
        then 'terminal_raw_cleanup'
    end,
    media.attempt_count,
    case
      when media.processing_status = 'removed' then media.updated_at
      when media.processing_status in ('capture_pending', 'uploading') then media.updated_at + interval '24 hours'
      when media.processing_status = 'failed' then media.updated_at + interval '72 hours'
      else coalesce(media.lease_expires_at, media.created_at + interval '72 hours')
    end
  from public.annotation_media as media
  where (media.processing_status = 'processing' and (
      (media.capture_metadata ->> 'version') is distinct from '2'
      or media.created_at <= pg_catalog.now() - interval '72 hours'
      or media.attempt_count >= 3
      or media.lease_expires_at <= pg_catalog.now()
    ))
    or (media.processing_status in ('capture_pending', 'uploading')
      and media.updated_at <= pg_catalog.now() - interval '24 hours')
    or (media.processing_status = 'failed'
      and media.updated_at <= pg_catalog.now() - interval '72 hours'
      and (
        media.raw_storage_path is not null
        or media.processed_storage_path is not null
        or exists (
          select 1 from public.annotation_transcripts as transcript
          where transcript.annotation_id = media.annotation_id
        )
      ))
    or (media.processing_status = 'removed' and (
      media.raw_storage_path is not null
      or media.processed_storage_path is not null
      or exists (
        select 1 from public.annotation_transcripts as transcript
        where transcript.annotation_id = media.annotation_id
      )
    ))
  order by 4, media.id
  limit p_limit;
end;
$$;

revoke all on function private.list_annotation_media_reconciliation_candidates(integer)
  from public, anon, authenticated;
grant execute on function private.list_annotation_media_reconciliation_candidates(integer)
  to service_role, annotated_media_worker;

create or replace function private.claim_annotation_media_cleanup_v2(p_media_id uuid)
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
    case
      when media.processing_status = 'removed' then 'removed_cleanup'
      when media.processing_status in ('capture_pending', 'uploading') then 'abandoned_cleanup'
      else 'terminal_raw_cleanup'
    end,
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
        and media.updated_at <= pg_catalog.now() - interval '72 hours'
        and (
          media.raw_storage_path is not null
          or media.processed_storage_path is not null
          or exists (
            select 1 from public.annotation_transcripts as transcript
            where transcript.annotation_id = media.annotation_id
          )
        ))
      or (media.processing_status = 'removed' and (
        media.raw_storage_path is not null
        or media.processed_storage_path is not null
        or exists (
          select 1 from public.annotation_transcripts as transcript
          where transcript.annotation_id = media.annotation_id
        )
      ))
    )
  for update of media;
end;
$$;

revoke all on function private.claim_annotation_media_cleanup_v2(uuid)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_cleanup_v2(uuid)
  to service_role, annotated_media_worker;

create or replace function private.confirm_annotation_media_cleanup(
  p_media_id uuid,
  p_expected_raw_storage_path text,
  p_expected_processed_storage_path text,
  p_observed_updated_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
begin
  select * into media_row
  from public.annotation_media
  where id = p_media_id
  for update;
  if not found
    or media_row.updated_at is distinct from p_observed_updated_at
    or media_row.raw_storage_path is distinct from p_expected_raw_storage_path
    or media_row.processed_storage_path is distinct from p_expected_processed_storage_path
    or not (
      (media_row.processing_status in ('capture_pending', 'uploading')
        and media_row.updated_at <= pg_catalog.now() - interval '24 hours')
      or (media_row.processing_status = 'failed'
        and media_row.updated_at <= pg_catalog.now() - interval '72 hours'
        and (
          media_row.raw_storage_path is not null
          or media_row.processed_storage_path is not null
          or exists (
            select 1 from public.annotation_transcripts as transcript
            where transcript.annotation_id = media_row.annotation_id
          )
        ))
      or (media_row.processing_status = 'removed' and (
        media_row.raw_storage_path is not null
        or media_row.processed_storage_path is not null
        or exists (
          select 1 from public.annotation_transcripts as transcript
          where transcript.annotation_id = media_row.annotation_id
        )
      ))
    )
  then
    raise exception using errcode = '55000', message = 'The cleanup claim is stale or unavailable.';
  end if;

  delete from public.annotation_transcripts
  where annotation_transcripts.annotation_id = media_row.annotation_id;
  update public.annotation_media
  set processing_status = 'removed', processing_stage = null,
    raw_storage_path = null, raw_mime_type = null, raw_byte_size = null,
    raw_checksum_sha256 = null,
    processed_storage_path = null, processed_mime_type = null,
    duration_ms = null, width = null, height = null, byte_size = null,
    checksum_sha256 = null, processed_at = null,
    raw_deleted_at = case when media_row.raw_storage_path is not null
      then pg_catalog.now() else media_row.raw_deleted_at end,
    removed_at = coalesce(media_row.removed_at, pg_catalog.now()),
    next_attempt_at = null, lease_token = null, lease_expires_at = null
  where id = p_media_id;
  return 'removed';
end;
$$;

revoke all on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  to service_role, annotated_media_worker;

comment on function private.list_annotation_media_reconciliation_candidates(integer) is
  'Returns bounded processing and retention work, including immediate removed-state cleanup and processed-only terminal cleanup.';
comment on function private.claim_annotation_media_cleanup_v2(uuid) is
  'Claims abandoned, terminal, or removed private artifacts and derives the deterministic processed path for confirmed deletion.';
comment on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz) is
  'Stale-guarded cleanup confirmation that clears private references and transcripts while preserving an existing removal timestamp.';
