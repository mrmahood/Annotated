-- Share v1: in-ecosystem reshares of published annotations. Rows are private to
-- API roles; trusted functions expose create/remove, caller state, and a bounded
-- public/following timeline. Follow edges stay unreadable.

create table public.annotation_reshares (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  resharer_user_id uuid not null references public.profiles (id) on delete cascade,
  target_annotation_id uuid not null references public.annotations (id) on delete cascade,
  comment_text text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_reshares_resharer_target_key
    unique (resharer_user_id, target_annotation_id),
  constraint annotation_reshares_comment_length_check check (
    comment_text is null
    or (
      pg_catalog.btrim(comment_text) <> ''
      and pg_catalog.char_length(comment_text) <= 1000
    )
  )
);

create index annotation_reshares_target_created_at_idx
  on public.annotation_reshares (target_annotation_id, created_at desc, id desc);
create index annotation_reshares_resharer_created_at_idx
  on public.annotation_reshares (resharer_user_id, created_at desc, id desc);

alter table public.annotation_reshares enable row level security;

revoke all privileges on table public.annotation_reshares
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.annotation_reshares to service_role;

comment on table public.annotation_reshares is
  'In-ecosystem reshares of published annotations. Public clients use trusted functions; the follow graph is never exposed.';

create function private.normalize_reshare_comment(p_comment text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text;
begin
  if p_comment is null then
    return null;
  end if;

  normalized := pg_catalog.btrim(p_comment);
  if normalized = '' then
    return null;
  end if;

  if pg_catalog.char_length(normalized) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'Reshare comments cannot exceed 1,000 characters.';
  end if;

  return normalized;
end;
$$;

comment on function private.normalize_reshare_comment(text) is
  'Trims optional reshare comments, stores blank input as null, and enforces the 1,000-character comment norm.';
revoke all on function private.normalize_reshare_comment(text)
  from public, anon, authenticated;

create function public.create_annotation_reshare(
  p_annotation_id uuid,
  p_comment text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  annotation_status text;
  comment_text text;
  reshare_id uuid;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to share an annotation.';
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

  comment_text := private.normalize_reshare_comment(p_comment);

  insert into public.annotation_reshares (
    resharer_user_id,
    target_annotation_id,
    comment_text
  )
  values (caller_id, p_annotation_id, comment_text)
  returning annotation_reshares.id into reshare_id;

  return reshare_id;
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'You have already shared this annotation.';
end;
$$;

comment on function public.create_annotation_reshare(uuid, text) is
  'Creates at most one reshare per caller and published target annotation, including the caller''s own published rows. Optional comment text is not a new annotation.';

revoke all on function public.create_annotation_reshare(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_annotation_reshare(uuid, text)
  to authenticated;

create function public.remove_annotation_reshare(p_annotation_id uuid)
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
      message = 'Authentication is required to unshare an annotation.';
  end if;

  if p_annotation_id is null then
    raise exception using
      errcode = '22023',
      message = 'An annotation ID is required.';
  end if;

  delete from public.annotation_reshares
  where annotation_reshares.resharer_user_id = caller_id
    and annotation_reshares.target_annotation_id = p_annotation_id;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

comment on function public.remove_annotation_reshare(uuid) is
  'Removes at most one reshare belonging to auth.uid() for the immediate target annotation.';

revoke all on function public.remove_annotation_reshare(uuid)
  from public, anon, authenticated;
grant execute on function public.remove_annotation_reshare(uuid)
  to authenticated;

create function public.get_current_annotation_reshares(p_annotation_ids uuid[])
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
      message = 'Authentication is required to inspect reshare state.';
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
  join public.annotation_reshares
    on annotation_reshares.target_annotation_id = requested.requested_id
   and annotation_reshares.resharer_user_id = caller_id
  join public.annotations
    on annotations.id = requested.requested_id
   and annotations.status = 'published';
end;
$$;

comment on function public.get_current_annotation_reshares(uuid[]) is
  'Returns only the caller''s active reshare targets for at most 100 published annotation IDs.';

revoke all on function public.get_current_annotation_reshares(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_current_annotation_reshares(uuid[])
  to authenticated;

create function public.list_public_timeline_items(
  p_limit integer,
  p_offset integer,
  p_actor_id uuid default null
)
returns table (
  item_kind text,
  item_id uuid,
  occurred_at timestamptz,
  annotation_id uuid,
  resharer_user_id uuid,
  reshare_comment text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'Timeline limit must be between 1 and 100.';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'Timeline offset must be zero or greater.';
  end if;

  if p_actor_id is not null and not exists (
    select 1 from public.profiles where profiles.id = p_actor_id
  ) then
    return;
  end if;

  return query
  with items as (
    select
      'annotation'::text as item_kind,
      annotations.id as item_id,
      annotations.published_at as occurred_at,
      annotations.id as annotation_id,
      null::uuid as resharer_user_id,
      null::text as reshare_comment
    from public.annotations
    where annotations.status = 'published'
      and (p_actor_id is null or annotations.user_id = p_actor_id)

    union all

    select
      'reshare'::text,
      reshares.id,
      reshares.created_at,
      reshares.target_annotation_id,
      reshares.resharer_user_id,
      reshares.comment_text
    from public.annotation_reshares as reshares
    join public.annotations
      on annotations.id = reshares.target_annotation_id
     and annotations.status = 'published'
    where
      case
        when p_actor_id is not null then
          reshares.resharer_user_id = p_actor_id
        when viewer_id is not null then
          reshares.resharer_user_id = viewer_id
          or exists (
            select 1
            from public.profile_follows
            where profile_follows.follower_id = viewer_id
              and profile_follows.followed_id = reshares.resharer_user_id
          )
        else
          false
      end
  )
  select
    items.item_kind,
    items.item_id,
    items.occurred_at,
    items.annotation_id,
    items.resharer_user_id,
    items.reshare_comment
  from items
  order by items.occurred_at desc, items.item_id desc
  limit p_limit
  offset p_offset;
end;
$$;

comment on function public.list_public_timeline_items(integer, integer, uuid) is
  'Bounded annotation-first timeline. Anonymous home lists published annotations only. Signed-in home adds reshares by the viewer and followed profiles. Profile actor filters include that profile''s reshares without exposing follow rows.';

revoke all on function public.list_public_timeline_items(integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.list_public_timeline_items(integer, integer, uuid)
  to anon, authenticated;
