-- Bookmark v1: private bookmarks of published annotations for the signed-in
-- user. Rows are private to API roles; trusted functions expose create/remove,
-- caller state, and a newest-first owner list. No public save counts.

create table public.annotation_bookmarks (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  annotation_id uuid not null references public.annotations (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_bookmarks_user_annotation_key
    unique (user_id, annotation_id)
);

create index annotation_bookmarks_user_created_at_idx
  on public.annotation_bookmarks (user_id, created_at desc, id desc);

alter table public.annotation_bookmarks enable row level security;

revoke all privileges on table public.annotation_bookmarks
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.annotation_bookmarks to service_role;

comment on table public.annotation_bookmarks is
  'Private bookmarks of published annotations. Public clients use trusted functions; rows and counts are never client-readable.';

create function public.create_annotation_bookmark(p_annotation_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  annotation_status text;
  bookmark_id uuid;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to bookmark an annotation.';
  end if;

  if p_annotation_id is null then
    raise exception using
      errcode = '22023',
      message = 'An annotation ID is required.';
  end if;

  select annotations.status
  into annotation_status
  from public.annotations
  where annotations.id = p_annotation_id;

  if annotation_status is null or annotation_status <> 'published' then
    raise exception using
      errcode = '22023',
      message = 'That annotation is unavailable.';
  end if;

  insert into public.annotation_bookmarks (user_id, annotation_id)
  values (caller_id, p_annotation_id)
  returning annotation_bookmarks.id into bookmark_id;

  return bookmark_id;
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'You have already bookmarked this annotation.';
end;
$$;

comment on function public.create_annotation_bookmark(uuid) is
  'Creates at most one bookmark per caller and published target annotation, including the caller''s own published rows.';

revoke all on function public.create_annotation_bookmark(uuid)
  from public, anon, authenticated;
grant execute on function public.create_annotation_bookmark(uuid)
  to authenticated;

create function public.remove_annotation_bookmark(p_annotation_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  deleted_count bigint;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to remove a bookmark.';
  end if;

  if p_annotation_id is null then
    raise exception using
      errcode = '22023',
      message = 'An annotation ID is required.';
  end if;

  delete from public.annotation_bookmarks
  where annotation_bookmarks.user_id = caller_id
    and annotation_bookmarks.annotation_id = p_annotation_id;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

comment on function public.remove_annotation_bookmark(uuid) is
  'Removes at most one bookmark belonging to auth.uid() for the target annotation.';

revoke all on function public.remove_annotation_bookmark(uuid)
  from public, anon, authenticated;
grant execute on function public.remove_annotation_bookmark(uuid)
  to authenticated;

create function public.get_current_annotation_bookmarks(p_annotation_ids uuid[])
returns table (annotation_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to inspect bookmark state.';
  end if;

  if p_annotation_ids is null then
    raise exception using errcode = '22023', message = 'Annotation IDs are required.';
  end if;

  if pg_catalog.cardinality(p_annotation_ids) > 100 then
    raise exception using
      errcode = '22023',
      message = 'No more than 100 annotation IDs may be inspected at once.';
  end if;

  if pg_catalog.array_position(p_annotation_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Annotation IDs cannot contain null values.';
  end if;

  return query
  select distinct requested.requested_id
  from pg_catalog.unnest(p_annotation_ids) as requested(requested_id)
  join public.annotation_bookmarks
    on annotation_bookmarks.annotation_id = requested.requested_id
   and annotation_bookmarks.user_id = caller_id
  join public.annotations
    on annotations.id = requested.requested_id
   and annotations.status = 'published';
end;
$$;

comment on function public.get_current_annotation_bookmarks(uuid[]) is
  'Returns only the caller''s active bookmark targets for at most 100 published annotation IDs.';

revoke all on function public.get_current_annotation_bookmarks(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_current_annotation_bookmarks(uuid[])
  to authenticated;

create function public.list_current_annotation_bookmarks(
  p_limit integer,
  p_offset integer
)
returns table (
  annotation_id uuid,
  bookmarked_at timestamptz
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
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to list bookmarks.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'Bookmark list limit must be between 1 and 100.';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'Bookmark list offset must be zero or greater.';
  end if;

  return query
  select
    bookmarks.annotation_id,
    bookmarks.created_at
  from public.annotation_bookmarks as bookmarks
  join public.annotations
    on annotations.id = bookmarks.annotation_id
   and annotations.status = 'published'
  where bookmarks.user_id = caller_id
  order by bookmarks.created_at desc, bookmarks.id desc
  limit p_limit
  offset p_offset;
end;
$$;

comment on function public.list_current_annotation_bookmarks(integer, integer) is
  'Newest-first private bookmark list for auth.uid(). Only published annotations are returned; no public counts.';

revoke all on function public.list_current_annotation_bookmarks(integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_current_annotation_bookmarks(integer, integer)
  to authenticated;
