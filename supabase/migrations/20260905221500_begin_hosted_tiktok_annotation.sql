-- Sprint 6: first-class TikTok watch identity. New hosted clips use
-- source_type = tiktok (not article) and a dedicated begin RPC so TikTok
-- URLs never collide with article or YouTube sources.

alter table public.sources
  drop constraint sources_source_type_check;

alter table public.sources
  add constraint sources_source_type_check check (
    source_type in ('article', 'youtube', 'podcast', 'tiktok')
  );

comment on constraint sources_source_type_check on public.sources is
  'Allowed source kinds. TikTok watch URLs are first-class and are not stored as article or youtube.';

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

  if p_commentary_text is null or pg_catalog.btrim(p_commentary_text) = '' then
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

  if p_commentary_text is null or pg_catalog.btrim(p_commentary_text) = '' then
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
