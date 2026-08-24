-- Phase C C4: capture-metadata v2 and the bounded local worker contract.
-- Historical v1 rows remain readable, but no v1 row can be claimed for work.

create function private.jsonb_has_exact_keys(p_value jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_value)) = pg_catalog.cardinality(p_keys)
    and not exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_value) as present(key)
      where not (present.key = any (p_keys))
    );
$$;

revoke all on function private.jsonb_has_exact_keys(jsonb, text[])
  from public, anon, authenticated;

create function private.is_capture_viewport_v2(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not private.jsonb_has_exact_keys(
    p_value, array['width', 'height', 'device_pixel_ratio', 'scroll_x', 'scroll_y']
  ) then
    return false;
  end if;
  return (p_value ->> 'width')::numeric between 1 and 32768
    and (p_value ->> 'height')::numeric between 1 and 32768
    and (p_value ->> 'device_pixel_ratio')::numeric between 0.1 and 16
    and (p_value ->> 'scroll_x')::numeric between -1000000 and 1000000
    and (p_value ->> 'scroll_y')::numeric between -1000000 and 1000000;
exception when others then
  return false;
end;
$$;

revoke all on function private.is_capture_viewport_v2(jsonb)
  from public, anon, authenticated;

create function private.is_capture_rect_v2(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not private.jsonb_has_exact_keys(
    p_value, array['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']
  ) then
    return false;
  end if;
  return (p_value ->> 'width')::numeric between 1 and 32768
    and (p_value ->> 'height')::numeric between 1 and 32768
    and (p_value ->> 'x')::numeric between -100000 and 100000
    and (p_value ->> 'y')::numeric between -100000 and 100000
    and (p_value ->> 'top')::numeric between -100000 and 100000
    and (p_value ->> 'right')::numeric between -100000 and 100000
    and (p_value ->> 'bottom')::numeric between -100000 and 100000
    and (p_value ->> 'left')::numeric between -100000 and 100000;
exception when others then
  return false;
end;
$$;

revoke all on function private.is_capture_rect_v2(jsonb)
  from public, anon, authenticated;

create function private.is_worker_capture_metadata_v2(
  p_metadata jsonb,
  p_media_type text,
  p_start_ms integer,
  p_end_ms integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  track jsonb;
  audio_tracks integer := 0;
  video_tracks integer := 0;
  audio_count integer;
  video_count integer;
  timing jsonb;
begin
  if p_metadata is null
    or pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    or pg_catalog.octet_length(p_metadata::text) > 16384
    or p_media_type not in ('video', 'audio')
    or (p_metadata ->> 'version') <> '2'
    or not private.jsonb_has_exact_keys(
      p_metadata,
      case when p_media_type = 'video' then
        array['version', 'viewport', 'video_element', 'intrinsic_video', 'computed_style', 'fullscreen', 'capture_track', 'timing']
      else array['version', 'capture_track', 'timing'] end
    )
  then
    return false;
  end if;

  timing := p_metadata -> 'timing';
  if not private.jsonb_has_exact_keys(
    timing,
    array['requested_start_ms', 'requested_end_ms', 'requested_duration_ms', 'lead_in_ms',
      'recorder_elapsed_ms', 'player_start_ms', 'player_end_ms', 'lead_in_clock']
  )
    or (timing ->> 'requested_start_ms')::bigint <> p_start_ms
    or (timing ->> 'requested_end_ms')::bigint <> p_end_ms
    or (timing ->> 'requested_duration_ms')::bigint <> p_end_ms - p_start_ms
    or (timing ->> 'lead_in_ms')::numeric not between 0 and 91000
    or (timing ->> 'recorder_elapsed_ms')::numeric not between 1000 and 92000
    or (timing ->> 'lead_in_clock') <> 'offscreen_monotonic'
    or (timing -> 'player_start_ms') is null
    or (timing -> 'player_end_ms') is null
    or (pg_catalog.jsonb_typeof(timing -> 'player_start_ms') not in ('number', 'null'))
    or (pg_catalog.jsonb_typeof(timing -> 'player_end_ms') not in ('number', 'null'))
  then
    return false;
  end if;

  if not private.jsonb_has_exact_keys(
    p_metadata -> 'capture_track',
    array['mime_type', 'audio_track_count', 'video_track_count', 'tracks', 'loopback_enabled']
  )
    or pg_catalog.jsonb_typeof(p_metadata #> '{capture_track,tracks}') <> 'array'
    or pg_catalog.jsonb_typeof(p_metadata #> '{capture_track,loopback_enabled}') <> 'boolean'
    or (p_metadata #>> '{capture_track,loopback_enabled}')::boolean is not true
  then
    return false;
  end if;

  audio_count := (p_metadata #>> '{capture_track,audio_track_count}')::integer;
  video_count := (p_metadata #>> '{capture_track,video_track_count}')::integer;
  if audio_count not between 1 and 8
    or video_count not between 0 and 8
    or (p_media_type = 'video' and video_count < 1)
    or (p_media_type = 'audio' and video_count <> 0)
    or not (
      pg_catalog.lower(p_metadata #>> '{capture_track,mime_type}') like
        (case when p_media_type = 'video' then 'video/webm%' else 'audio/webm%' end)
    )
  then
    return false;
  end if;

  for track in select value from pg_catalog.jsonb_array_elements(p_metadata #> '{capture_track,tracks}')
  loop
    if not private.jsonb_has_exact_keys(
      track, array['kind', 'label', 'enabled', 'muted', 'readyState', 'settings']
    )
      or (track ->> 'kind') not in ('audio', 'video')
      or pg_catalog.jsonb_typeof(track -> 'label') <> 'string'
      or pg_catalog.char_length(track ->> 'label') > 256
      or pg_catalog.jsonb_typeof(track -> 'enabled') <> 'boolean'
      or pg_catalog.jsonb_typeof(track -> 'muted') <> 'boolean'
      or pg_catalog.jsonb_typeof(track -> 'readyState') <> 'string'
      or pg_catalog.char_length(track ->> 'readyState') > 32
      or pg_catalog.jsonb_typeof(track -> 'settings') <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(track -> 'settings')) > 32
    then
      return false;
    end if;
    if (track ->> 'kind') = 'audio' then audio_tracks := audio_tracks + 1;
    else video_tracks := video_tracks + 1;
    end if;
  end loop;
  if audio_tracks <> audio_count or video_tracks <> video_count then return false; end if;

  if p_media_type = 'video' and (
    not private.jsonb_has_exact_keys(p_metadata -> 'viewport', array['start', 'end'])
    or not private.is_capture_viewport_v2(p_metadata #> '{viewport,start}')
    or not private.is_capture_viewport_v2(p_metadata #> '{viewport,end}')
    or not private.jsonb_has_exact_keys(p_metadata -> 'video_element', array['start', 'end'])
    or not private.is_capture_rect_v2(p_metadata #> '{video_element,start}')
    or not private.is_capture_rect_v2(p_metadata #> '{video_element,end}')
    or not private.jsonb_has_exact_keys(p_metadata -> 'intrinsic_video', array['width', 'height'])
    or (p_metadata #>> '{intrinsic_video,width}')::numeric not between 1 and 32768
    or (p_metadata #>> '{intrinsic_video,height}')::numeric not between 1 and 32768
    or not private.jsonb_has_exact_keys(p_metadata -> 'computed_style', array['object_fit', 'object_position'])
    or pg_catalog.char_length(p_metadata #>> '{computed_style,object_fit}') not between 1 and 32
    or pg_catalog.char_length(p_metadata #>> '{computed_style,object_position}') not between 1 and 100
    or not private.jsonb_has_exact_keys(p_metadata -> 'fullscreen', array['start', 'end'])
    or pg_catalog.jsonb_typeof(p_metadata #> '{fullscreen,start}') <> 'boolean'
    or pg_catalog.jsonb_typeof(p_metadata #> '{fullscreen,end}') <> 'boolean'
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function private.is_worker_capture_metadata_v2(jsonb, text, integer, integer)
  from public, anon, authenticated;

create or replace function private.is_bounded_capture_metadata(p_metadata jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  metadata_key text;
begin
  if p_metadata is null
    or pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    or pg_catalog.octet_length(p_metadata::text) > 16384
    or (p_metadata ->> 'version') not in ('1', '2')
  then
    return false;
  end if;
  for metadata_key in select key from pg_catalog.jsonb_object_keys(p_metadata) as keys(key)
  loop
    if metadata_key not in (
      'version', 'viewport', 'video_element', 'intrinsic_video',
      'computed_style', 'fullscreen', 'capture_track', 'timing'
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function private.is_bounded_capture_metadata(jsonb)
  from public, anon, authenticated;

create or replace function private.mark_annotation_media_uploading(
  p_media_id uuid,
  p_raw_storage_path text,
  p_raw_mime_type text,
  p_raw_byte_size bigint,
  p_capture_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
  owner_id uuid;
  target_start integer;
  target_end integer;
  expected_prefix text;
begin
  select annotation_media.* into media_row
  from public.annotation_media
  where annotation_media.id = p_media_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'The hosted media row does not exist.';
  end if;
  if media_row.processing_status not in ('capture_pending', 'failed')
    or (media_row.processing_status = 'failed' and media_row.processed_storage_path is not null)
  then
    raise exception using errcode = '55000', message = 'The hosted media row is not awaiting a raw upload.';
  end if;

  select annotations.user_id, targets.start_ms, targets.end_ms
  into owner_id, target_start, target_end
  from public.annotations
  join public.annotation_targets as targets on targets.annotation_id = annotations.id
  where annotations.id = media_row.annotation_id
    and annotations.status = 'draft'
    and targets.target_type = 'time_range';
  if owner_id is null then
    raise exception using errcode = '55000', message = 'The hosted annotation target is unavailable.';
  end if;
  if not private.is_worker_capture_metadata_v2(
    p_capture_metadata, media_row.media_type, target_start, target_end
  ) then
    raise exception using errcode = '22023', message = 'Capture metadata v2 is required; recapture this range.';
  end if;

  expected_prefix := owner_id::text || '/' || media_row.annotation_id::text || '/' || media_row.id::text || '/';
  if p_raw_storage_path is null or p_raw_storage_path !~ (
    '^' || expected_prefix || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webm$'
  ) then
    raise exception using errcode = '22023', message = 'The raw storage path is invalid for this hosted annotation.';
  end if;
  if (media_row.media_type = 'video' and p_raw_mime_type <> 'video/webm')
    or (media_row.media_type = 'audio' and p_raw_mime_type <> 'audio/webm')
  then
    raise exception using errcode = '22023', message = 'The raw MIME type does not match the hosted media type.';
  end if;
  if p_raw_byte_size is null or p_raw_byte_size < 1 or p_raw_byte_size > 52428800
    or (media_row.media_type = 'audio' and p_raw_byte_size > 16777216)
  then
    raise exception using errcode = '22023', message = 'The raw media size is outside the accepted limit.';
  end if;

  delete from public.annotation_transcripts where annotation_id = media_row.annotation_id;
  update public.annotation_media
  set processing_status = 'uploading', processing_stage = null,
    capture_metadata = p_capture_metadata, raw_storage_path = p_raw_storage_path,
    raw_mime_type = p_raw_mime_type, raw_byte_size = p_raw_byte_size,
    raw_checksum_sha256 = null, processed_storage_path = null, processed_mime_type = null,
    duration_ms = null, width = null, height = null, byte_size = null, checksum_sha256 = null,
    processed_at = null, raw_deleted_at = null, failure_stage = null, failure_code = null,
    attempt_count = 0, next_attempt_at = null, lease_token = null, lease_expires_at = null
  where id = p_media_id;
end;
$$;

revoke all on function private.mark_annotation_media_uploading(uuid, text, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function private.mark_annotation_media_uploading(uuid, text, text, bigint, jsonb)
  to service_role;

create or replace function private.accept_annotation_media_upload(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.annotation_media
  set processing_status = 'processing', processing_stage = 'queued', uploaded_at = pg_catalog.now(),
    next_attempt_at = pg_catalog.now(), failure_stage = null, failure_code = null,
    lease_token = null, lease_expires_at = null
  where id = p_media_id and processing_status = 'uploading'
    and raw_storage_path is not null and raw_mime_type is not null and raw_byte_size is not null
    and (capture_metadata ->> 'version') = '2';
  if not found then
    raise exception using errcode = '55000', message = 'Capture metadata v2 and a verified raw upload are required before processing.';
  end if;
end;
$$;

revoke all on function private.accept_annotation_media_upload(uuid)
  from public, anon, authenticated;
grant execute on function private.accept_annotation_media_upload(uuid)
  to service_role;

drop function private.claim_annotation_media_processing(uuid, integer);

create function private.claim_annotation_media_processing(
  p_media_id uuid,
  p_lease_seconds integer default 600
)
returns table (
  media_id uuid, annotation_id uuid, media_type text,
  target_start_ms integer, target_end_ms integer, expected_processed_storage_path text,
  resume_stage text, capture_metadata jsonb,
  raw_storage_path text, raw_mime_type text, raw_byte_size bigint, raw_checksum_sha256 text,
  processed_storage_path text, processed_mime_type text, duration_ms integer,
  width integer, height integer, byte_size bigint, checksum_sha256 text,
  transcript_present boolean, raw_deleted_at timestamptz,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 60 and 3600 then
    raise exception using errcode = '22023', message = 'The processing lease must be between 60 and 3,600 seconds.';
  end if;

  update public.annotation_media as legacy
  set processing_status = 'failed', processing_stage = null,
    failure_stage = 'probing', failure_code = 'recapture_required',
    next_attempt_at = null, lease_token = null, lease_expires_at = null
  where legacy.id = p_media_id and legacy.processing_status = 'processing'
    and (legacy.capture_metadata ->> 'version') is distinct from '2';
  if found then return; end if;

  return query
  with candidate as (
    select media.id, annotations.user_id, targets.start_ms, targets.end_ms,
      exists (
        select 1 from public.annotation_transcripts as transcript
        where transcript.annotation_id = media.annotation_id
      ) as has_transcript
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id and annotations.status = 'draft'
    join public.annotation_targets as targets on targets.annotation_id = media.annotation_id and targets.target_type = 'time_range'
    where media.id = p_media_id and media.processing_status = 'processing'
      and media.attempt_count < 3 and media.created_at > pg_catalog.now() - interval '72 hours'
      and (media.next_attempt_at is null or media.next_attempt_at <= pg_catalog.now())
      and (media.lease_token is null or media.lease_expires_at <= pg_catalog.now())
      and (media.raw_storage_path is not null or media.processed_storage_path is not null)
    for update of media
  ), updated as (
    update public.annotation_media as media
    set processing_stage = case
        when media.raw_deleted_at is not null then 'finalizing'
        when candidate.has_transcript then 'raw_cleanup'
        when media.processed_storage_path is not null then 'transcribing'
        else 'probing'
      end,
      lease_token = pg_catalog.gen_random_uuid(),
      lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = (media.attempt_count + 1)::smallint,
      next_attempt_at = null, failure_stage = null, failure_code = null
    from candidate where media.id = candidate.id
    returning media.*, candidate.user_id, candidate.start_ms, candidate.end_ms, candidate.has_transcript
  )
  select updated.id, updated.annotation_id, updated.media_type,
    updated.start_ms, updated.end_ms,
    updated.user_id::text || '/' || updated.annotation_id::text || '/' || updated.id::text ||
      case when updated.media_type = 'video' then '/excerpt.mp4' else '/excerpt.m4a' end,
    updated.processing_stage, updated.capture_metadata,
    updated.raw_storage_path, updated.raw_mime_type, updated.raw_byte_size, updated.raw_checksum_sha256,
    updated.processed_storage_path, updated.processed_mime_type, updated.duration_ms,
    updated.width, updated.height, updated.byte_size, updated.checksum_sha256,
    updated.has_transcript, updated.raw_deleted_at,
    updated.lease_token, updated.lease_expires_at, updated.attempt_count
  from updated;
end;
$$;

revoke all on function private.claim_annotation_media_processing(uuid, integer)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_processing(uuid, integer)
  to service_role;

create function private.release_annotation_media_processing_attempt(
  p_media_id uuid, p_lease_token uuid, p_failure_stage text, p_failure_code text
)
returns table (result_status text, retry_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
  terminal boolean;
  scheduled_at timestamptz;
  delay_seconds integer;
begin
  if p_failure_stage is null or p_failure_stage !~ '^[a-z0-9_]{1,50}$'
    or p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{1,100}$'
  then
    raise exception using errcode = '22023', message = 'Failure stage and code must be sanitized identifiers.';
  end if;
  select * into media_row from public.annotation_media
  where id = p_media_id for update;
  if not found or media_row.processing_status <> 'processing'
    or media_row.lease_token is distinct from p_lease_token
    or media_row.lease_expires_at <= pg_catalog.now()
  then
    raise exception using errcode = '55000', message = 'The processing lease is unavailable or expired.';
  end if;

  terminal := media_row.attempt_count >= 3
    or media_row.created_at <= pg_catalog.now() - interval '72 hours';
  if terminal then
    update public.annotation_media
    set processing_status = 'failed', processing_stage = null,
      failure_stage = p_failure_stage,
      failure_code = case when media_row.created_at <= pg_catalog.now() - interval '72 hours'
        then 'processing_deadline_exceeded' else p_failure_code end,
      next_attempt_at = null, lease_token = null, lease_expires_at = null
    where id = p_media_id;
    return query select 'failed'::text, null::timestamptz;
    return;
  end if;

  delay_seconds := least(900, 30 * (4 ^ greatest(media_row.attempt_count - 1, 0)))::integer
    + pg_catalog.mod(pg_catalog.get_byte(pg_catalog.uuid_send(media_row.id), 0) + media_row.attempt_count, 31);
  scheduled_at := pg_catalog.now() + pg_catalog.make_interval(secs => delay_seconds);
  update public.annotation_media
  set processing_stage = 'queued', failure_stage = p_failure_stage, failure_code = p_failure_code,
    next_attempt_at = scheduled_at, lease_token = null, lease_expires_at = null
  where id = p_media_id;
  return query select 'processing'::text, scheduled_at;
end;
$$;

revoke all on function private.release_annotation_media_processing_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.release_annotation_media_processing_attempt(uuid, uuid, text, text)
  to service_role;

create or replace function private.retry_annotation_media_processing(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.annotation_media
  set processing_status = 'processing', processing_stage = 'queued',
    failure_stage = null, failure_code = null, attempt_count = 0,
    next_attempt_at = pg_catalog.now(), lease_token = null, lease_expires_at = null
  where id = p_media_id and processing_status = 'failed'
    and failure_code <> 'recapture_required'
    and (raw_storage_path is not null or processed_storage_path is not null);
  if not found then
    raise exception using errcode = '55000', message = 'The failed hosted media row is not retryable without recapture.';
  end if;
end;
$$;

revoke all on function private.retry_annotation_media_processing(uuid)
  from public, anon, authenticated;
grant execute on function private.retry_annotation_media_processing(uuid)
  to service_role;

create function private.list_annotation_media_dispatch_candidates(p_limit integer default 100)
returns table (media_id uuid, next_attempt_at timestamptz, attempt_count smallint, resume_stage text)
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
  select media.id, media.next_attempt_at, media.attempt_count,
    case when (media.capture_metadata ->> 'version') is distinct from '2' then 'probing'
      when media.raw_deleted_at is not null then 'finalizing'
      when exists (
        select 1 from public.annotation_transcripts as transcript
        where transcript.annotation_id = media.annotation_id
      ) then 'raw_cleanup'
      when media.processed_storage_path is not null then 'transcribing' else 'probing' end
  from public.annotation_media as media
  where media.processing_status = 'processing' and media.attempt_count < 3
    and media.created_at > pg_catalog.now() - interval '72 hours'
    and (media.next_attempt_at is null or media.next_attempt_at <= pg_catalog.now())
    and (media.lease_token is null or media.lease_expires_at <= pg_catalog.now())
  order by coalesce(media.next_attempt_at, media.created_at), media.created_at, media.id
  limit p_limit;
end;
$$;

revoke all on function private.list_annotation_media_dispatch_candidates(integer)
  from public, anon, authenticated;
grant execute on function private.list_annotation_media_dispatch_candidates(integer)
  to service_role;

create function private.list_annotation_media_reconciliation_candidates(p_limit integer default 100)
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
      when media.processing_status in ('capture_pending', 'uploading') and media.updated_at <= pg_catalog.now() - interval '24 hours'
        then 'abandoned_cleanup'
      when media.processing_status = 'failed' and media.raw_storage_path is not null
        and media.updated_at <= pg_catalog.now() - interval '72 hours'
        then 'terminal_raw_cleanup'
    end,
    media.attempt_count,
    case when media.processing_status in ('capture_pending', 'uploading') then media.updated_at + interval '24 hours'
      when media.processing_status = 'failed' then media.updated_at + interval '72 hours'
      else coalesce(media.lease_expires_at, media.created_at + interval '72 hours') end
  from public.annotation_media as media
  where (media.processing_status = 'processing' and (
      (media.capture_metadata ->> 'version') is distinct from '2'
      or media.created_at <= pg_catalog.now() - interval '72 hours'
      or media.attempt_count >= 3
      or media.lease_expires_at <= pg_catalog.now()
    ))
    or (media.processing_status in ('capture_pending', 'uploading') and media.updated_at <= pg_catalog.now() - interval '24 hours')
    or (media.processing_status = 'failed' and media.raw_storage_path is not null
      and media.updated_at <= pg_catalog.now() - interval '72 hours')
  order by 4, media.id
  limit p_limit;
end;
$$;

revoke all on function private.list_annotation_media_reconciliation_candidates(integer)
  from public, anon, authenticated;
grant execute on function private.list_annotation_media_reconciliation_candidates(integer)
  to service_role;

create function private.claim_annotation_media_cleanup(p_media_id uuid)
returns table (
  media_id uuid,
  cleanup_reason text,
  raw_storage_path text,
  processed_storage_path text,
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
    media.raw_storage_path, media.processed_storage_path, media.updated_at
  from public.annotation_media as media
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

revoke all on function private.claim_annotation_media_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_cleanup(uuid)
  to service_role;

create function private.confirm_annotation_media_cleanup(
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
        and media_row.raw_storage_path is not null
        and media_row.updated_at <= pg_catalog.now() - interval '72 hours')
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
    removed_at = pg_catalog.now(), next_attempt_at = null,
    lease_token = null, lease_expires_at = null
  where id = p_media_id;
  return 'removed';
end;
$$;

revoke all on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  to service_role;

create function private.reconcile_annotation_media_processing(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
  action text;
begin
  select * into media_row from public.annotation_media where id = p_media_id for update;
  if not found or media_row.processing_status <> 'processing' then
    raise exception using errcode = '55000', message = 'The processing row is not reconcilable.';
  end if;
  if (media_row.capture_metadata ->> 'version') is distinct from '2' then
    action := 'recapture_required';
  elsif media_row.created_at <= pg_catalog.now() - interval '72 hours' then
    action := 'processing_deadline_exceeded';
  elsif media_row.attempt_count >= 3 then
    action := 'attempts_exhausted';
  elsif media_row.lease_expires_at <= pg_catalog.now() then
    update public.annotation_media
    set processing_stage = 'queued', next_attempt_at = pg_catalog.now(),
      failure_stage = 'reconciliation', failure_code = 'lease_expired',
      lease_token = null, lease_expires_at = null
    where id = p_media_id;
    return 'lease_released';
  else
    raise exception using errcode = '55000', message = 'The processing row is not yet eligible for reconciliation.';
  end if;

  update public.annotation_media
  set processing_status = 'failed', processing_stage = null,
    failure_stage = 'reconciliation', failure_code = action,
    next_attempt_at = null, lease_token = null, lease_expires_at = null
  where id = p_media_id;
  return action;
end;
$$;

revoke all on function private.reconcile_annotation_media_processing(uuid)
  from public, anon, authenticated;
grant execute on function private.reconcile_annotation_media_processing(uuid)
  to service_role;
