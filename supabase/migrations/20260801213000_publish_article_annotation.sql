-- Publish an article annotation as one database operation. The function is
-- deliberately SECURITY INVOKER: it never bypasses RLS or gains service-role
-- behavior, and the authenticated caller still needs the existing table grants.
create function public.publish_article_annotation(
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
  source_kind text;
  annotation_id uuid;
  safe_normalized_url text := pg_catalog.btrim(p_normalized_url);
  safe_canonical_url text := pg_catalog.btrim(p_canonical_url);
begin
  -- Identity comes only from the verified JWT exposed by auth.uid(); accepting a
  -- user_id argument here would allow callers to publish as another profile.
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

  -- The unique normalized_url constraint arbitrates concurrent publishers. A
  -- conflicting insert is followed by a read of the shared source row.
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
  on conflict (normalized_url) do nothing
  returning id, source_type into source_id, source_kind;

  if source_id is null then
    select id, source_type
    into source_id, source_kind
    from public.sources as existing_source
    where existing_source.normalized_url = safe_normalized_url;
  end if;

  if source_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'The article source could not be created or reused.';
  end if;

  if source_kind <> 'article' then
    raise exception using
      errcode = '22023',
      message = 'The normalized URL belongs to a non-article source.';
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
  'Atomically publishes one article-text annotation for auth.uid(). SECURITY INVOKER and an empty search_path preserve RLS, prevent object shadowing, and provide no service-role privileges.';

-- PostgreSQL grants function execution to PUBLIC by default. Remove that grant
-- explicitly so only authenticated API requests can enter the publishing path.
revoke all on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text) to authenticated;
