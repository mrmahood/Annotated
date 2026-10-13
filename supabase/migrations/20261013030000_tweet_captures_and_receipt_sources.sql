-- Preserve an x.com / twitter.com status with the annotation that cites it, and
-- store approved AI receipt sources when annotations.sources is not present.
-- Article publication is unchanged. Screenshot bytes stay in a public bucket
-- with the same owner-folder rule as annotation audio; the row is readable
-- only while the parent annotation is published.

create table public.annotation_tweet_captures (
  annotation_id uuid primary key
    references public.annotations (id) on delete cascade,
  status_url text not null,
  tweet_id text not null,
  author_handle text not null,
  author_name text,
  tweet_text text,
  posted_at timestamptz,
  embed jsonb not null,
  screenshot_path text unique,
  screenshot_width integer,
  screenshot_height integer,
  screenshot_byte_size integer,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_tweet_captures_status_url_check check (
    status_url = 'https://x.com/' || author_handle || '/status/' || tweet_id
  ),
  constraint annotation_tweet_captures_tweet_id_check check (
    tweet_id ~ '^[0-9]{1,20}$'
  ),
  constraint annotation_tweet_captures_handle_check check (
    author_handle ~ '^[a-z0-9_]{1,15}$'
  ),
  constraint annotation_tweet_captures_author_name_check check (
    author_name is null or (
      author_name = pg_catalog.btrim(author_name)
      and pg_catalog.char_length(author_name) between 1 and 80
    )
  ),
  constraint annotation_tweet_captures_tweet_text_check check (
    tweet_text is null or (
      tweet_text = pg_catalog.btrim(tweet_text)
      and pg_catalog.char_length(tweet_text) between 1 and 4000
    )
  ),
  constraint annotation_tweet_captures_embed_object_check check (
    pg_catalog.jsonb_typeof(embed) = 'object'
  ),
  constraint annotation_tweet_captures_screenshot_shape_check check (
    (
      screenshot_path is null
      and screenshot_width is null
      and screenshot_height is null
      and screenshot_byte_size is null
    )
    or (
      screenshot_path is not null
      and screenshot_width between 1 and 4096
      and screenshot_height between 1 and 4096
      and screenshot_byte_size between 1 and 1572864
    )
  )
);

comment on table public.annotation_tweet_captures is
  'Snapshot of one x.com status cited by an annotation: canonical post URL, author, text, and an optional cropped screenshot. Preserves the post after the original is deleted.';

alter table public.annotation_tweet_captures enable row level security;

revoke all privileges on table public.annotation_tweet_captures
  from public, anon, authenticated, service_role;
grant select on table public.annotation_tweet_captures to anon, authenticated;
grant select, insert, update, delete on table public.annotation_tweet_captures to service_role;

create policy annotation_tweet_captures_published_read
on public.annotation_tweet_captures
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_tweet_captures.annotation_id
      and annotations.status = 'published'
  )
);

comment on policy annotation_tweet_captures_published_read on public.annotation_tweet_captures is
  'Post snapshots are public only while the parent annotation is published. Clients cannot insert them directly.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'annotation-tweet-captures',
  'annotation-tweet-captures',
  true,
  1572864,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy annotation_tweet_captures_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'annotation-tweet-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy annotation_tweet_captures_owner_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'annotation-tweet-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy annotation_tweet_captures_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'annotation-tweet-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

comment on policy annotation_tweet_captures_owner_insert on storage.objects is
  'Authenticated users may upload only new JPEG post screenshots below their UUID folder; no UPDATE policy permits upsert.';

create function private.attach_annotation_tweet_capture(
  p_annotation_id uuid,
  p_status_url text,
  p_tweet_id text,
  p_author_handle text,
  p_author_name text,
  p_tweet_text text,
  p_posted_at timestamptz,
  p_screenshot_path text,
  p_screenshot_width integer,
  p_screenshot_height integer,
  p_screenshot_byte_size integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  source_canonical text;
  source_normalized text;
  safe_status_url text := pg_catalog.btrim(p_status_url);
  safe_tweet_id text := pg_catalog.btrim(p_tweet_id);
  safe_handle text := pg_catalog.lower(pg_catalog.btrim(p_author_handle));
  safe_author_name text := nullif(pg_catalog.btrim(p_author_name), '');
  safe_tweet_text text := nullif(pg_catalog.btrim(p_tweet_text), '');
  safe_path text := nullif(pg_catalog.btrim(p_screenshot_path), '');
  object_owner_id text;
  object_mime_type text;
  object_byte_size bigint;
  inserted_count integer;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to save a post capture.';
  end if;

  if safe_handle is null or safe_handle !~ '^[a-z0-9_]{1,15}$' then
    raise exception using
      errcode = '22023',
      message = 'The post author handle is invalid.';
  end if;

  if safe_tweet_id is null or safe_tweet_id !~ '^[0-9]{1,20}$' then
    raise exception using
      errcode = '22023',
      message = 'The post identifier is invalid.';
  end if;

  if safe_status_url is distinct from ('https://x.com/' || safe_handle || '/status/' || safe_tweet_id) then
    raise exception using
      errcode = '22023',
      message = 'The post URL is invalid.';
  end if;

  if safe_author_name is not null and pg_catalog.char_length(safe_author_name) > 80 then
    raise exception using
      errcode = '22023',
      message = 'The post author name is too long.';
  end if;

  if safe_tweet_text is not null and pg_catalog.char_length(safe_tweet_text) > 4000 then
    raise exception using
      errcode = '22023',
      message = 'The preserved post text is too long.';
  end if;

  select sources.canonical_url, sources.normalized_url
  into source_canonical, source_normalized
  from public.annotations
  join public.sources on sources.id = annotations.source_id
  where annotations.id = p_annotation_id
    and annotations.user_id = caller_id
    and annotations.status = 'published';

  if source_canonical is null then
    raise exception using
      errcode = '42501',
      message = 'The annotation is not owned by the authenticated user.';
  end if;

  if not (
    (
      source_canonical ~* '^https?://([a-z0-9-]+[.])*(x[.]com|twitter[.]com)(:[0-9]{1,5})?/'
      or source_normalized ~* '^https?://([a-z0-9-]+[.])*(x[.]com|twitter[.]com)(:[0-9]{1,5})?/'
    )
    and (
      source_canonical ~ ('/status/' || safe_tweet_id || '([/?#]|$)')
      or source_normalized ~ ('/status/' || safe_tweet_id || '([/?#]|$)')
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'The annotation source is not this post.';
  end if;

  if safe_path is null then
    if p_screenshot_width is not null
      or p_screenshot_height is not null
      or p_screenshot_byte_size is not null
    then
      raise exception using
        errcode = '22023',
        message = 'A post capture without a screenshot cannot include image metadata.';
    end if;
  else
    if safe_path !~ (
      '^' || caller_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    ) then
      raise exception using
        errcode = '22023',
        message = 'The screenshot storage path must belong to the authenticated user.';
    end if;

    if p_screenshot_width is null or p_screenshot_width not between 1 and 4096
      or p_screenshot_height is null or p_screenshot_height not between 1 and 4096
      or p_screenshot_byte_size is null or p_screenshot_byte_size not between 1 and 1572864
    then
      raise exception using
        errcode = '22023',
        message = 'The screenshot metadata is invalid.';
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
    where objects.bucket_id = 'annotation-tweet-captures'
      and objects.name = safe_path;

    if object_owner_id is null or object_owner_id <> caller_id::text then
      raise exception using
        errcode = '42501',
        message = 'The uploaded screenshot is not owned by the authenticated user.';
    end if;

    if object_mime_type <> 'image/jpeg'
      or object_byte_size is null
      or object_byte_size <> p_screenshot_byte_size
      or object_byte_size > 1572864
    then
      raise exception using
        errcode = '22023',
        message = 'The uploaded screenshot is invalid.';
    end if;
  end if;

  insert into public.annotation_tweet_captures (
    annotation_id,
    status_url,
    tweet_id,
    author_handle,
    author_name,
    tweet_text,
    posted_at,
    embed,
    screenshot_path,
    screenshot_width,
    screenshot_height,
    screenshot_byte_size
  )
  values (
    p_annotation_id,
    safe_status_url,
    safe_tweet_id,
    safe_handle,
    safe_author_name,
    safe_tweet_text,
    p_posted_at,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'url', safe_status_url,
      'tweet_id', safe_tweet_id,
      'author_handle', safe_handle,
      'author_name', safe_author_name,
      'author_url', 'https://x.com/' || safe_handle,
      'text', safe_tweet_text,
      'posted_at', case
        when p_posted_at is null then null
        else pg_catalog.to_char(p_posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      end
    )),
    safe_path,
    case when safe_path is null then null else p_screenshot_width end,
    case when safe_path is null then null else p_screenshot_height end,
    case when safe_path is null then null else p_screenshot_byte_size end
  )
  on conflict (annotation_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

comment on function private.attach_annotation_tweet_capture(
  uuid, text, text, text, text, text, timestamptz, text, integer, integer, integer
) is
  'SECURITY DEFINER attach for one owned published annotation whose source is the same status. Verifies an optional JPEG in annotation-tweet-captures and stores the post snapshot. Empty search_path. Not exposed on the Data API.';

revoke all on function private.attach_annotation_tweet_capture(
  uuid, text, text, text, text, text, timestamptz, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function private.attach_annotation_tweet_capture(
  uuid, text, text, text, text, text, timestamptz, text, integer, integer, integer
) to authenticated;

create function public.attach_annotation_tweet_capture(
  p_annotation_id uuid,
  p_status_url text,
  p_tweet_id text,
  p_author_handle text,
  p_author_name text,
  p_tweet_text text,
  p_posted_at timestamptz,
  p_screenshot_path text,
  p_screenshot_width integer,
  p_screenshot_height integer,
  p_screenshot_byte_size integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.attach_annotation_tweet_capture(
    p_annotation_id,
    p_status_url,
    p_tweet_id,
    p_author_handle,
    p_author_name,
    p_tweet_text,
    p_posted_at,
    p_screenshot_path,
    p_screenshot_width,
    p_screenshot_height,
    p_screenshot_byte_size
  );
end;
$$;

comment on function public.attach_annotation_tweet_capture(
  uuid, text, text, text, text, text, timestamptz, text, integer, integer, integer
) is
  'Attaches a preserved x.com status snapshot to an owned published annotation. SECURITY INVOKER entrypoint; privileged checks live in private.attach_annotation_tweet_capture.';

revoke all on function public.attach_annotation_tweet_capture(
  uuid, text, text, text, text, text, timestamptz, text, integer, integer, integer
) from public, anon;
grant execute on function public.attach_annotation_tweet_capture(
  uuid, text, text, text, text, text, timestamptz, text, integer, integer, integer
) to authenticated;

-- Approved AI receipt sources. The extension writes annotations.sources first
-- when that column exists (owned by a parallel sources field) and uses this
-- table only as the fallback. Readers merge both.
create table public.annotation_receipt_sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  annotation_id uuid not null
    references public.annotations (id) on delete cascade,
  url text not null,
  title text not null,
  publisher text,
  origin text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_receipt_sources_annotation_url_key unique (annotation_id, url),
  constraint annotation_receipt_sources_origin_check check (
    origin = 'ai-suggested'
  ),
  constraint annotation_receipt_sources_url_check check (
    pg_catalog.char_length(url) between 12 and 2000
    and url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[^[:space:]]*)?$'
  ),
  constraint annotation_receipt_sources_title_check check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 200
  ),
  constraint annotation_receipt_sources_publisher_check check (
    publisher is null or (
      publisher = pg_catalog.btrim(publisher)
      and pg_catalog.char_length(publisher) between 1 and 120
    )
  )
);

comment on table public.annotation_receipt_sources is
  'Approved AI-suggested primary sources for one annotation. A suggestion is not inserted until the creator approves it. At most three rows.';

create index annotation_receipt_sources_annotation_id_idx
  on public.annotation_receipt_sources (annotation_id, created_at);

alter table public.annotation_receipt_sources enable row level security;

revoke all privileges on table public.annotation_receipt_sources
  from public, anon, authenticated, service_role;
grant select on table public.annotation_receipt_sources to anon, authenticated;
grant insert on table public.annotation_receipt_sources to authenticated;
grant select, insert, update, delete on table public.annotation_receipt_sources to service_role;

create policy annotation_receipt_sources_published_read
on public.annotation_receipt_sources
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_receipt_sources.annotation_id
      and annotations.status = 'published'
  )
);

create policy annotation_receipt_sources_owner_insert
on public.annotation_receipt_sources
for insert
to authenticated
with check (
  origin = 'ai-suggested'
  and exists (
    select 1
    from public.annotations
    where annotations.id = annotation_receipt_sources.annotation_id
      and annotations.user_id = (select auth.uid())
      and annotations.status = 'published'
  )
);

comment on policy annotation_receipt_sources_owner_insert on public.annotation_receipt_sources is
  'Only the owner of a published annotation may attach an approved AI-suggested source. There is no client update or delete.';

create function private.limit_annotation_receipt_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select pg_catalog.count(*)
    from public.annotation_receipt_sources
    where annotation_receipt_sources.annotation_id = new.annotation_id
  ) >= 3 then
    raise exception using
      errcode = '23514',
      message = 'An annotation can have at most 3 receipt sources.';
  end if;
  return new;
end;
$$;

comment on function private.limit_annotation_receipt_sources() is
  'Trigger-only cap of three approved receipt sources per annotation. Empty search_path.';

revoke all on function private.limit_annotation_receipt_sources() from public, anon, authenticated;

create trigger annotation_receipt_sources_limit
before insert on public.annotation_receipt_sources
for each row execute function private.limit_annotation_receipt_sources();
