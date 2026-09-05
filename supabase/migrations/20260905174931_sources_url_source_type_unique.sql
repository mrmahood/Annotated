-- One webpage URL may carry article text, podcast/web-audio, and (where the
-- existing contract allows) YouTube. Deduplicate sources per
-- (normalized_url, source_type) instead of treating the URL as a single kind.
-- Publish/begin RPCs insert or reuse only the matching kind so an existing
-- article row cannot steal a later podcast clip, and vice versa.

alter table public.sources
  drop constraint sources_normalized_url_key;

alter table public.sources
  add constraint sources_normalized_url_source_type_key
  unique (normalized_url, source_type);

comment on constraint sources_normalized_url_source_type_key on public.sources is
  'One source row per normalized URL and source kind. Article, podcast, and YouTube identities may coexist for the same URL.';

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

  if p_commentary_text is null or pg_catalog.btrim(p_commentary_text) = '' then
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

create or replace function public.publish_audio_clip_annotation(
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
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  source_id uuid;
  annotation_id uuid;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to publish an audio clip.';
  end if;

  if safe_normalized_url is null or safe_normalized_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?][^#[:space:]]*)?$' then
    raise exception using errcode = '22023', message = 'The normalized URL must be a valid HTTP or HTTPS URL without a fragment.';
  end if;
  if safe_canonical_url is null or safe_canonical_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?][^#[:space:]]*)?$' then
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
    raise exception using errcode = '22023', message = 'A clip must be at least 1 second long.';
  end if;
  if p_end_ms - p_start_ms > 300000 then
    raise exception using errcode = '22023', message = 'A clip cannot be longer than 5 minutes.';
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

  insert into public.sources (
    normalized_url, canonical_url, source_type, title, author, publisher, metadata
  ) values (
    safe_normalized_url,
    safe_canonical_url,
    'podcast',
    nullif(pg_catalog.btrim(p_episode_title), ''),
    nullif(pg_catalog.btrim(p_author), ''),
    nullif(pg_catalog.btrim(p_publisher), ''),
    case when nullif(pg_catalog.btrim(p_show_name), '') is null
      then '{}'::jsonb
      else pg_catalog.jsonb_build_object('show_name', pg_catalog.btrim(p_show_name))
    end
  )
  on conflict (normalized_url, source_type) do nothing
  returning id into source_id;

  if source_id is null then
    select id into source_id
    from public.sources as existing_source
    where existing_source.normalized_url = safe_normalized_url
      and existing_source.source_type = 'podcast';
  end if;
  if source_id is null then
    raise exception using errcode = 'P0001', message = 'The audio source could not be created or reused.';
  end if;

  insert into public.annotations (
    source_id, user_id, annotation_type, commentary_text, status, published_at
  ) values (
    source_id, caller_id, 'audio_clip', p_commentary_text, 'published', pg_catalog.now()
  ) returning id into annotation_id;

  insert into public.annotation_targets (annotation_id, target_type, start_ms, end_ms)
  values (annotation_id, 'time_range', p_start_ms, p_end_ms);

  return annotation_id;
end;
$$;

comment on function public.publish_audio_clip_annotation(text, text, text, text, text, text, integer, integer, text) is
  'Atomically creates or reuses one podcast/web-audio source for (normalized_url, source_type) and publishes a typed time-range annotation owned only by auth.uid(). An existing article row for the same URL is not reused.';

revoke all on function public.publish_audio_clip_annotation(text, text, text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.publish_audio_clip_annotation(text, text, text, text, text, text, integer, integer, text)
  to authenticated;

create or replace function public.publish_youtube_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_video_id text,
  p_video_title text,
  p_channel_name text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  source_id uuid;
  annotation_id uuid;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
  safe_video_id text := pg_catalog.btrim(p_video_id);
  expected_url text;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to publish a YouTube annotation.';
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
    raise exception using errcode = '22023', message = 'A clip must be at least 1 second long.';
  end if;
  if p_end_ms - p_start_ms > 300000 then
    raise exception using errcode = '22023', message = 'A clip cannot be longer than 5 minutes.';
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
  returning id into source_id;

  if source_id is null then
    select id
    into source_id
    from public.sources as existing_source
    where existing_source.normalized_url = safe_normalized_url
      and existing_source.source_type = 'youtube';
  end if;

  if source_id is null then
    raise exception using errcode = 'P0001', message = 'The YouTube source could not be created or reused.';
  end if;

  insert into public.annotations (
    source_id,
    user_id,
    annotation_type,
    commentary_text,
    status,
    published_at
  ) values (
    source_id,
    caller_id,
    'video_clip',
    p_commentary_text,
    'published',
    pg_catalog.now()
  ) returning id into annotation_id;

  insert into public.annotation_targets (
    annotation_id,
    target_type,
    start_ms,
    end_ms
  ) values (
    annotation_id,
    'time_range',
    p_start_ms,
    p_end_ms
  );

  return annotation_id;
end;
$$;

comment on function public.publish_youtube_annotation(text, text, text, text, text, integer, integer, text) is
  'Atomically creates or reuses one YouTube source for (normalized_url, source_type). Watch-URL identity stays youtube and is not merged with article or podcast rows.';

revoke all on function public.publish_youtube_annotation(text, text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.publish_youtube_annotation(text, text, text, text, text, integer, integer, text)
  to authenticated;

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
  'Atomically creates a private draft podcast annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid(). Inserts or reuses only the podcast source for (normalized_url, source_type).';

revoke all on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) to authenticated;
