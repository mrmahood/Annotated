-- YouTube annotations reuse the existing youtube/video_clip/time_range model.
-- Align the typed target constraint with the MVP's 1-second to 5-minute range,
-- then expose one atomic authenticated publishing path.

alter table public.annotation_targets
  drop constraint annotation_targets_shape_check;

alter table public.annotation_targets
  add constraint annotation_targets_shape_check check (
    (
      target_type = 'text'
      and selected_text is not null
      and pg_catalog.char_length(selected_text) <= 2000
      and start_ms is null
      and end_ms is null
    )
    or
    (
      target_type = 'time_range'
      and selected_text is null
      and start_ms is not null
      and end_ms is not null
      and start_ms >= 0
      and end_ms - start_ms between 1000 and 300000
    )
  );

comment on constraint annotation_targets_shape_check on public.annotation_targets is
  'Text targets carry selected text; time-range targets carry integer milliseconds and must span 1 second through 5 minutes.';

create function public.publish_youtube_annotation(
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
  source_kind text;
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
  on conflict (normalized_url) do nothing
  returning id, source_type into source_id, source_kind;

  if source_id is null then
    select id, source_type
    into source_id, source_kind
    from public.sources as existing_source
    where existing_source.normalized_url = safe_normalized_url;
  end if;

  if source_id is null then
    raise exception using errcode = 'P0001', message = 'The YouTube source could not be created or reused.';
  end if;
  if source_kind <> 'youtube' then
    raise exception using errcode = '22023', message = 'The normalized URL belongs to a non-YouTube source.';
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
  'Atomically creates or reuses one canonical YouTube source and publishes a typed millisecond time-range annotation owned only by auth.uid().';

revoke all on function public.publish_youtube_annotation(text, text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.publish_youtube_annotation(text, text, text, text, text, integer, integer, text)
  to authenticated;
