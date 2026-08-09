-- Initial social interactions: private follow edges, public profile counts, and
-- flat comments on published annotations.

create table public.profile_follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followed_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  constraint profile_follows_pkey primary key (follower_id, followed_id),
  constraint profile_follows_no_self_follow check (follower_id <> followed_id)
);

create index profile_follows_followed_id_idx
  on public.profile_follows (followed_id);

create table public.annotation_comments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  annotation_id uuid not null references public.annotations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  status text not null default 'public',
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_comments_status_check check (
    status in ('public', 'removed')
  ),
  constraint annotation_comments_body_length_check check (
    pg_catalog.btrim(body) <> ''
    and pg_catalog.char_length(body) <= 1000
  )
);

create index annotation_comments_public_annotation_order_idx
  on public.annotation_comments (annotation_id, status, created_at, id);
create index annotation_comments_user_id_idx
  on public.annotation_comments (user_id);

alter table public.profile_follows enable row level security;
alter table public.annotation_comments enable row level security;

revoke all privileges on table public.profile_follows
  from public, anon, authenticated, service_role;
revoke all privileges on table public.annotation_comments
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.profile_follows to service_role;
grant select, insert, update, delete on table public.annotation_comments to service_role;
grant insert on table public.profile_follows to authenticated;

create policy profile_follows_owner_insert
on public.profile_follows
for insert
to authenticated
with check ((select auth.uid()) = follower_id);

create policy profile_follows_owner_delete
on public.profile_follows
for delete
to authenticated
using ((select auth.uid()) = follower_id);

grant select on table public.annotation_comments to anon, authenticated;
grant insert, delete on table public.annotation_comments to authenticated;

create policy annotation_comments_public_read
on public.annotation_comments
for select
to anon, authenticated
using (
  status = 'public'
  and exists (
    select 1
    from public.annotations
    where annotations.id = annotation_comments.annotation_id
      and annotations.status = 'published'
  )
);

create policy annotation_comments_owner_insert
on public.annotation_comments
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'public'
  and exists (
    select 1
    from public.annotations
    where annotations.id = annotation_comments.annotation_id
      and annotations.status = 'published'
  )
);

create policy annotation_comments_owner_delete
on public.annotation_comments
for delete
to authenticated
using ((select auth.uid()) = user_id);

create function public.get_profile_social_counts(p_profile_id uuid)
returns table (follower_count bigint, following_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_profile_id is null then
    raise exception using errcode = '22023', message = 'A profile ID is required.';
  end if;

  if not exists (
    select 1 from public.profiles where profiles.id = p_profile_id
  ) then
    return;
  end if;

  return query
  select
    (select pg_catalog.count(*) from public.profile_follows
     where profile_follows.followed_id = p_profile_id),
    (select pg_catalog.count(*) from public.profile_follows
     where profile_follows.follower_id = p_profile_id);
end;
$$;

comment on function public.get_profile_social_counts(uuid) is
  'Returns only aggregate follower/following counts for one existing public profile.';
revoke all on function public.get_profile_social_counts(uuid)
  from public, anon, authenticated;
grant execute on function public.get_profile_social_counts(uuid)
  to anon, authenticated;

create function public.is_following_profile(p_followed_id uuid)
returns boolean
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
      message = 'Authentication is required to inspect follow state.';
  end if;

  if p_followed_id is null then
    raise exception using
      errcode = '22023',
      message = 'A followed profile ID is required.';
  end if;

  return exists (
    select 1 from public.profile_follows
    where profile_follows.follower_id = caller_id
      and profile_follows.followed_id = p_followed_id
  );
end;
$$;

comment on function public.is_following_profile(uuid) is
  'Returns only whether auth.uid() follows one specified profile; it never exposes follow rows.';
revoke all on function public.is_following_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.is_following_profile(uuid) to authenticated;

create function public.unfollow_profile(p_followed_id uuid)
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
      message = 'Authentication is required to unfollow a profile.';
  end if;
  if p_followed_id is null then
    raise exception using errcode = '22023', message = 'A followed profile ID is required.';
  end if;

  delete from public.profile_follows
  where profile_follows.follower_id = caller_id
    and profile_follows.followed_id = p_followed_id;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

comment on function public.unfollow_profile(uuid) is
  'Removes at most one follow edge belonging to auth.uid() without granting graph reads.';
revoke all on function public.unfollow_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.unfollow_profile(uuid) to authenticated;

create function public.get_public_annotation_comment_counts(p_annotation_ids uuid[])
returns table (annotation_id uuid, comment_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_annotation_ids is null then
    raise exception using errcode = '22023', message = 'Annotation IDs are required.';
  end if;

  if pg_catalog.cardinality(p_annotation_ids) > 100 then
    raise exception using
      errcode = '22023',
      message = 'No more than 100 annotation IDs may be counted at once.';
  end if;

  if pg_catalog.array_position(p_annotation_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Annotation IDs cannot contain null values.';
  end if;

  return query
  with requested as (
    select distinct requested_id
    from pg_catalog.unnest(p_annotation_ids) as requested_ids(requested_id)
  )
  select annotations.id, pg_catalog.count(annotation_comments.id)
  from requested
  join public.annotations
    on annotations.id = requested.requested_id
   and annotations.status = 'published'
  left join public.annotation_comments
    on annotation_comments.annotation_id = annotations.id
   and annotation_comments.status = 'public'
  group by annotations.id;
end;
$$;

comment on function public.get_public_annotation_comment_counts(uuid[]) is
  'Returns bounded aggregate counts for public comments on published annotations without exposing comment bodies.';
revoke all on function public.get_public_annotation_comment_counts(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_public_annotation_comment_counts(uuid[])
  to anon, authenticated;

comment on table public.profile_follows is
  'Private follow edges. Public clients use aggregate/state functions instead of selecting this graph.';
comment on table public.annotation_comments is
  'Flat annotation comments with a deliberately narrow public/removed lifecycle; editing and replies are out of scope.';
