-- Reject an expired processing lease in raw-deletion confirmation and
-- transcript finalization. The other worker write RPCs already require
-- lease_expires_at > now(). Equality with now() is expired.

create or replace function private.confirm_annotation_media_raw_deleted(
  p_media_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.annotation_media as media
  set
    raw_storage_path = null,
    raw_deleted_at = coalesce(media.raw_deleted_at, pg_catalog.now()),
    processing_stage = case
      when exists (
        select 1
        from public.annotation_transcripts
        where annotation_transcripts.annotation_id = media.annotation_id
      ) then 'finalizing'
      else 'transcribing'
    end
  where media.id = p_media_id
    and media.processing_status = 'processing'
    and media.lease_token = p_lease_token
    and media.lease_expires_at > pg_catalog.now()
    and media.processed_storage_path is not null
    and media.processed_at is not null;

  if not found then
    raise exception using errcode = '55000', message = 'Processed media and an active lease are required before raw deletion can be confirmed.';
  end if;
end;
$$;

comment on function private.confirm_annotation_media_raw_deleted(uuid, uuid) is
  'Clears the raw path after the derivative exists and the lease is still unexpired. Transcript presence only chooses the next stage.';

revoke all on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  to service_role, annotated_media_worker;

create or replace function private.finalize_annotation_media_ready(
  p_media_id uuid,
  p_lease_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_annotation_id uuid;
begin
  update public.annotation_media as media
  set
    processing_status = 'ready',
    processing_stage = null,
    next_attempt_at = null,
    failure_stage = null,
    failure_code = null,
    lease_token = null,
    lease_expires_at = null
  where media.id = p_media_id
    and media.processing_status in ('processing', 'ready')
    and media.processing_stage = 'finalizing'
    and media.lease_token = p_lease_token
    and media.lease_expires_at > pg_catalog.now()
    and media.raw_storage_path is null
    and media.raw_deleted_at is not null
    and media.processed_storage_path is not null
    and media.processed_mime_type is not null
    and media.duration_ms between 1000 and 90000
    and media.byte_size is not null
    and media.checksum_sha256 is not null
    and media.processed_at is not null
    and private.annotation_transcript_content_present(media.annotation_id)
  returning media.annotation_id into v_annotation_id;

  if v_annotation_id is null then
    raise exception using errcode = '55000', message = 'Hosted media is not ready for transcript finalization.';
  end if;

  update public.annotations
  set
    status = 'published',
    published_at = coalesce(published_at, pg_catalog.now())
  where id = v_annotation_id
    and status = 'draft';

  if not found and not exists (
    select 1
    from public.annotations
    where id = v_annotation_id
      and status = 'published'
  ) then
    raise exception using errcode = '55000', message = 'The hosted annotation is not a publishable draft.';
  end if;

  return v_annotation_id;
end;
$$;

comment on function private.finalize_annotation_media_ready(uuid, uuid) is
  'Clears the worker lease after the excerpt transcript is staged and the lease is still unexpired. Publication itself happens when the excerpt becomes playable.';

revoke all on function private.finalize_annotation_media_ready(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.finalize_annotation_media_ready(uuid, uuid)
  to service_role, annotated_media_worker;
