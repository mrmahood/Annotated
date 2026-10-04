-- Publish a hosted annotation once the playable excerpt exists and raw deletion
-- is confirmed. Transcription continues under the same lease and does not gate
-- the feed. A true geometry failure is terminal on the first attempt.
--
-- annotation_media_ready_shape_check originally required a null stage and a
-- null lease. That made "ready" mean "fully finished," so the feed could not
-- see a playable excerpt until transcription cleared the lease. A ready row
-- may now keep a lease and a transcription stage. Derivative facts, confirmed
-- raw deletion, and removed_at stay required.

alter table public.annotation_media
  drop constraint annotation_media_ready_shape_check;

alter table public.annotation_media
  add constraint annotation_media_ready_shape_check check (
    processing_status <> 'ready'
    or (
      (
        processing_stage is null
        or processing_stage in ('queued', 'transcribing', 'finalizing')
      )
      and raw_storage_path is null
      and raw_deleted_at is not null
      and processed_storage_path is not null
      and processed_mime_type is not null
      and duration_ms between 1000 and 90000
      and byte_size is not null
      and checksum_sha256 is not null
      and processed_at is not null
      and removed_at is null
      and (
        media_type = 'audio'
        or (width is not null and height is not null)
      )
    )
  );

create or replace function private.guard_hosted_annotation_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hosted_media_id uuid;
begin
  if new.annotation_type not in ('video_clip', 'audio_clip')
    or new.status <> 'published'
    or (tg_op = 'UPDATE' and old.status = 'published')
  then
    return new;
  end if;

  select annotation_media.id
  into hosted_media_id
  from public.annotation_media
  where annotation_media.annotation_id = new.id;

  -- A media annotation without an annotation_media row is the grandfathered
  -- time-code-only workflow. Hosted rows are always draft-first and guarded.
  if hosted_media_id is null then
    return new;
  end if;

  if new.commentary_text is not null
    and pg_catalog.char_length(new.commentary_text) > 2000
  then
    raise exception using
      errcode = '23514',
      message = 'Required commentary must be present before hosted publication.';
  end if;

  if (
    new.commentary_text is null
    or pg_catalog.btrim(new.commentary_text) = ''
  ) and not exists (
    select 1
    from public.annotation_audio
    where annotation_audio.annotation_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Required commentary must be present before hosted publication.';
  end if;

  -- F3 unhide: hidden → published may keep F4-removed media. Do not rebuild
  -- derivatives or restore cleared transcript content.
  if tg_op = 'UPDATE' and old.status = 'hidden' then
    if not private.hosted_media_allows_published_return(new.id) then
      raise exception using
        errcode = '23514',
        message = 'Hosted media must be ready or already removed before an annotation can return to published.';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.annotation_media
    where annotation_media.id = hosted_media_id
      and annotation_media.processing_status = 'ready'
      and annotation_media.processed_storage_path is not null
      and annotation_media.processed_mime_type is not null
      and annotation_media.duration_ms between 1000 and 90000
      and annotation_media.byte_size is not null
      and annotation_media.checksum_sha256 is not null
      and annotation_media.raw_storage_path is null
      and annotation_media.raw_deleted_at is not null
      and annotation_media.processed_at is not null
      and annotation_media.removed_at is null
      and (
        annotation_media.media_type = 'audio'
        or (
          annotation_media.media_type = 'video'
          and annotation_media.width is not null
          and annotation_media.height is not null
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Hosted media must be ready with valid final metadata and confirmed raw deletion before publication.';
  end if;

  return new;
end;
$$;

comment on function private.guard_hosted_annotation_publication() is
  'First hosted publication requires ready media, valid final metadata, confirmed raw deletion, and at least one of typed commentary or attached voice commentary. A transcript is not required. Hidden → published (F3 unhide) also admits F4-removed media and never restores derivatives or transcript content.';

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
    and media.processed_storage_path is not null
    and media.processed_at is not null;

  if not found then
    raise exception using errcode = '55000', message = 'Processed media and an active lease are required before raw deletion can be confirmed.';
  end if;
end;
$$;

comment on function private.confirm_annotation_media_raw_deleted(uuid, uuid) is
  'Clears the raw path after the derivative exists. Transcript presence only chooses the next stage.';

revoke all on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  to service_role, annotated_media_worker;

create or replace function private.stage_annotation_media_transcript(
  p_media_id uuid,
  p_lease_token uuid,
  p_transcript_text text,
  p_language text,
  p_segments jsonb,
  p_provider text,
  p_model text,
  p_provider_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
begin
  select annotation_media.*
  into media_row
  from public.annotation_media
  where annotation_media.id = p_media_id
  for update;

  if not found
    or media_row.processing_status not in ('processing', 'ready')
    or media_row.lease_token is distinct from p_lease_token
    or media_row.lease_expires_at <= pg_catalog.now()
    or media_row.processed_storage_path is null
    or media_row.duration_ms is null
  then
    raise exception using errcode = '55000', message = 'A valid processed derivative and lease are required before transcription can be staged.';
  end if;
  if not private.is_valid_transcript_segments(p_segments) then
    raise exception using errcode = '22023', message = 'Transcript segments are invalid.';
  end if;
  if p_segments is not null and exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_segments) as segment(value)
    where (segment.value ->> 'end_ms')::integer > media_row.duration_ms
  ) then
    raise exception using errcode = '22023', message = 'Transcript segments exceed the processed media duration.';
  end if;

  insert into public.annotation_transcripts (
    annotation_id,
    transcript_text,
    language,
    segments,
    provider,
    model,
    provider_metadata
  ) values (
    media_row.annotation_id,
    p_transcript_text,
    p_language,
    p_segments,
    p_provider,
    p_model,
    coalesce(p_provider_metadata, '{}'::jsonb)
  )
  on conflict (annotation_id) do update
  set
    transcript_text = excluded.transcript_text,
    language = excluded.language,
    segments = excluded.segments,
    provider = excluded.provider,
    model = excluded.model,
    provider_metadata = excluded.provider_metadata;

  update public.annotation_media
  set
    processing_stage = case
      when media_row.raw_deleted_at is null or media_row.raw_storage_path is not null then 'raw_cleanup'
      else 'finalizing'
    end,
    failure_stage = null,
    failure_code = null
  where id = p_media_id;
end;
$$;

comment on function private.stage_annotation_media_transcript(uuid, uuid, text, text, jsonb, text, text, jsonb) is
  'Stages excerpt transcript text under the active lease. Raw deletion still pending returns to raw cleanup; otherwise finalizing.';

revoke all on function private.stage_annotation_media_transcript(
  uuid, uuid, text, text, jsonb, text, text, jsonb
) from public, anon, authenticated;
grant execute on function private.stage_annotation_media_transcript(
  uuid, uuid, text, text, jsonb, text, text, jsonb
) to service_role, annotated_media_worker;

create or replace function private.publish_annotation_media_playable(
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
  v_has_transcript boolean;
begin
  select
    media.annotation_id,
    exists (
      select 1
      from public.annotation_transcripts as transcript
      where transcript.annotation_id = media.annotation_id
    )
  into v_annotation_id, v_has_transcript
  from public.annotation_media as media
  where media.id = p_media_id
    and media.processing_status in ('processing', 'ready')
    and media.lease_token = p_lease_token
    and media.lease_expires_at > pg_catalog.now()
    and media.removed_at is null
    and media.raw_storage_path is null
    and media.raw_deleted_at is not null
    and media.processed_storage_path is not null
    and media.processed_mime_type is not null
    and media.duration_ms between 1000 and 90000
    and media.byte_size is not null
    and media.checksum_sha256 is not null
    and media.processed_at is not null
    and (
      media.media_type = 'audio'
      or (media.width is not null and media.height is not null)
    )
  for update of media;

  if v_annotation_id is null then
    raise exception using errcode = '55000', message = 'Hosted media is not playable yet.';
  end if;

  update public.annotation_media
  set
    processing_status = 'ready',
    processing_stage = case when v_has_transcript then 'finalizing' else 'transcribing' end,
    failure_stage = null,
    failure_code = null
  where id = p_media_id;

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

comment on function private.publish_annotation_media_playable(uuid, uuid) is
  'Publishes a hosted annotation once the derivative is playable and raw deletion is confirmed. Keeps the lease so transcription can finish. Idempotent when already published.';

revoke all on function private.publish_annotation_media_playable(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.publish_annotation_media_playable(uuid, uuid)
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
  'Clears the worker lease after the excerpt transcript is staged. Publication itself happens when the excerpt becomes playable.';

revoke all on function private.finalize_annotation_media_ready(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.finalize_annotation_media_ready(uuid, uuid)
  to service_role, annotated_media_worker;

create or replace function private.release_annotation_media_processing_attempt(
  p_media_id uuid, p_lease_token uuid, p_failure_stage text, p_failure_code text
)
returns table (result_status text, retry_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
  playable boolean;
  terminal boolean;
  scheduled_at timestamptz;
  delay_seconds integer;
  stored_code text;
begin
  if p_failure_stage is null or p_failure_stage !~ '^[a-z0-9_]{1,50}$'
    or p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{1,100}$'
  then
    raise exception using errcode = '22023', message = 'Failure stage and code must be sanitized identifiers.';
  end if;
  select * into media_row from public.annotation_media
  where id = p_media_id for update;
  playable := found
    and media_row.processing_status = 'ready'
    and media_row.removed_at is null
    and media_row.raw_storage_path is null
    and media_row.raw_deleted_at is not null
    and media_row.processed_storage_path is not null;
  if not found
    or media_row.lease_token is distinct from p_lease_token
    or media_row.lease_expires_at <= pg_catalog.now()
    or (media_row.processing_status <> 'processing' and not playable)
  then
    raise exception using errcode = '55000', message = 'The processing lease is unavailable or expired.';
  end if;

  terminal := media_row.attempt_count >= 3
    or media_row.created_at <= pg_catalog.now() - interval '72 hours'
    or (
      not playable
      and p_failure_code in ('unsafe_geometry', 'capture_changed', 'player_not_visible')
    );
  stored_code := case
    when media_row.created_at <= pg_catalog.now() - interval '72 hours'
      then 'processing_deadline_exceeded'
    else p_failure_code
  end;

  if playable then
    if terminal then
      update public.annotation_media
      set processing_status = 'ready',
        processing_stage = null,
        failure_stage = p_failure_stage,
        failure_code = stored_code,
        next_attempt_at = null,
        lease_token = null,
        lease_expires_at = null
      where id = p_media_id;
      return query select 'failed'::text, null::timestamptz;
      return;
    end if;

    delay_seconds := least(900, 30 * (4 ^ greatest(media_row.attempt_count - 1, 0)))::integer
      + pg_catalog.mod(pg_catalog.get_byte(pg_catalog.uuid_send(media_row.id), 0) + media_row.attempt_count, 31);
    scheduled_at := pg_catalog.now() + pg_catalog.make_interval(secs => delay_seconds);
    update public.annotation_media
    set processing_status = 'ready',
      processing_stage = 'queued',
      failure_stage = p_failure_stage,
      failure_code = stored_code,
      next_attempt_at = scheduled_at,
      lease_token = null,
      lease_expires_at = null
    where id = p_media_id;
    return query select 'processing'::text, scheduled_at;
    return;
  end if;

  if terminal then
    update public.annotation_media
    set processing_status = 'failed',
      processing_stage = null,
      failure_stage = p_failure_stage,
      failure_code = stored_code,
      next_attempt_at = null,
      lease_token = null,
      lease_expires_at = null
    where id = p_media_id;
    return query select 'failed'::text, null::timestamptz;
    return;
  end if;

  delay_seconds := least(900, 30 * (4 ^ greatest(media_row.attempt_count - 1, 0)))::integer
    + pg_catalog.mod(pg_catalog.get_byte(pg_catalog.uuid_send(media_row.id), 0) + media_row.attempt_count, 31);
  scheduled_at := pg_catalog.now() + pg_catalog.make_interval(secs => delay_seconds);
  update public.annotation_media
  set processing_stage = 'queued',
    failure_stage = p_failure_stage,
    failure_code = stored_code,
    next_attempt_at = scheduled_at,
    lease_token = null,
    lease_expires_at = null
  where id = p_media_id;
  return query select 'processing'::text, scheduled_at;
end;
$$;

comment on function private.release_annotation_media_processing_attempt(uuid, uuid, text, text) is
  'Schedules a retry or records a terminal failure. unsafe_geometry, capture_changed, and player_not_visible are terminal before the excerpt is playable. A later transcription failure keeps a playable excerpt public.';

revoke all on function private.release_annotation_media_processing_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.release_annotation_media_processing_attempt(uuid, uuid, text, text)
  to service_role, annotated_media_worker;

create or replace function private.claim_annotation_media_processing(
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
    join public.annotations on annotations.id = media.annotation_id
      and (
        (annotations.status = 'draft' and media.processing_status = 'processing')
        or (
          annotations.status = 'published'
          and media.processing_status = 'ready'
          and media.removed_at is null
          and media.raw_storage_path is null
          and media.raw_deleted_at is not null
          and media.processed_storage_path is not null
          and not exists (
            select 1 from public.annotation_transcripts as transcript
            where transcript.annotation_id = media.annotation_id
          )
        )
      )
    join public.annotation_targets as targets
      on targets.annotation_id = media.annotation_id and targets.target_type = 'time_range'
    where media.id = p_media_id
      and media.attempt_count < 3 and media.created_at > pg_catalog.now() - interval '72 hours'
      and (media.next_attempt_at is null or media.next_attempt_at <= pg_catalog.now())
      and (media.lease_token is null or media.lease_expires_at <= pg_catalog.now())
      and (media.raw_storage_path is not null or media.processed_storage_path is not null)
    for update of media
  ), updated as (
    update public.annotation_media as media
    set processing_stage = case
        when media.processed_storage_path is null then 'probing'
        when media.raw_deleted_at is null or media.raw_storage_path is not null then 'raw_cleanup'
        when not candidate.has_transcript then 'transcribing'
        else 'finalizing'
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

comment on function private.claim_annotation_media_processing(uuid, integer) is
  'Claims a draft processing row, or a published ready row whose excerpt transcript row is still absent. Resume follows persisted facts.';

revoke all on function private.claim_annotation_media_processing(uuid, integer)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_processing(uuid, integer)
  to service_role, annotated_media_worker;

create or replace function private.list_annotation_media_dispatch_candidates(p_limit integer default 100)
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
    case
      when media.processing_status = 'processing'
        and (media.capture_metadata ->> 'version') is distinct from '2' then 'probing'
      when media.processed_storage_path is null then 'probing'
      when media.raw_deleted_at is null or media.raw_storage_path is not null then 'raw_cleanup'
      when not exists (
        select 1 from public.annotation_transcripts as transcript
        where transcript.annotation_id = media.annotation_id
      ) then 'transcribing'
      else 'finalizing'
    end
  from public.annotation_media as media
  join public.annotations on annotations.id = media.annotation_id
    and (
      (annotations.status = 'draft' and media.processing_status = 'processing')
      or (
        annotations.status = 'published'
        and media.processing_status = 'ready'
        and media.removed_at is null
        and media.raw_storage_path is null
        and media.raw_deleted_at is not null
        and media.processed_storage_path is not null
        and not exists (
          select 1 from public.annotation_transcripts as transcript
          where transcript.annotation_id = media.annotation_id
        )
      )
    )
  where media.attempt_count < 3
    and media.created_at > pg_catalog.now() - interval '72 hours'
    and (media.next_attempt_at is null or media.next_attempt_at <= pg_catalog.now())
    and (media.lease_token is null or media.lease_expires_at <= pg_catalog.now())
    and (media.raw_storage_path is not null or media.processed_storage_path is not null)
  order by coalesce(media.next_attempt_at, media.created_at), media.created_at, media.id
  limit p_limit;
end;
$$;

comment on function private.list_annotation_media_dispatch_candidates(integer) is
  'Due processing drafts, plus published ready rows that still need an excerpt transcript. Cleared transcript rows are not redispatched.';

revoke all on function private.list_annotation_media_dispatch_candidates(integer)
  from public, anon, authenticated;
grant execute on function private.list_annotation_media_dispatch_candidates(integer)
  to service_role, annotated_media_worker;

create or replace function public.get_public_annotation_media_state(
  p_annotation_id uuid
)
returns table (
  annotation_id uuid,
  media_id uuid,
  media_type text,
  availability text,
  mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  byte_size bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidate as (
    select
      annotations.id as annotation_id,
      media.id as media_id,
      media.media_type,
      media.processed_mime_type,
      media.duration_ms,
      media.width,
      media.height,
      media.byte_size,
      media.processing_status,
      media.removed_at,
      (
        media.processing_status = 'ready'
        and media.removed_at is null
        and media.processed_storage_path =
          profiles.id::text || '/' ||
          annotations.id::text || '/' ||
          media.id::text ||
          case
            when media.media_type = 'video' then '/excerpt.mp4'
            else '/excerpt.m4a'
          end
        and media.processed_mime_type = case
          when media.media_type = 'video' then 'video/mp4'
          else 'audio/mp4'
        end
        and media.duration_ms between 1000 and 90000
        and media.byte_size is not null
        and media.checksum_sha256 is not null
        and media.raw_storage_path is null
        and media.raw_deleted_at is not null
        and media.processed_at is not null
        and (
          media.media_type = 'audio'
          or (media.width is not null and media.height is not null)
        )
      ) as is_ready
    from public.annotations
    join public.profiles on profiles.id = annotations.user_id
    join public.annotation_media as media on media.annotation_id = annotations.id
    where annotations.id = p_annotation_id
      and annotations.status = 'published'
  )
  select
    candidate.annotation_id,
    candidate.media_id,
    candidate.media_type,
    case
      when candidate.is_ready then 'ready'
      when candidate.processing_status = 'removed'
        and candidate.removed_at is not null then 'removed'
      else 'unavailable'
    end,
    case when candidate.is_ready then candidate.processed_mime_type end,
    case when candidate.is_ready then candidate.duration_ms end,
    case when candidate.is_ready then candidate.width end,
    case when candidate.is_ready then candidate.height end,
    case when candidate.is_ready then candidate.byte_size end
  from candidate
$$;

comment on function public.get_public_annotation_media_state(uuid) is
  'Path-free public ready/removed projection. Ready does not require a transcript; the transcript is a separate projection. Malformed published hosted rows return only unavailable.';

revoke all on function public.get_public_annotation_media_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_media_state(uuid)
  to anon, authenticated, service_role;

create or replace function public.get_annotation_media_delivery(
  p_annotation_id uuid
)
returns table (
  annotation_id uuid,
  media_id uuid,
  processed_storage_path text,
  mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  byte_size bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    annotations.id,
    media.id,
    media.processed_storage_path,
    media.processed_mime_type,
    media.duration_ms,
    media.width,
    media.height,
    media.byte_size
  from public.annotations
  join public.annotation_media as media on media.annotation_id = annotations.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and media.processing_status = 'ready'
    and media.removed_at is null
    and media.processed_storage_path =
      annotations.user_id::text || '/' ||
      annotations.id::text || '/' ||
      media.id::text ||
      case
        when media.media_type = 'video' then '/excerpt.mp4'
        else '/excerpt.m4a'
      end
    and media.processed_mime_type is not null
    and media.duration_ms between 1000 and 90000
    and media.byte_size is not null
    and media.checksum_sha256 is not null
    and media.raw_storage_path is null
    and media.raw_deleted_at is not null
    and media.processed_at is not null
    and (
      media.media_type = 'audio'
      or (media.width is not null and media.height is not null)
    )
$$;

comment on function public.get_annotation_media_delivery(uuid) is
  'Service-only exact-path derivation after fresh published/ready/raw-deleted validation. A transcript is not required. Removed media cannot mint a path.';

revoke all on function public.get_annotation_media_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_annotation_media_delivery(uuid)
  to service_role;
