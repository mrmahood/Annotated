-- First-class Spotify episode identity. New hosted clips use
-- source_type = spotify (not podcast) and a dedicated begin RPC so
-- Spotify episode URLs never collide with generic podcast or article
-- sources. Capture still uses the proven audio tabCapture path.

alter table public.sources
  drop constraint sources_source_type_check;

alter table public.sources
  add constraint sources_source_type_check check (
    source_type in ('article', 'youtube', 'podcast', 'tiktok', 'spotify')
  );

comment on constraint sources_source_type_check on public.sources is
  'Allowed source kinds. Spotify episode URLs are first-class and are not stored as podcast or article.';

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
  'Atomically creates a private draft podcast annotation, target, generated route identity, and capture-pending hosted-media row for auth.uid(). Inserts or reuses only the podcast source for (normalized_url, source_type). Rejects Spotify episode identity.';

revoke all on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.begin_hosted_audio_annotation(
  text, text, text, text, text, text, integer, integer, text
) to authenticated;
