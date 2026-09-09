-- Commentary contract: typed text, recorded voice, or both.
-- Hosted begin RPCs accept empty commentary so the owner can attach
-- annotation-audio on the draft before capture. Publication still
-- requires at least one of non-empty commentary_text or annotation_audio.
-- Legacy time-code RPCs (publish_youtube_annotation / publish_audio_clip_annotation)
-- keep requiring typed commentary.

create or replace function private.attach_annotation_audio(
  p_annotation_id uuid,
  p_storage_path text,
  p_duration_ms integer,
  p_mime_type text,
  p_byte_size integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  object_owner_id text;
  object_mime_type text;
  object_byte_size bigint;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to publish audio commentary.';
  end if;

  if not exists (
    select 1
    from public.annotations
    where annotations.id = p_annotation_id
      and annotations.user_id = caller_id
      and annotations.status in ('draft', 'published')
  ) then
    raise exception using
      errcode = '42501',
      message = 'The annotation is not owned by the authenticated user.';
  end if;

  if p_storage_path is null
    or p_storage_path !~ (
      '^' || caller_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webm$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'The audio storage path must belong to the authenticated user.';
  end if;

  select
    objects.owner_id,
    pg_catalog.lower(pg_catalog.split_part(objects.metadata ->> 'mimetype', ';', 1)),
    case
      when (objects.metadata ->> 'size') ~ '^[0-9]+$'
        then (objects.metadata ->> 'size')::bigint
      else null
    end
  into object_owner_id, object_mime_type, object_byte_size
  from storage.objects
  where objects.bucket_id = 'annotation-audio'
    and objects.name = p_storage_path;

  if object_owner_id is null
    or object_owner_id <> caller_id::text
    or object_mime_type <> 'audio/webm'
    or object_byte_size is null
    or object_byte_size <> p_byte_size
    or object_byte_size > 6291456
  then
    raise exception using
      errcode = '22023',
      message = 'The uploaded audio object is unavailable or invalid.';
  end if;

  insert into public.annotation_audio (
    annotation_id,
    storage_path,
    duration_ms,
    mime_type,
    byte_size
  )
  values (
    p_annotation_id,
    p_storage_path,
    p_duration_ms,
    p_mime_type,
    p_byte_size
  );
end;
$$;

revoke all on function private.attach_annotation_audio(uuid, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function private.attach_annotation_audio(uuid, text, integer, text, integer)
  to authenticated;

create or replace function public.attach_owner_annotation_audio(
  p_annotation_id uuid,
  p_storage_path text,
  p_audio_duration_ms integer,
  p_audio_mime_type text,
  p_audio_byte_size integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  object_owner_id text;
  object_mime_type text;
  object_byte_size bigint;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to publish audio commentary.';
  end if;

  if p_annotation_id is null then
    raise exception using
      errcode = '22023',
      message = 'An annotation identifier is required.';
  end if;

  if p_storage_path is null
    or p_storage_path !~ (
      '^' || caller_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webm$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'The audio storage path must belong to the authenticated user.';
  end if;

  if p_audio_duration_ms is null or p_audio_duration_ms not between 1000 and 300000 then
    raise exception using
      errcode = '22023',
      message = 'Audio duration must be between 1 and 300 seconds.';
  end if;

  if p_audio_mime_type is distinct from 'audio/webm' then
    raise exception using
      errcode = '22023',
      message = 'Audio must use the audio/webm MIME type.';
  end if;

  if p_audio_byte_size is null or p_audio_byte_size not between 1 and 6291456 then
    raise exception using
      errcode = '22023',
      message = 'Audio size must be between 1 byte and 6 MiB.';
  end if;

  select
    objects.owner_id,
    pg_catalog.lower(pg_catalog.split_part(objects.metadata ->> 'mimetype', ';', 1)),
    case
      when (objects.metadata ->> 'size') ~ '^[0-9]+$'
        then (objects.metadata ->> 'size')::bigint
      else null
    end
  into object_owner_id, object_mime_type, object_byte_size
  from storage.objects
  where objects.bucket_id = 'annotation-audio'
    and objects.name = p_storage_path;

  if object_owner_id is null or object_owner_id <> caller_id::text then
    raise exception using
      errcode = '42501',
      message = 'The uploaded audio object is not owned by the authenticated user.';
  end if;

  if object_mime_type <> 'audio/webm'
    or object_byte_size is null
    or object_byte_size <> p_audio_byte_size
    or object_byte_size > 6291456
  then
    raise exception using
      errcode = '22023',
      message = 'The uploaded audio object metadata is invalid.';
  end if;

  perform private.attach_annotation_audio(
    p_annotation_id,
    p_storage_path,
    p_audio_duration_ms,
    p_audio_mime_type,
    p_audio_byte_size
  );
end;
$$;

comment on function public.attach_owner_annotation_audio(uuid, text, integer, text, integer) is
  'Attaches one already-uploaded owned WebM commentary object to an owner draft or published annotation. SECURITY INVOKER preserves annotation RLS; object verification matches publish_article_annotation_with_audio.';

revoke all on function public.attach_owner_annotation_audio(uuid, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.attach_owner_annotation_audio(uuid, text, integer, text, integer)
  to authenticated;

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

comment on function private.guard_hosted_annotation_publication() is
  'First hosted publication requires ready media, valid final metadata, confirmed raw deletion, a transcript row, and at least one of typed commentary or attached voice commentary. Hidden → published (F3 unhide) also admits F4-removed media and never restores derivatives or transcript content.';

create or replace function public.publish_article_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_page_title text,
  p_author text,
  p_publisher text,
  p_selected_text text,
  p_text_prefix text,
  p_text_suffix text,
  p_commentary_text text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid;
  source_id uuid;
  annotation_id uuid;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to publish an annotation.';
  end if;

  if safe_normalized_url is null or safe_normalized_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL must be a valid HTTP or HTTPS URL.';
  end if;

  if safe_canonical_url is null or safe_canonical_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception using
      errcode = '22023',
      message = 'The canonical URL must be a valid HTTP or HTTPS URL.';
  end if;

  if p_selected_text is null or pg_catalog.btrim(p_selected_text) = '' then
    raise exception using
      errcode = '22023',
      message = 'Selected text is required.';
  end if;

  if pg_catalog.char_length(p_selected_text) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'Selected text cannot exceed 2,000 characters.';
  end if;

  if p_commentary_text is null then
    raise exception using
      errcode = '22023',
      message = 'Commentary text is required.';
  end if;

  if pg_catalog.char_length(p_commentary_text) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'Commentary text cannot exceed 2,000 characters.';
  end if;

  if p_text_prefix is not null and pg_catalog.char_length(p_text_prefix) > 500 then
    raise exception using
      errcode = '22023',
      message = 'Text prefix cannot exceed 500 characters.';
  end if;

  if p_text_suffix is not null and pg_catalog.char_length(p_text_suffix) > 500 then
    raise exception using
      errcode = '22023',
      message = 'Text suffix cannot exceed 500 characters.';
  end if;

  insert into public.sources (
    normalized_url,
    canonical_url,
    source_type,
    title,
    author,
    publisher
  )
  values (
    safe_normalized_url,
    safe_canonical_url,
    'article',
    nullif(pg_catalog.btrim(p_page_title), ''),
    nullif(pg_catalog.btrim(p_author), ''),
    nullif(pg_catalog.btrim(p_publisher), '')
  )
  on conflict (normalized_url, source_type) do nothing
  returning id into source_id;

  if source_id is null then
    select id
    into source_id
    from public.sources as existing_source
    where existing_source.normalized_url = safe_normalized_url
      and existing_source.source_type = 'article';
  end if;

  if source_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'The article source could not be created or reused.';
  end if;

  insert into public.annotations (
    source_id,
    user_id,
    annotation_type,
    commentary_text,
    status,
    published_at
  )
  values (
    source_id,
    caller_id,
    'article_text',
    p_commentary_text,
    'published',
    pg_catalog.now()
  )
  returning id into annotation_id;

  insert into public.annotation_targets (
    annotation_id,
    target_type,
    selected_text,
    text_prefix,
    text_suffix
  )
  values (
    annotation_id,
    'text',
    p_selected_text,
    p_text_prefix,
    p_text_suffix
  );

  return annotation_id;
end;
$$;

comment on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) is
  'Atomically publishes one article-text annotation for auth.uid(). Inserts or reuses only the article source for (normalized_url, source_type). SECURITY INVOKER and an empty search_path preserve RLS.';

revoke all on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.begin_hosted_youtube_annotation(
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

  if p_commentary_text is null then
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
  on conflict (normalized_url, source_type) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select id
    into v_source_id
    from public.sources
    where sources.normalized_url = safe_normalized_url
      and sources.source_type = 'youtube';
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The YouTube source could not be created or reused.';
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
  'Atomically creates a private draft YouTube annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid(). Reuses only the youtube source for (normalized_url, source_type).';

revoke all on function public.begin_hosted_youtube_annotation(
  text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_youtube_annotation(
  text, text, text, text, text, integer, integer, text
) to authenticated;

create or replace function public.begin_hosted_audio_annotation(
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
  if safe_normalized_url ~* '^https?://open\.spotify\.com/(intl-[a-z]{2}(-[a-z0-9]{2,8})?/)?(embed/)?episode/[A-Za-z0-9]{22}(/|$)'
  then
    raise exception using
      errcode = '22023',
      message = 'Podcast audio clips cannot use a Spotify episode URL. Use the Spotify hosted begin path.';
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

  if p_commentary_text is null then
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
  on conflict (normalized_url, source_type) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select id
    into v_source_id
    from public.sources
    where sources.normalized_url = safe_normalized_url
      and sources.source_type = 'podcast';
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The audio source could not be created or reused.';
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
  'Atomically creates a private draft podcast annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid(). Inserts or reuses only the podcast source for (normalized_url, source_type). Rejects Spotify episode identity.';

revoke all on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) to authenticated;
create or replace function public.begin_hosted_spotify_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_episode_id text,
  p_episode_title text,
  p_author text,
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
  v_annotation_id uuid := pg_catalog.gen_random_uuid();
  v_media_id uuid := pg_catalog.gen_random_uuid();
  v_creator_handle text;
  v_annotation_slug text;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
  safe_episode_id text := pg_catalog.btrim(p_episode_id);
  expected_url text;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to begin a hosted Spotify annotation.';
  end if;

  if safe_episode_id is null or safe_episode_id !~ '^[A-Za-z0-9]{22}$' then
    raise exception using errcode = '22023', message = 'A valid Spotify episode ID is required.';
  end if;
  expected_url := 'https://open.spotify.com/episode/' || safe_episode_id;
  if safe_normalized_url is distinct from expected_url then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL must identify exactly one canonical Spotify episode.';
  end if;
  if safe_canonical_url is distinct from expected_url then
    raise exception using
      errcode = '22023',
      message = 'The canonical URL must be the canonical Spotify episode URL.';
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

  if p_commentary_text is null then
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
    'spotify',
    nullif(pg_catalog.btrim(p_episode_title), ''),
    nullif(pg_catalog.btrim(p_author), ''),
    'Spotify',
    pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'episode_id', safe_episode_id,
        'show_name', nullif(pg_catalog.btrim(p_show_name), '')
      )
    )
  )
  on conflict (normalized_url, source_type) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select id
    into v_source_id
    from public.sources
    where sources.normalized_url = safe_normalized_url
      and sources.source_type = 'spotify';
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The Spotify source could not be created or reused.';
  end if;

  v_annotation_slug := private.generate_annotation_slug(
    caller_id,
    v_annotation_id,
    p_episode_title,
    'spotify-clip'
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

comment on function public.begin_hosted_spotify_annotation(
  text, text, text, text, text, text, integer, integer, text
) is
  'Atomically creates a private draft Spotify episode annotation, target, generated route identity, and capture-pending hosted-audio row for auth.uid(). Reuses only the spotify source for (normalized_url, source_type). Episode-URL identity stays spotify and is not merged with podcast or article rows.';

revoke all on function public.begin_hosted_spotify_annotation(
  text, text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_spotify_annotation(
  text, text, text, text, text, text, integer, integer, text
) to authenticated;

-- Generic podcast begin must not steal Spotify episode identity.

create or replace function public.begin_hosted_tiktok_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_video_id text,
  p_video_title text,
  p_author text,
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
  v_annotation_id uuid := pg_catalog.gen_random_uuid();
  v_media_id uuid := pg_catalog.gen_random_uuid();
  v_creator_handle text;
  v_annotation_slug text;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
  safe_video_id text := pg_catalog.btrim(p_video_id);
  extracted_handle text;
  expected_url text;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to begin a hosted TikTok annotation.';
  end if;

  if safe_video_id is null or safe_video_id !~ '^[0-9]{10,25}$' then
    raise exception using errcode = '22023', message = 'A valid TikTok video ID is required.';
  end if;
  if safe_normalized_url is null
    or safe_normalized_url !~ '^https://www\.tiktok\.com/@[A-Za-z0-9._]{2,24}/video/[0-9]{10,25}$'
  then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL must identify exactly one canonical TikTok video.';
  end if;
  extracted_handle := (pg_catalog.regexp_match(
    safe_normalized_url,
    '^https://www\.tiktok\.com/@([A-Za-z0-9._]{2,24})/video/[0-9]{10,25}$'
  ))[1];
  if extracted_handle is null then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL must identify exactly one canonical TikTok video.';
  end if;
  expected_url := 'https://www.tiktok.com/@' || extracted_handle || '/video/' || safe_video_id;
  if safe_normalized_url is distinct from expected_url then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL must identify exactly one canonical TikTok video.';
  end if;
  if safe_canonical_url is distinct from expected_url then
    raise exception using
      errcode = '22023',
      message = 'The canonical URL must be the canonical TikTok watch URL.';
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

  if p_commentary_text is null then
    raise exception using errcode = '22023', message = 'Commentary text is required.';
  end if;
  if pg_catalog.char_length(p_commentary_text) > 2000 then
    raise exception using errcode = '22023', message = 'Commentary text cannot exceed 2,000 characters.';
  end if;
  if p_video_title is not null and pg_catalog.char_length(p_video_title) > 500 then
    raise exception using errcode = '22023', message = 'Video title cannot exceed 500 characters.';
  end if;
  if p_author is not null and pg_catalog.char_length(p_author) > 500 then
    raise exception using errcode = '22023', message = 'Author cannot exceed 500 characters.';
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
    'tiktok',
    nullif(pg_catalog.btrim(p_video_title), ''),
    coalesce(nullif(pg_catalog.btrim(p_author), ''), extracted_handle),
    'TikTok',
    pg_catalog.jsonb_build_object('video_id', safe_video_id, 'handle', extracted_handle)
  )
  on conflict (normalized_url, source_type) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select id
    into v_source_id
    from public.sources
    where sources.normalized_url = safe_normalized_url
      and sources.source_type = 'tiktok';
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The TikTok source could not be created or reused.';
  end if;

  v_annotation_slug := private.generate_annotation_slug(
    caller_id,
    v_annotation_id,
    p_video_title,
    'tiktok-clip'
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

comment on function public.begin_hosted_tiktok_annotation(
  text, text, text, text, text, integer, integer, text
) is
  'Atomically creates a private draft TikTok annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid(). Reuses only the tiktok source for (normalized_url, source_type). Watch-URL identity stays tiktok and is not merged with article or youtube rows.';

revoke all on function public.begin_hosted_tiktok_annotation(
  text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_tiktok_annotation(
  text, text, text, text, text, integer, integer, text
) to authenticated;

-- Webpage-video begin must not steal TikTok watch identity.

create or replace function public.begin_hosted_webpage_video_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_page_title text,
  p_author text,
  p_publisher text,
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
      message = 'Authentication is required to begin a hosted webpage video annotation.';
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
    raise exception using errcode = '22023', message = 'The canonical URL must match the normalized article page identity.';
  end if;
  if safe_normalized_url ~* '([?&])(utm_[^=]*|gclid|fbclid)=' then
    raise exception using errcode = '22023', message = 'The article page identity cannot contain tracking parameters.';
  end if;
  if safe_normalized_url ~* '^https?://(www\.|m\.)?youtube\.com/watch(\?|$)'
    or safe_normalized_url ~* '^https?://youtu\.be/'
  then
    raise exception using
      errcode = '22023',
      message = 'Webpage video clips cannot use a YouTube watch URL. Use the YouTube hosted begin path.';
  end if;
  if safe_normalized_url ~* '^https?://(www\.|m\.)?tiktok\.com/@[A-Za-z0-9._]+/video/'
  then
    raise exception using
      errcode = '22023',
      message = 'Webpage video clips cannot use a TikTok watch URL. Use the TikTok hosted begin path.';
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

  if p_commentary_text is null then
    raise exception using errcode = '22023', message = 'Commentary text is required.';
  end if;
  if pg_catalog.char_length(p_commentary_text) > 2000 then
    raise exception using errcode = '22023', message = 'Commentary text cannot exceed 2,000 characters.';
  end if;
  if p_page_title is not null and pg_catalog.char_length(p_page_title) > 500 then
    raise exception using errcode = '22023', message = 'Page title cannot exceed 500 characters.';
  end if;
  if p_author is not null and pg_catalog.char_length(p_author) > 500 then
    raise exception using errcode = '22023', message = 'Author cannot exceed 500 characters.';
  end if;
  if p_publisher is not null and pg_catalog.char_length(p_publisher) > 500 then
    raise exception using errcode = '22023', message = 'Publisher cannot exceed 500 characters.';
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
    'article',
    nullif(pg_catalog.btrim(p_page_title), ''),
    nullif(pg_catalog.btrim(p_author), ''),
    nullif(pg_catalog.btrim(p_publisher), ''),
    '{}'::jsonb
  )
  on conflict (normalized_url, source_type) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select id
    into v_source_id
    from public.sources
    where sources.normalized_url = safe_normalized_url
      and sources.source_type = 'article';
  end if;
  if v_source_id is null then
    raise exception using errcode = 'P0001', message = 'The article source could not be created or reused.';
  end if;

  v_annotation_slug := private.generate_annotation_slug(
    caller_id,
    v_annotation_id,
    p_page_title,
    'webpage-video-clip'
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

comment on function public.begin_hosted_webpage_video_annotation(
  text, text, text, text, text, integer, integer, text
) is
  'Atomically creates a private draft webpage-video annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid(). Inserts or reuses only the article source for (normalized_url, source_type) so article_text and video_clip can coexist on one page URL. Rejects YouTube and TikTok watch identity.';

revoke all on function public.begin_hosted_webpage_video_annotation(
  text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_webpage_video_annotation(
  text, text, text, text, text, integer, integer, text
) to authenticated;
