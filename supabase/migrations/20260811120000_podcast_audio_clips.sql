-- Podcast/web-audio clips reuse the existing podcast/audio_clip/time_range model.
-- This migration adds only the dedicated atomic authenticated publishing path.

create function public.publish_audio_clip_annotation(
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
  source_kind text;
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
  on conflict (normalized_url) do nothing
  returning id, source_type into source_id, source_kind;

  if source_id is null then
    select id, source_type into source_id, source_kind
    from public.sources as existing_source
    where existing_source.normalized_url = safe_normalized_url;
  end if;
  if source_id is null then
    raise exception using errcode = 'P0001', message = 'The audio source could not be created or reused.';
  end if;
  if source_kind <> 'podcast' then
    raise exception using errcode = '22023', message = 'The normalized URL belongs to a non-audio source.';
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
  'Atomically creates or reuses one normalized podcast/web-audio episode source and publishes a typed time-range annotation owned only by auth.uid().';

revoke all on function public.publish_audio_clip_annotation(text, text, text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.publish_audio_clip_annotation(text, text, text, text, text, text, integer, integer, text)
  to authenticated;
