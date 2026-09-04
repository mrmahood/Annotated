-- Align private.stage_annotation_media_derivative duration bounds with the
-- worker JS gate. DERIVATIVE_DURATION_TOLERANCE_MS is 22: one AAC-LC frame at
-- 48 kHz (1024 samples ≈ 21.333 ms). ffmpeg -ss after -i plus -t can emit one
-- extra frame, so a correct encode may persist a few milliseconds past the
-- selected range (for example 9300 vs a 9295 ms target). JS+SQL slack is that
-- single AAC-LC frame, not a multi-second overshoot allowance. Absolute
-- hosted bounds remain 1000..90000 ms.

create or replace function private.stage_annotation_media_derivative(
  p_media_id uuid,
  p_lease_token uuid,
  p_raw_checksum_sha256 text,
  p_processed_storage_path text,
  p_processed_mime_type text,
  p_duration_ms integer,
  p_width integer,
  p_height integer,
  p_byte_size bigint,
  p_checksum_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
  owner_id uuid;
  target_duration integer;
  expected_path text;
begin
  select annotation_media.*
  into media_row
  from public.annotation_media
  where annotation_media.id = p_media_id
  for update;

  if not found
    or media_row.processing_status <> 'processing'
    or media_row.lease_token is distinct from p_lease_token
    or media_row.lease_expires_at <= pg_catalog.now()
  then
    raise exception using errcode = '55000', message = 'The processing lease is unavailable or expired.';
  end if;

  select annotations.user_id, targets.end_ms - targets.start_ms
  into owner_id, target_duration
  from public.annotations
  join public.annotation_targets as targets
    on targets.annotation_id = annotations.id
  where annotations.id = media_row.annotation_id
    and annotations.status = 'draft'
    and targets.target_type = 'time_range';

  if owner_id is null then
    raise exception using errcode = '55000', message = 'The hosted annotation target is unavailable.';
  end if;

  expected_path := owner_id::text || '/' || media_row.annotation_id::text || '/' || media_row.id::text ||
    case when media_row.media_type = 'video' then '/excerpt.mp4' else '/excerpt.m4a' end;

  if p_processed_storage_path is distinct from expected_path then
    raise exception using errcode = '22023', message = 'The processed storage path is invalid for this hosted annotation.';
  end if;
  if p_raw_checksum_sha256 is null or p_raw_checksum_sha256 !~ '^[0-9a-f]{64}$'
    or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'Media checksums must be lowercase SHA-256 values.';
  end if;
  -- JS+SQL slack is 22 ms (one AAC-LC frame), clamped to 1000..90000.
  if p_duration_ms is null
    or p_duration_ms not between 1000 and 90000
    or p_duration_ms < greatest(1000, target_duration - 22)
    or p_duration_ms > least(90000, target_duration + 22)
  then
    raise exception using errcode = '22023', message = 'Processed duration is invalid for the requested hosted range.';
  end if;
  if (media_row.media_type = 'video' and (
      p_processed_mime_type <> 'video/mp4'
      or p_width is null or p_width not between 2 and 8192
      or p_height is null or p_height not between 2 and 8192
      or p_byte_size is null or p_byte_size not between 1 and 16777216
    )) or (media_row.media_type = 'audio' and (
      p_processed_mime_type <> 'audio/mp4'
      or p_width is not null or p_height is not null
      or p_byte_size is null or p_byte_size not between 1 and 8388608
    ))
  then
    raise exception using errcode = '22023', message = 'Processed media metadata does not match the hosted media type.';
  end if;

  update public.annotation_media
  set
    processing_stage = 'transcribing',
    raw_checksum_sha256 = p_raw_checksum_sha256,
    processed_storage_path = p_processed_storage_path,
    processed_mime_type = p_processed_mime_type,
    duration_ms = p_duration_ms,
    width = p_width,
    height = p_height,
    byte_size = p_byte_size,
    checksum_sha256 = p_checksum_sha256,
    processed_at = pg_catalog.now(),
    failure_stage = null,
    failure_code = null
  where id = p_media_id;
end;
$$;

revoke all on function private.stage_annotation_media_derivative(
  uuid, uuid, text, text, text, integer, integer, integer, bigint, text
) from public, anon, authenticated, service_role;
grant execute on function private.stage_annotation_media_derivative(
  uuid, uuid, text, text, text, integer, integer, integer, bigint, text
) to annotated_media_worker;

comment on function private.stage_annotation_media_derivative(
  uuid, uuid, text, text, text, integer, integer, integer, bigint, text
) is 'Worker-only idempotent staging of a final derivative whose duration matches the authoritative hosted range within the JS+SQL 22 ms slack of one AAC-LC frame, still clamped to 1000..90000 ms.';
