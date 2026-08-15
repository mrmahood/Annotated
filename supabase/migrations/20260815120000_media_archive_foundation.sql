-- Phase A foundation for draft-first hosted video and audio annotations.
-- Existing time-code-only publication functions remain available until the
-- extension moves to the hosted workflow in Phase B.

alter table public.annotations
  add column slug text;

alter table public.annotations
  add constraint annotations_slug_format_check check (
    slug is null
    or (
      pg_catalog.char_length(slug) between 3 and 100
      and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
  );

create unique index annotations_user_id_slug_key
  on public.annotations (user_id, slug)
  where slug is not null;

create table public.profile_handle_aliases (
  handle text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  constraint profile_handle_aliases_handle_check check (
    pg_catalog.char_length(handle) between 3 and 30
    and handle ~ '^[a-z0-9_-]+$'
    and handle = pg_catalog.lower(handle)
  )
);

create index profile_handle_aliases_profile_id_idx
  on public.profile_handle_aliases (profile_id);

create table public.annotation_media (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  annotation_id uuid not null unique
    references public.annotations (id) on delete cascade,
  media_type text not null,
  processing_status text not null default 'capture_pending',
  processing_stage text,
  capture_metadata jsonb not null default '{"version":1}'::jsonb,
  raw_storage_path text unique,
  raw_mime_type text,
  raw_byte_size bigint,
  raw_checksum_sha256 text,
  processed_storage_path text unique,
  processed_mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  byte_size bigint,
  checksum_sha256 text,
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  failure_stage text,
  failure_code text,
  uploaded_at timestamptz,
  processed_at timestamptz,
  raw_deleted_at timestamptz,
  removed_at timestamptz,
  removal_claim_id uuid references public.claims (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint annotation_media_media_type_check check (
    media_type in ('video', 'audio')
  ),
  constraint annotation_media_processing_status_check check (
    processing_status in (
      'capture_pending', 'uploading', 'processing', 'ready', 'failed', 'removed'
    )
  ),
  constraint annotation_media_processing_stage_check check (
    processing_stage is null
    or processing_stage in (
      'queued', 'probing', 'transcoding', 'transcribing',
      'raw_cleanup', 'finalizing'
    )
  ),
  constraint annotation_media_raw_path_check check (
    raw_storage_path is null
    or (
      pg_catalog.char_length(raw_storage_path) <= 300
      and raw_storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+[.]webm$'
    )
  ),
  constraint annotation_media_raw_mime_check check (
    raw_mime_type is null or raw_mime_type in ('video/webm', 'audio/webm')
  ),
  constraint annotation_media_raw_byte_size_check check (
    raw_byte_size is null or raw_byte_size between 1 and 52428800
  ),
  constraint annotation_media_raw_checksum_check check (
    raw_checksum_sha256 is null or raw_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint annotation_media_processed_path_check check (
    processed_storage_path is null
    or (
      pg_catalog.char_length(processed_storage_path) <= 300
      and processed_storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/excerpt[.](mp4|m4a)$'
    )
  ),
  constraint annotation_media_processed_mime_check check (
    processed_mime_type is null
    or (
      media_type = 'video' and processed_mime_type = 'video/mp4'
    )
    or (
      media_type = 'audio' and processed_mime_type = 'audio/mp4'
    )
  ),
  constraint annotation_media_duration_check check (
    duration_ms is null or duration_ms between 1000 and 90000
  ),
  constraint annotation_media_dimensions_check check (
    (
      media_type = 'audio'
      and width is null
      and height is null
    )
    or (
      media_type = 'video'
      and (
        (width is null and height is null)
        or (
          width between 2 and 8192
          and height between 2 and 8192
        )
      )
    )
  ),
  constraint annotation_media_processed_byte_size_check check (
    byte_size is null
    or (
      media_type = 'video' and byte_size between 1 and 16777216
    )
    or (
      media_type = 'audio' and byte_size between 1 and 8388608
    )
  ),
  constraint annotation_media_checksum_check check (
    checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint annotation_media_attempt_count_check check (
    attempt_count between 0 and 10
  ),
  constraint annotation_media_lease_shape_check check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  constraint annotation_media_failure_stage_check check (
    failure_stage is null
    or (
      pg_catalog.char_length(failure_stage) between 1 and 50
      and failure_stage ~ '^[a-z0-9_]+$'
    )
  ),
  constraint annotation_media_failure_code_check check (
    failure_code is null
    or (
      pg_catalog.char_length(failure_code) between 1 and 100
      and failure_code ~ '^[a-z0-9_]+$'
    )
  ),
  constraint annotation_media_failure_pair_check check (
    (failure_stage is null and failure_code is null)
    or (failure_stage is not null and failure_code is not null)
  ),
  constraint annotation_media_failed_shape_check check (
    processing_status <> 'failed'
    or (
      failure_stage is not null
      and failure_code is not null
      and lease_token is null
    )
  ),
  constraint annotation_media_ready_shape_check check (
    processing_status <> 'ready'
    or (
      processing_stage is null
      and raw_storage_path is null
      and raw_deleted_at is not null
      and processed_storage_path is not null
      and processed_mime_type is not null
      and duration_ms between 1000 and 90000
      and byte_size is not null
      and checksum_sha256 is not null
      and processed_at is not null
      and lease_token is null
      and removed_at is null
      and (
        media_type = 'audio'
        or (width is not null and height is not null)
      )
    )
  ),
  constraint annotation_media_removed_shape_check check (
    processing_status <> 'removed'
    or (removed_at is not null and lease_token is null)
  ),
  constraint annotation_media_timestamp_order_check check (
    (uploaded_at is null or uploaded_at >= created_at)
    and (processed_at is null or processed_at >= created_at)
    and (raw_deleted_at is null or raw_deleted_at >= created_at)
    and (removed_at is null or removed_at >= created_at)
  )
);

create index annotation_media_processing_queue_idx
  on public.annotation_media (processing_status, next_attempt_at, created_at)
  where processing_status = 'processing';

create index annotation_media_expired_lease_idx
  on public.annotation_media (lease_expires_at)
  where lease_token is not null;

create index annotation_media_removed_at_idx
  on public.annotation_media (removed_at)
  where removed_at is not null;

create table public.annotation_transcripts (
  annotation_id uuid primary key
    references public.annotations (id) on delete cascade,
  transcript_text text not null,
  language text,
  segments jsonb,
  provider text not null,
  model text not null,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint annotation_transcripts_text_check check (
    pg_catalog.btrim(transcript_text) <> ''
    and pg_catalog.char_length(transcript_text) <= 20000
  ),
  constraint annotation_transcripts_language_check check (
    language is null
    or (
      pg_catalog.char_length(language) between 2 and 35
      and language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    )
  ),
  constraint annotation_transcripts_provider_check check (
    pg_catalog.btrim(provider) <> ''
    and pg_catalog.char_length(provider) <= 100
  ),
  constraint annotation_transcripts_model_check check (
    pg_catalog.btrim(model) <> ''
    and pg_catalog.char_length(model) <= 200
  ),
  constraint annotation_transcripts_provider_metadata_check check (
    pg_catalog.jsonb_typeof(provider_metadata) = 'object'
    and pg_catalog.octet_length(provider_metadata::text) <= 16384
  )
);

create function private.is_bounded_capture_metadata(p_metadata jsonb)
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
    or pg_catalog.jsonb_typeof(p_metadata -> 'version') <> 'number'
    or (p_metadata ->> 'version') <> '1'
  then
    return false;
  end if;

  for metadata_key in
    select keys.key
    from pg_catalog.jsonb_object_keys(p_metadata) as keys(key)
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

alter table public.annotation_media
  add constraint annotation_media_capture_metadata_check check (
    private.is_bounded_capture_metadata(capture_metadata)
  );

create function private.is_valid_transcript_segments(p_segments jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  segment jsonb;
  segment_start integer;
  segment_end integer;
  previous_end integer := 0;
begin
  if p_segments is null then
    return true;
  end if;
  if pg_catalog.jsonb_typeof(p_segments) <> 'array'
    or pg_catalog.jsonb_array_length(p_segments) > 500
    or pg_catalog.octet_length(p_segments::text) > 65536
  then
    return false;
  end if;

  for segment in
    select value from pg_catalog.jsonb_array_elements(p_segments)
  loop
    if pg_catalog.jsonb_typeof(segment) <> 'object'
      or pg_catalog.jsonb_typeof(segment -> 'start_ms') <> 'number'
      or pg_catalog.jsonb_typeof(segment -> 'end_ms') <> 'number'
      or pg_catalog.jsonb_typeof(segment -> 'text') <> 'string'
      or (segment ->> 'start_ms') !~ '^[0-9]+$'
      or (segment ->> 'end_ms') !~ '^[0-9]+$'
      or pg_catalog.btrim(segment ->> 'text') = ''
      or pg_catalog.char_length(segment ->> 'text') > 2000
    then
      return false;
    end if;

    begin
      segment_start := (segment ->> 'start_ms')::integer;
      segment_end := (segment ->> 'end_ms')::integer;
    exception when others then
      return false;
    end;

    if segment_start < previous_end
      or segment_end <= segment_start
      or segment_end > 90000
    then
      return false;
    end if;
    previous_end := segment_end;
  end loop;

  return true;
end;
$$;

revoke all on function private.is_valid_transcript_segments(jsonb)
  from public, anon, authenticated;

alter table public.annotation_transcripts
  add constraint annotation_transcripts_segments_check check (
    private.is_valid_transcript_segments(segments)
  );

create trigger annotation_media_set_updated_at
before update on public.annotation_media
for each row execute function public.set_updated_at();

create trigger annotation_transcripts_set_updated_at
before update on public.annotation_transcripts
for each row execute function public.set_updated_at();

alter table public.profile_handle_aliases enable row level security;
alter table public.annotation_media enable row level security;
alter table public.annotation_transcripts enable row level security;

revoke all privileges on table public.profile_handle_aliases
  from public, anon, authenticated, service_role;
revoke all privileges on table public.annotation_media
  from public, anon, authenticated, service_role;
revoke all privileges on table public.annotation_transcripts
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.profile_handle_aliases
  to service_role;
grant select, insert, update, delete on table public.annotation_media
  to service_role;
grant select, insert, update, delete on table public.annotation_transcripts
  to service_role;
grant usage on schema private to service_role;

-- Owners may still edit commentary, but hosted publication status and slugs are
-- no longer directly mutable. Existing publish RPCs require INSERT, not UPDATE.
revoke update on table public.annotations from authenticated;
grant update (commentary_text, commentary_audio_path)
  on table public.annotations to authenticated;
revoke delete on table public.annotations from authenticated;

-- Current clients do not mutate stored targets after publication. Removing
-- direct UPDATE/DELETE closes a hosted-duration and source-target bypass while
-- preserving INSERT for the existing SECURITY INVOKER publish RPCs.
revoke update, delete on table public.annotation_targets from authenticated;

-- Keep normal profile editing but reserve username changes for the controlled
-- handle function below.
revoke update on table public.profiles from authenticated;
grant update (display_name, avatar_url, bio) on table public.profiles
  to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'annotation-media-raw',
    'annotation-media-raw',
    false,
    52428800,
    array['video/webm', 'audio/webm']::text[]
  ),
  (
    'annotation-media',
    'annotation-media',
    false,
    16777216,
    array['video/mp4', 'audio/mp4']::text[]
  )
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.annotation_media is
  'Private operational metadata for one draft-first hosted source-media artifact. Clients use sanitized RPCs; raw/final paths and worker state are not directly exposed.';
comment on table public.annotation_transcripts is
  'One excerpt-only transcript per hosted annotation. Provider audit metadata is restricted from public projections.';
comment on table public.profile_handle_aliases is
  'Permanently reserved historical creator handles used to preserve inbound links after controlled handle changes.';

create function private.slugify_route_part(
  p_value text,
  p_fallback text,
  p_maximum_length integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate text;
begin
  candidate := pg_catalog.lower(coalesce(p_value, ''));
  candidate := pg_catalog.regexp_replace(candidate, '[^a-z0-9]+', '-', 'g');
  candidate := pg_catalog.btrim(candidate, '-');
  if candidate = '' then
    candidate := pg_catalog.lower(coalesce(p_fallback, 'annotation'));
    candidate := pg_catalog.regexp_replace(candidate, '[^a-z0-9]+', '-', 'g');
    candidate := pg_catalog.btrim(candidate, '-');
  end if;
  if candidate = '' then
    candidate := 'annotation';
  end if;
  return pg_catalog.left(candidate, p_maximum_length);
end;
$$;

revoke all on function private.slugify_route_part(text, text, integer)
  from public, anon, authenticated;

create function private.ensure_profile_handle(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_handle text;
  display_seed text;
  suffix_length integer;
  suffix text;
  base text;
  candidate text;
begin
  if p_profile_id is null then
    raise exception using errcode = '22023', message = 'A profile ID is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(19020301);

  select profiles.username, profiles.display_name
  into current_handle, display_seed
  from public.profiles
  where profiles.id = p_profile_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'The creator profile does not exist.';
  end if;
  if current_handle is not null then
    return current_handle;
  end if;

  foreach suffix_length in array array[8, 12, 16, 24]
  loop
    suffix := pg_catalog.left(pg_catalog.replace(p_profile_id::text, '-', ''), suffix_length);
    base := private.slugify_route_part(
      display_seed,
      'creator',
      30 - 1 - pg_catalog.char_length(suffix)
    );
    if pg_catalog.char_length(base) < 3 then
      base := 'creator';
    end if;
    candidate := base || '-' || suffix;

    if not exists (
      select 1
      from public.profiles
      where pg_catalog.lower(profiles.username) = candidate
    ) and not exists (
      select 1
      from public.profile_handle_aliases
      where profile_handle_aliases.handle = candidate
    ) then
      update public.profiles
      set username = candidate
      where id = p_profile_id;
      return candidate;
    end if;
  end loop;

  raise exception using
    errcode = '23505',
    message = 'A unique creator handle could not be generated.';
end;
$$;

revoke all on function private.ensure_profile_handle(uuid)
  from public, anon, authenticated;

create function private.generate_annotation_slug(
  p_owner_id uuid,
  p_annotation_id uuid,
  p_seed text,
  p_fallback text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  suffix_length integer;
  suffix text;
  base text;
  candidate text;
begin
  if p_owner_id is null or p_annotation_id is null then
    raise exception using errcode = '22023', message = 'Owner and annotation IDs are required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 19020302)
  );

  foreach suffix_length in array array[8, 12, 16, 32]
  loop
    suffix := pg_catalog.left(
      pg_catalog.replace(p_annotation_id::text, '-', ''),
      suffix_length
    );
    base := private.slugify_route_part(p_seed, p_fallback, 90 - suffix_length);
    candidate := base || '-' || suffix;
    if not exists (
      select 1
      from public.annotations
      where annotations.user_id = p_owner_id
        and annotations.slug = candidate
    ) then
      return candidate;
    end if;
  end loop;

  raise exception using
    errcode = '23505',
    message = 'A unique annotation slug could not be generated.';
end;
$$;

revoke all on function private.generate_annotation_slug(uuid, uuid, text, text)
  from public, anon, authenticated;

create function private.guard_profile_username_alias()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is distinct from old.username
    and new.username is not null
    and exists (
      select 1
      from public.profile_handle_aliases
      where profile_handle_aliases.handle = pg_catalog.lower(new.username)
    )
  then
    raise exception using
      errcode = '23505',
      message = 'The creator handle is permanently reserved.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_profile_username_alias()
  from public, anon, authenticated;

create trigger profiles_guard_username_alias
before update of username on public.profiles
for each row execute function private.guard_profile_username_alias();

create function private.guard_profile_handle_alias_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.profiles
    where pg_catalog.lower(profiles.username) = new.handle
  ) then
    raise exception using
      errcode = '23505',
      message = 'The handle is currently assigned to a creator.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_profile_handle_alias_insert()
  from public, anon, authenticated;

create trigger profile_handle_aliases_guard_current_handle
before insert or update of handle on public.profile_handle_aliases
for each row execute function private.guard_profile_handle_alias_insert();

create function public.set_profile_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  safe_handle text := pg_catalog.lower(pg_catalog.btrim(p_handle));
  current_handle text;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to change a creator handle.';
  end if;
  if safe_handle is null
    or pg_catalog.char_length(safe_handle) not between 3 and 30
    or safe_handle !~ '^[a-z0-9_-]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'A handle must be 3-30 lowercase letters, numbers, underscores, or hyphens.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(19020301);

  select username
  into current_handle
  from public.profiles
  where id = caller_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'The creator profile is unavailable.';
  end if;
  if current_handle = safe_handle then
    return safe_handle;
  end if;
  if exists (
    select 1 from public.profiles
    where pg_catalog.lower(profiles.username) = safe_handle
      and profiles.id <> caller_id
  ) or exists (
    select 1 from public.profile_handle_aliases
    where profile_handle_aliases.handle = safe_handle
  ) then
    raise exception using errcode = '23505', message = 'That creator handle is unavailable.';
  end if;

  update public.profiles
  set username = safe_handle
  where id = caller_id;

  if current_handle is not null then
    insert into public.profile_handle_aliases (handle, profile_id)
    values (current_handle, caller_id);
  end if;

  return safe_handle;
end;
$$;

revoke all on function public.set_profile_handle(text)
  from public, anon, authenticated;
grant execute on function public.set_profile_handle(text) to authenticated;

create function private.guard_annotation_slug_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.slug is not null and new.slug is distinct from old.slug then
    raise exception using
      errcode = '23514',
      message = 'An annotation slug is immutable once assigned.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_annotation_slug_immutable()
  from public, anon, authenticated;

create trigger annotations_guard_slug_immutable
before update of slug on public.annotations
for each row execute function private.guard_annotation_slug_immutable();

create function private.guard_annotation_media_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_type text;
  parent_status text;
begin
  if tg_op = 'UPDATE' and (
    new.annotation_id is distinct from old.annotation_id
    or new.media_type is distinct from old.media_type
  ) then
    raise exception using
      errcode = '23514',
      message = 'Hosted media identity and type are immutable.';
  end if;

  select annotations.annotation_type, annotations.status
  into parent_type, parent_status
  from public.annotations
  where annotations.id = new.annotation_id;

  if parent_type is null
    or (new.media_type = 'video' and parent_type <> 'video_clip')
    or (new.media_type = 'audio' and parent_type <> 'audio_clip')
  then
    raise exception using
      errcode = '23514',
      message = 'Hosted media type does not match its annotation.';
  end if;
  if tg_op = 'INSERT' and parent_status <> 'draft' then
    raise exception using
      errcode = '23514',
      message = 'Hosted media can be attached only to a draft annotation.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_annotation_media_relationship()
  from public, anon, authenticated;

create trigger annotation_media_guard_relationship
before insert or update of annotation_id, media_type on public.annotation_media
for each row execute function private.guard_annotation_media_relationship();

create function private.guard_hosted_annotation_publication()
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

  if new.commentary_text is null
    or pg_catalog.btrim(new.commentary_text) = ''
    or pg_catalog.char_length(new.commentary_text) > 2000
  then
    raise exception using
      errcode = '23514',
      message = 'Required commentary must be present before hosted publication.';
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

  if not exists (
    select 1
    from public.annotation_transcripts
    where annotation_transcripts.annotation_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A hosted media transcript is required before publication.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_hosted_annotation_publication()
  from public, anon, authenticated;

create trigger annotations_guard_hosted_publication
before insert or update of status on public.annotations
for each row execute function private.guard_hosted_annotation_publication();

grant execute on function private.is_bounded_capture_metadata(jsonb)
  to service_role;
grant execute on function private.is_valid_transcript_segments(jsonb)
  to service_role;

create function public.begin_hosted_youtube_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_video_id text,
  p_video_title text,
  p_channel_name text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  v_source_id uuid;
  v_source_kind text;
  v_annotation_id uuid := pg_catalog.gen_random_uuid();
  v_media_id uuid := pg_catalog.gen_random_uuid();
  v_creator_handle text;
  v_annotation_slug text;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
  safe_video_id text := pg_catalog.btrim(p_video_id);
  expected_url text;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to begin a hosted YouTube annotation.';
  end if;

  if safe_video_id is null or safe_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception using errcode = '22023', message = 'A valid YouTube video ID is required.';
  end if;
  expected_url := 'https://www.youtube.com/watch?v=' || safe_video_id;
  if safe_normalized_url is distinct from expected_url then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL must identify exactly one canonical YouTube video.';
  end if;
  if safe_canonical_url is distinct from expected_url then
    raise exception using
      errcode = '22023',
      message = 'The canonical URL must be the canonical YouTube watch URL.';
  end if;

  if p_start_ms is null or p_start_ms < 0 then
    raise exception using errcode = '22023', message = 'Clip start must be zero or greater.';
  end if;
  if p_end_ms is null or p_end_ms <= p_start_ms then
    raise exception using errcode = '22023', message = 'Clip end must be after clip start.';
  end if;
  if p_end_ms - p_start_ms < 1000 then
    raise exception using errcode = '22023', message = 'A hosted clip must be at least 1 second long.';
  end if;
  if p_end_ms - p_start_ms > 90000 then
    raise exception using errcode = '22023', message = 'A hosted clip cannot be longer than 90 seconds.';
  end if;

  if p_commentary_text is null or pg_catalog.btrim(p_commentary_text) = '' then
    raise exception using errcode = '22023', message = 'Commentary text is required.';
  end if;
  if pg_catalog.char_length(p_commentary_text) > 2000 then
    raise exception using errcode = '22023', message = 'Commentary text cannot exceed 2,000 characters.';
  end if;
  if p_video_title is not null and pg_catalog.char_length(p_video_title) > 500 then
    raise exception using errcode = '22023', message = 'Video title cannot exceed 500 characters.';
  end if;
  if p_channel_name is not null and pg_catalog.char_length(p_channel_name) > 500 then
    raise exception using errcode = '22023', message = 'Channel name cannot exceed 500 characters.';
  end if;

  v_creator_handle := private.ensure_profile_handle(caller_id);

  insert into public.sources (
    normalized_url,
    canonical_url,
    source_type,
    title,
    author,
    publisher,
    metadata
  ) values (
    safe_normalized_url,
    safe_canonical_url,
    'youtube',
    nullif(pg_catalog.btrim(p_video_title), ''),
    nullif(pg_catalog.btrim(p_channel_name), ''),
    'YouTube',
    pg_catalog.jsonb_build_object('video_id', safe_video_id)
  )
  on conflict (normalized_url) do nothing
  returning id, source_type into v_source_id, v_source_kind;

  if v_source_id is null then
    select id, source_type
    into v_source_id, v_source_kind
    from public.sources
    where sources.normalized_url = safe_normalized_url;
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The YouTube source could not be created or reused.';
  end if;
  if v_source_kind <> 'youtube' then
    raise exception using errcode = '22023', message = 'The normalized URL belongs to a non-YouTube source.';
  end if;

  v_annotation_slug := private.generate_annotation_slug(
    caller_id,
    v_annotation_id,
    p_video_title,
    'youtube-clip'
  );

  insert into public.annotations (
    id,
    source_id,
    user_id,
    annotation_type,
    commentary_text,
    status,
    published_at,
    slug
  ) values (
    v_annotation_id,
    v_source_id,
    caller_id,
    'video_clip',
    p_commentary_text,
    'draft',
    null,
    v_annotation_slug
  );

  insert into public.annotation_targets (
    annotation_id,
    target_type,
    start_ms,
    end_ms
  ) values (
    v_annotation_id,
    'time_range',
    p_start_ms,
    p_end_ms
  );

  insert into public.annotation_media (
    id,
    annotation_id,
    media_type,
    processing_status,
    capture_metadata
  ) values (
    v_media_id,
    v_annotation_id,
    'video',
    'capture_pending',
    '{"version":1}'::jsonb
  );

  return query
  select
    v_annotation_id,
    v_media_id,
    v_creator_handle,
    v_annotation_slug,
    'capture_pending'::text;
end;
$$;

comment on function public.begin_hosted_youtube_annotation(
  text, text, text, text, text, integer, integer, text
) is
  'Atomically creates a private draft YouTube annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid().';

revoke all on function public.begin_hosted_youtube_annotation(
  text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_youtube_annotation(
  text, text, text, text, text, integer, integer, text
) to authenticated;

create function public.begin_hosted_audio_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_episode_title text,
  p_author text,
  p_publisher text,
  p_show_name text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  v_source_id uuid;
  v_source_kind text;
  v_annotation_id uuid := pg_catalog.gen_random_uuid();
  v_media_id uuid := pg_catalog.gen_random_uuid();
  v_creator_handle text;
  v_annotation_slug text;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to begin a hosted audio annotation.';
  end if;

  if safe_normalized_url is null
    or safe_normalized_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?][^#[:space:]]*)?$'
  then
    raise exception using errcode = '22023', message = 'The normalized URL must be a valid HTTP or HTTPS URL without a fragment.';
  end if;
  if safe_canonical_url is null
    or safe_canonical_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?][^#[:space:]]*)?$'
  then
    raise exception using errcode = '22023', message = 'The canonical URL must be a valid HTTP or HTTPS URL without a fragment.';
  end if;
  if safe_canonical_url is distinct from safe_normalized_url then
    raise exception using errcode = '22023', message = 'The canonical URL must match the normalized episode identity.';
  end if;
  if safe_normalized_url ~* '([?&])(utm_[^=]*|gclid|fbclid|mc_cid|mc_eid)='
    or safe_normalized_url ~* '([?&])(t|time|timestamp|start|start_time|seek|position|playback_position)=([0-9]+([.][0-9]+)?(ms|s)?|[0-9]{1,3}:[0-9]{2}(:[0-9]{2})?|([0-9]+h)?([0-9]+m)?[0-9]+s)(&|$)'
  then
    raise exception using errcode = '22023', message = 'The episode identity cannot contain tracking or playback-location parameters.';
  end if;

  if p_start_ms is null or p_start_ms < 0 then
    raise exception using errcode = '22023', message = 'Clip start must be zero or greater.';
  end if;
  if p_end_ms is null or p_end_ms <= p_start_ms then
    raise exception using errcode = '22023', message = 'Clip end must be after clip start.';
  end if;
  if p_end_ms - p_start_ms < 1000 then
    raise exception using errcode = '22023', message = 'A hosted clip must be at least 1 second long.';
  end if;
  if p_end_ms - p_start_ms > 90000 then
    raise exception using errcode = '22023', message = 'A hosted clip cannot be longer than 90 seconds.';
  end if;

  if p_commentary_text is null or pg_catalog.btrim(p_commentary_text) = '' then
    raise exception using errcode = '22023', message = 'Commentary text is required.';
  end if;
  if pg_catalog.char_length(p_commentary_text) > 2000 then
    raise exception using errcode = '22023', message = 'Commentary text cannot exceed 2,000 characters.';
  end if;
  if p_episode_title is not null and pg_catalog.char_length(p_episode_title) > 500 then
    raise exception using errcode = '22023', message = 'Episode title cannot exceed 500 characters.';
  end if;
  if p_author is not null and pg_catalog.char_length(p_author) > 500 then
    raise exception using errcode = '22023', message = 'Author cannot exceed 500 characters.';
  end if;
  if p_publisher is not null and pg_catalog.char_length(p_publisher) > 500 then
    raise exception using errcode = '22023', message = 'Publisher cannot exceed 500 characters.';
  end if;
  if p_show_name is not null and pg_catalog.char_length(p_show_name) > 500 then
    raise exception using errcode = '22023', message = 'Show name cannot exceed 500 characters.';
  end if;

  v_creator_handle := private.ensure_profile_handle(caller_id);

  insert into public.sources (
    normalized_url,
    canonical_url,
    source_type,
    title,
    author,
    publisher,
    metadata
  ) values (
    safe_normalized_url,
    safe_canonical_url,
    'podcast',
    nullif(pg_catalog.btrim(p_episode_title), ''),
    nullif(pg_catalog.btrim(p_author), ''),
    nullif(pg_catalog.btrim(p_publisher), ''),
    case
      when nullif(pg_catalog.btrim(p_show_name), '') is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('show_name', pg_catalog.btrim(p_show_name))
    end
  )
  on conflict (normalized_url) do nothing
  returning id, source_type into v_source_id, v_source_kind;

  if v_source_id is null then
    select id, source_type
    into v_source_id, v_source_kind
    from public.sources
    where sources.normalized_url = safe_normalized_url;
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The audio source could not be created or reused.';
  end if;
  if v_source_kind <> 'podcast' then
    raise exception using errcode = '22023', message = 'The normalized URL belongs to a non-audio source.';
  end if;

  v_annotation_slug := private.generate_annotation_slug(
    caller_id,
    v_annotation_id,
    p_episode_title,
    'audio-clip'
  );

  insert into public.annotations (
    id,
    source_id,
    user_id,
    annotation_type,
    commentary_text,
    status,
    published_at,
    slug
  ) values (
    v_annotation_id,
    v_source_id,
    caller_id,
    'audio_clip',
    p_commentary_text,
    'draft',
    null,
    v_annotation_slug
  );

  insert into public.annotation_targets (
    annotation_id,
    target_type,
    start_ms,
    end_ms
  ) values (
    v_annotation_id,
    'time_range',
    p_start_ms,
    p_end_ms
  );

  insert into public.annotation_media (
    id,
    annotation_id,
    media_type,
    processing_status,
    capture_metadata
  ) values (
    v_media_id,
    v_annotation_id,
    'audio',
    'capture_pending',
    '{"version":1}'::jsonb
  );

  return query
  select
    v_annotation_id,
    v_media_id,
    v_creator_handle,
    v_annotation_slug,
    'capture_pending'::text;
end;
$$;

comment on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) is
  'Atomically creates a private draft podcast annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid().';

revoke all on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) to authenticated;

create function private.mark_annotation_media_uploading(
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
  expected_prefix text;
begin
  select annotation_media.*
  into media_row
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

  select annotations.user_id
  into owner_id
  from public.annotations
  where annotations.id = media_row.annotation_id
    and annotations.status = 'draft';
  if owner_id is null then
    raise exception using errcode = '55000', message = 'The hosted annotation is not a private draft.';
  end if;

  expected_prefix := owner_id::text || '/' || media_row.annotation_id::text || '/' || media_row.id::text || '/';
  if p_raw_storage_path is null
    or p_raw_storage_path !~ (
      '^' || expected_prefix ||
      '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webm$'
    )
  then
    raise exception using errcode = '22023', message = 'The raw storage path is invalid for this hosted annotation.';
  end if;
  if (media_row.media_type = 'video' and p_raw_mime_type <> 'video/webm')
    or (media_row.media_type = 'audio' and p_raw_mime_type <> 'audio/webm')
  then
    raise exception using errcode = '22023', message = 'The raw MIME type does not match the hosted media type.';
  end if;
  if p_raw_byte_size is null
    or p_raw_byte_size < 1
    or p_raw_byte_size > 52428800
    or (media_row.media_type = 'audio' and p_raw_byte_size > 16777216)
  then
    raise exception using errcode = '22023', message = 'The raw media size is outside the accepted limit.';
  end if;
  if not private.is_bounded_capture_metadata(p_capture_metadata) then
    raise exception using errcode = '22023', message = 'Capture metadata is invalid or too large.';
  end if;

  delete from public.annotation_transcripts
  where annotation_transcripts.annotation_id = media_row.annotation_id;

  update public.annotation_media
  set
    processing_status = 'uploading',
    processing_stage = null,
    capture_metadata = p_capture_metadata,
    raw_storage_path = p_raw_storage_path,
    raw_mime_type = p_raw_mime_type,
    raw_byte_size = p_raw_byte_size,
    raw_checksum_sha256 = null,
    processed_storage_path = null,
    processed_mime_type = null,
    duration_ms = null,
    width = null,
    height = null,
    byte_size = null,
    checksum_sha256 = null,
    processed_at = null,
    raw_deleted_at = null,
    failure_stage = null,
    failure_code = null,
    next_attempt_at = null,
    lease_token = null,
    lease_expires_at = null
  where id = p_media_id;
end;
$$;

revoke all on function private.mark_annotation_media_uploading(uuid, text, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function private.mark_annotation_media_uploading(uuid, text, text, bigint, jsonb)
  to service_role;

create function private.accept_annotation_media_upload(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.annotation_media
  set
    processing_status = 'processing',
    processing_stage = 'queued',
    uploaded_at = pg_catalog.now(),
    next_attempt_at = pg_catalog.now(),
    failure_stage = null,
    failure_code = null,
    lease_token = null,
    lease_expires_at = null
  where id = p_media_id
    and processing_status = 'uploading'
    and raw_storage_path is not null
    and raw_mime_type is not null
    and raw_byte_size is not null;

  if not found then
    raise exception using errcode = '55000', message = 'The raw upload is not ready to enter processing.';
  end if;
end;
$$;

revoke all on function private.accept_annotation_media_upload(uuid)
  from public, anon, authenticated;
grant execute on function private.accept_annotation_media_upload(uuid)
  to service_role;

create function private.claim_annotation_media_processing(
  p_media_id uuid,
  p_lease_seconds integer default 600
)
returns table (
  media_id uuid,
  annotation_id uuid,
  media_type text,
  processing_stage text,
  capture_metadata jsonb,
  raw_storage_path text,
  raw_mime_type text,
  raw_byte_size bigint,
  processed_storage_path text,
  processed_mime_type text,
  duration_ms integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 60 and 3600 then
    raise exception using errcode = '22023', message = 'The processing lease must be between 60 and 3,600 seconds.';
  end if;

  return query
  update public.annotation_media as media
  set
    processing_stage = case
      when media.processed_storage_path is null then 'probing'
      else 'transcribing'
    end,
    lease_token = pg_catalog.gen_random_uuid(),
    lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
    attempt_count = (media.attempt_count + 1)::smallint,
    next_attempt_at = null
  where media.id = p_media_id
    and media.processing_status = 'processing'
    and media.attempt_count < 3
    and (media.next_attempt_at is null or media.next_attempt_at <= pg_catalog.now())
    and (media.lease_token is null or media.lease_expires_at <= pg_catalog.now())
    and (media.raw_storage_path is not null or media.processed_storage_path is not null)
  returning
    media.id,
    media.annotation_id,
    media.media_type,
    media.processing_stage,
    media.capture_metadata,
    media.raw_storage_path,
    media.raw_mime_type,
    media.raw_byte_size,
    media.processed_storage_path,
    media.processed_mime_type,
    media.duration_ms,
    media.lease_token,
    media.lease_expires_at,
    media.attempt_count;
end;
$$;

revoke all on function private.claim_annotation_media_processing(uuid, integer)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_processing(uuid, integer)
  to service_role;

create function private.stage_annotation_media_derivative(
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
  if p_duration_ms is null
    or p_duration_ms not between 1000 and 90000
    or p_duration_ms > target_duration
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
) from public, anon, authenticated;
grant execute on function private.stage_annotation_media_derivative(
  uuid, uuid, text, text, text, integer, integer, integer, bigint, text
) to service_role;

create function private.stage_annotation_media_transcript(
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
    or media_row.processing_status <> 'processing'
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
    processing_stage = 'raw_cleanup',
    failure_stage = null,
    failure_code = null
  where id = p_media_id;
end;
$$;

revoke all on function private.stage_annotation_media_transcript(
  uuid, uuid, text, text, jsonb, text, text, jsonb
) from public, anon, authenticated;
grant execute on function private.stage_annotation_media_transcript(
  uuid, uuid, text, text, jsonb, text, text, jsonb
) to service_role;

create function private.mark_annotation_media_processing_failed(
  p_media_id uuid,
  p_lease_token uuid,
  p_failure_stage text,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_failure_stage is null
    or p_failure_stage !~ '^[a-z0-9_]{1,50}$'
    or p_failure_code is null
    or p_failure_code !~ '^[a-z0-9_]{1,100}$'
  then
    raise exception using errcode = '22023', message = 'Failure stage and code must be sanitized identifiers.';
  end if;

  update public.annotation_media
  set
    processing_status = 'failed',
    processing_stage = null,
    failure_stage = p_failure_stage,
    failure_code = p_failure_code,
    next_attempt_at = null,
    lease_token = null,
    lease_expires_at = null
  where id = p_media_id
    and processing_status = 'processing'
    and lease_token = p_lease_token;

  if not found then
    raise exception using errcode = '55000', message = 'The processing lease is unavailable.';
  end if;
end;
$$;

revoke all on function private.mark_annotation_media_processing_failed(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.mark_annotation_media_processing_failed(uuid, uuid, text, text)
  to service_role;

create function private.retry_annotation_media_processing(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.annotation_media
  set
    processing_status = 'processing',
    processing_stage = 'queued',
    failure_stage = null,
    failure_code = null,
    next_attempt_at = pg_catalog.now(),
    lease_token = null,
    lease_expires_at = null
  where id = p_media_id
    and processing_status = 'failed'
    and attempt_count < 3
    and (raw_storage_path is not null or processed_storage_path is not null);

  if not found then
    raise exception using errcode = '55000', message = 'The failed hosted media row is not retryable.';
  end if;
end;
$$;

revoke all on function private.retry_annotation_media_processing(uuid)
  from public, anon, authenticated;
grant execute on function private.retry_annotation_media_processing(uuid)
  to service_role;

create function private.confirm_annotation_media_raw_deleted(
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
    raw_deleted_at = pg_catalog.now(),
    processing_stage = 'finalizing'
  where media.id = p_media_id
    and media.processing_status = 'processing'
    and media.lease_token = p_lease_token
    and media.processed_storage_path is not null
    and media.processed_at is not null
    and exists (
      select 1
      from public.annotation_transcripts
      where annotation_transcripts.annotation_id = media.annotation_id
    );

  if not found then
    raise exception using errcode = '55000', message = 'Processed media and transcript are required before raw deletion can be confirmed.';
  end if;
end;
$$;

revoke all on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  to service_role;

create function private.finalize_annotation_media_ready(
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
    and media.processing_status = 'processing'
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
    and exists (
      select 1
      from public.annotation_transcripts
      where annotation_transcripts.annotation_id = media.annotation_id
    )
  returning media.annotation_id into v_annotation_id;

  if v_annotation_id is null then
    raise exception using errcode = '55000', message = 'Hosted media is not ready for atomic publication.';
  end if;

  update public.annotations
  set
    status = 'published',
    published_at = pg_catalog.now()
  where id = v_annotation_id
    and status = 'draft';

  if not found then
    raise exception using errcode = '55000', message = 'The hosted annotation is not a publishable draft.';
  end if;

  return v_annotation_id;
end;
$$;

revoke all on function private.finalize_annotation_media_ready(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.finalize_annotation_media_ready(uuid, uuid)
  to service_role;

create function public.cancel_hosted_media_annotation(p_annotation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  changed_count bigint;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to cancel hosted media.';
  end if;

  update public.annotation_media as media
  set
    processing_status = 'removed',
    processing_stage = null,
    removed_at = pg_catalog.now(),
    next_attempt_at = null,
    lease_token = null,
    lease_expires_at = null
  from public.annotations
  where annotations.id = p_annotation_id
    and annotations.id = media.annotation_id
    and annotations.user_id = caller_id
    and annotations.status = 'draft'
    and media.processing_status <> 'ready'
    and media.processing_status <> 'removed';

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.cancel_hosted_media_annotation(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_hosted_media_annotation(uuid)
  to authenticated;

create function public.get_owned_annotation_media_status(p_annotation_id uuid)
returns table (
  annotation_id uuid,
  media_id uuid,
  media_type text,
  processing_status text,
  processing_stage text,
  failure_stage text,
  failure_code text,
  attempt_count smallint,
  has_processed_derivative boolean,
  uploaded_at timestamptz,
  processed_at timestamptz,
  raw_deleted_at timestamptz,
  removed_at timestamptz,
  creator_handle text,
  annotation_slug text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to read hosted media status.';
  end if;

  return query
  select
    annotations.id,
    media.id,
    media.media_type,
    media.processing_status,
    media.processing_stage,
    media.failure_stage,
    media.failure_code,
    media.attempt_count,
    media.processed_storage_path is not null,
    media.uploaded_at,
    media.processed_at,
    media.raw_deleted_at,
    media.removed_at,
    profiles.username,
    annotations.slug
  from public.annotations
  join public.annotation_media as media
    on media.annotation_id = annotations.id
  join public.profiles
    on profiles.id = annotations.user_id
  where annotations.id = p_annotation_id
    and annotations.user_id = caller_id;
end;
$$;

revoke all on function public.get_owned_annotation_media_status(uuid)
  from public, anon, authenticated;
grant execute on function public.get_owned_annotation_media_status(uuid)
  to authenticated;

create function public.get_public_annotation_media(p_annotation_id uuid)
returns table (
  annotation_id uuid,
  media_id uuid,
  media_type text,
  mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  byte_size bigint,
  processed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    annotations.id,
    media.id,
    media.media_type,
    media.processed_mime_type,
    media.duration_ms,
    media.width,
    media.height,
    media.byte_size,
    media.processed_at
  from public.annotations
  join public.annotation_media as media
    on media.annotation_id = annotations.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and media.processing_status = 'ready'
    and media.removed_at is null
$$;

revoke all on function public.get_public_annotation_media(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_annotation_media(uuid)
  to anon, authenticated;

create function public.get_public_annotation_transcript(p_annotation_id uuid)
returns table (
  annotation_id uuid,
  transcript_text text,
  language text,
  segments jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    transcripts.annotation_id,
    transcripts.transcript_text,
    transcripts.language,
    transcripts.segments
  from public.annotation_transcripts as transcripts
  join public.annotations
    on annotations.id = transcripts.annotation_id
  join public.annotation_media as media
    on media.annotation_id = annotations.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and media.processing_status = 'ready'
    and media.removed_at is null
$$;

revoke all on function public.get_public_annotation_transcript(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_annotation_transcript(uuid)
  to anon, authenticated;

comment on function private.mark_annotation_media_uploading(uuid, text, text, bigint, jsonb) is
  'Server-only transition that records one validated, server-generated raw upload allocation.';
comment on function private.accept_annotation_media_upload(uuid) is
  'Server-only transition after the upload boundary has verified the private raw Storage object.';
comment on function private.claim_annotation_media_processing(uuid, integer) is
  'Worker-only atomic lease acquisition. A staged derivative is returned so transcription retries do not recapture or retranscode.';
comment on function private.stage_annotation_media_derivative(uuid, uuid, text, text, text, integer, integer, integer, bigint, text) is
  'Worker-only idempotent staging of a valid processed derivative while the annotation remains a private draft.';
comment on function private.stage_annotation_media_transcript(uuid, uuid, text, text, jsonb, text, text, jsonb) is
  'Worker-only transcript staging; public projections intentionally omit provider and provider_metadata.';
comment on function private.finalize_annotation_media_ready(uuid, uuid) is
  'Worker-only atomic ready/publication transition after final metadata, transcript, and confirmed raw deletion.';

-- The legacy time-code-only RPCs intentionally remain executable in Phase A.
-- They create no annotation_media row and are grandfathered by the publication
-- guard. Phase B replaces extension calls with the hosted begin RPCs.
