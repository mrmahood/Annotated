-- What’s Trending v1: 7-day scored public discovery for the web Feed strip
-- and /trending page. Rows and boosts stay private to API roles. Public
-- clients read a bounded ranked list through a trusted function. Manual
-- boosts are Matt-only /ops mutations (service-role wrappers).
--
-- Locked score (owner 2026-09-12):
--   3×comments_7d
-- + 2×unique_commenters_7d
-- + 2×follows_on_author_7d
-- + 1×reshares_7d
-- + recency_boost (0.5 ^ (age_hours / 48))
-- + manual /ops boost
--
-- Author cap: at most one card per author. Hide threshold: return no rows
-- when fewer than 2 author-deduped scored items exist. Max 8 cards.
-- No view telemetry.

create table public.annotation_trending_boosts (
  annotation_id uuid primary key references public.annotations (id) on delete cascade,
  boost numeric(6, 2) not null,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid not null references public.profiles (id),
  constraint annotation_trending_boosts_boost_check check (
    boost > 0
    and boost <= 100
  )
);

alter table public.annotation_trending_boosts enable row level security;

revoke all privileges on table public.annotation_trending_boosts
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.annotation_trending_boosts
  to service_role;

comment on table public.annotation_trending_boosts is
  'Matt-only /ops ranking boosts for What’s Trending v1. Public clients never read or write this table; trusted list/set/clear functions expose only the intended surface.';

create function public.list_trending_annotations(p_limit integer default 8)
returns table (
  annotation_id uuid,
  score numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  window_start timestamptz := pg_catalog.now() - interval '7 days';
  half_life_seconds numeric := 172800;
begin
  if p_limit is null or p_limit < 1 or p_limit > 8 then
    raise exception using
      errcode = '22023',
      message = 'Trending limit must be between 1 and 8.';
  end if;

  return query
  with candidates as (
    select
      annotations.id,
      annotations.user_id,
      annotations.published_at
    from public.annotations
    where annotations.status = 'published'
      and (
        annotations.published_at >= window_start
        or exists (
          select 1
          from public.annotation_trending_boosts
          where annotation_trending_boosts.annotation_id = annotations.id
        )
        or exists (
          select 1
          from public.annotation_comments
          where annotation_comments.annotation_id = annotations.id
            and annotation_comments.status = 'public'
            and annotation_comments.created_at >= window_start
        )
        or exists (
          select 1
          from public.annotation_reshares
          where annotation_reshares.target_annotation_id = annotations.id
            and annotation_reshares.created_at >= window_start
        )
        or exists (
          select 1
          from public.profile_follows
          where profile_follows.followed_id = annotations.user_id
            and profile_follows.created_at >= window_start
        )
      )
  ),
  comment_stats as (
    select
      annotation_comments.annotation_id,
      pg_catalog.count(*)::numeric as comments_7d,
      pg_catalog.count(distinct annotation_comments.user_id)::numeric as unique_commenters_7d
    from public.annotation_comments
    where annotation_comments.status = 'public'
      and annotation_comments.created_at >= window_start
      and annotation_comments.annotation_id in (select candidates.id from candidates)
    group by annotation_comments.annotation_id
  ),
  follow_stats as (
    select
      profile_follows.followed_id as author_id,
      pg_catalog.count(*)::numeric as follows_7d
    from public.profile_follows
    where profile_follows.created_at >= window_start
      and profile_follows.followed_id in (select candidates.user_id from candidates)
    group by profile_follows.followed_id
  ),
  reshare_stats as (
    select
      annotation_reshares.target_annotation_id as annotation_id,
      pg_catalog.count(*)::numeric as reshares_7d
    from public.annotation_reshares
    where annotation_reshares.created_at >= window_start
      and annotation_reshares.target_annotation_id in (select candidates.id from candidates)
    group by annotation_reshares.target_annotation_id
  ),
  scored as (
    select
      candidates.id,
      candidates.user_id,
      candidates.published_at,
      (
        3 * coalesce(comment_stats.comments_7d, 0)
        + 2 * coalesce(comment_stats.unique_commenters_7d, 0)
        + 2 * coalesce(follow_stats.follows_7d, 0)
        + 1 * coalesce(reshare_stats.reshares_7d, 0)
        + pg_catalog.power(
          0.5::numeric,
          greatest(
            0::numeric,
            extract(epoch from (pg_catalog.now() - candidates.published_at))::numeric
              / half_life_seconds
          )
        )
        + coalesce(annotation_trending_boosts.boost, 0)
      ) as score
    from candidates
    left join comment_stats
      on comment_stats.annotation_id = candidates.id
    left join follow_stats
      on follow_stats.author_id = candidates.user_id
    left join reshare_stats
      on reshare_stats.annotation_id = candidates.id
    left join public.annotation_trending_boosts
      on annotation_trending_boosts.annotation_id = candidates.id
  ),
  author_best as (
    select
      scored.id,
      scored.published_at,
      scored.score,
      pg_catalog.row_number() over (
        partition by scored.user_id
        order by scored.score desc, scored.published_at desc, scored.id desc
      ) as author_rank
    from scored
    where scored.score > 0
  ),
  deduped as (
    select
      author_best.id,
      author_best.published_at,
      author_best.score,
      pg_catalog.count(*) over () as visible_count
    from author_best
    where author_best.author_rank = 1
  )
  select
    deduped.id,
    deduped.score
  from deduped
  where deduped.visible_count >= 2
  order by deduped.score desc, deduped.published_at desc, deduped.id desc
  limit p_limit;
end;
$$;

comment on function public.list_trending_annotations(integer) is
  'Web-only What’s Trending v1 list. Returns at most 8 published annotations scored over a 7-day window, one per author. Returns no rows when fewer than 2 scored items exist. Does not expose boost rows, follow edges, or view telemetry.';

revoke all on function public.list_trending_annotations(integer)
  from public, anon, authenticated;
grant execute on function public.list_trending_annotations(integer)
  to anon, authenticated;

create function private.set_annotation_trending_boost(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_boost numeric
)
returns table (
  annotation_id uuid,
  boost numeric,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  annotation_status text;
  stored public.annotation_trending_boosts%rowtype;
begin
  if p_actor_id is null then
    raise exception using
      errcode = '22023',
      message = 'An operator actor is required.';
  end if;

  if not exists (select 1 from public.profiles where profiles.id = p_actor_id) then
    raise exception using
      errcode = '22023',
      message = 'The operator profile is unavailable.';
  end if;

  if p_annotation_id is null then
    raise exception using
      errcode = '22023',
      message = 'An annotation ID is required.';
  end if;

  if p_boost is null or p_boost <= 0 or p_boost > 100 then
    raise exception using
      errcode = '22023',
      message = 'Boost must be greater than 0 and at most 100.';
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

  insert into public.annotation_trending_boosts (
    annotation_id,
    boost,
    updated_at,
    updated_by
  )
  values (
    p_annotation_id,
    pg_catalog.round(p_boost, 2),
    pg_catalog.now(),
    p_actor_id
  )
  on conflict on constraint annotation_trending_boosts_pkey do update
  set
    boost = excluded.boost,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into stored;

  annotation_id := stored.annotation_id;
  boost := stored.boost;
  updated_at := stored.updated_at;
  return next;
end;
$$;

comment on function private.set_annotation_trending_boost(uuid, uuid, numeric) is
  'Service-only upsert of a positive What’s Trending v1 /ops boost on a published annotation. Actor is the trusted caller session user id.';

revoke all on function private.set_annotation_trending_boost(uuid, uuid, numeric)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.set_annotation_trending_boost(uuid, uuid, numeric)
  to service_role;

create function public.set_annotation_trending_boost(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_boost numeric
)
returns table (
  annotation_id uuid,
  boost numeric,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.set_annotation_trending_boost(
    p_actor_id,
    p_annotation_id,
    p_boost
  );
$$;

comment on function public.set_annotation_trending_boost(uuid, uuid, numeric) is
  'Trusted-server wrapper for private.set_annotation_trending_boost. Execute is service_role only.';

revoke all on function public.set_annotation_trending_boost(uuid, uuid, numeric)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.set_annotation_trending_boost(uuid, uuid, numeric)
  to service_role;

create function private.clear_annotation_trending_boost(
  p_actor_id uuid,
  p_annotation_id uuid
)
returns table (
  annotation_id uuid,
  cleared boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  if p_actor_id is null then
    raise exception using
      errcode = '22023',
      message = 'An operator actor is required.';
  end if;

  if p_annotation_id is null then
    raise exception using
      errcode = '22023',
      message = 'An annotation ID is required.';
  end if;

  if not exists (select 1 from public.profiles where profiles.id = p_actor_id) then
    raise exception using
      errcode = '22023',
      message = 'The operator profile is unavailable.';
  end if;

  delete from public.annotation_trending_boosts
  where annotation_trending_boosts.annotation_id = p_annotation_id;
  get diagnostics deleted_count = row_count;

  annotation_id := p_annotation_id;
  cleared := deleted_count = 1;
  return next;
end;
$$;

comment on function private.clear_annotation_trending_boost(uuid, uuid) is
  'Service-only removal of a What’s Trending v1 /ops boost. Missing boosts are idempotent.';

revoke all on function private.clear_annotation_trending_boost(uuid, uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.clear_annotation_trending_boost(uuid, uuid)
  to service_role;

create function public.clear_annotation_trending_boost(
  p_actor_id uuid,
  p_annotation_id uuid
)
returns table (
  annotation_id uuid,
  cleared boolean
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.clear_annotation_trending_boost(
    p_actor_id,
    p_annotation_id
  );
$$;

comment on function public.clear_annotation_trending_boost(uuid, uuid) is
  'Trusted-server wrapper for private.clear_annotation_trending_boost. Execute is service_role only.';

revoke all on function public.clear_annotation_trending_boost(uuid, uuid)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.clear_annotation_trending_boost(uuid, uuid)
  to service_role;

create function private.list_annotation_trending_boosts()
returns table (
  annotation_id uuid,
  boost numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    annotation_trending_boosts.annotation_id,
    annotation_trending_boosts.boost,
    annotation_trending_boosts.updated_at
  from public.annotation_trending_boosts
  join public.annotations
    on annotations.id = annotation_trending_boosts.annotation_id
   and annotations.status = 'published'
  order by annotation_trending_boosts.updated_at desc, annotation_trending_boosts.annotation_id desc;
$$;

comment on function private.list_annotation_trending_boosts() is
  'Service-only list of current What’s Trending v1 /ops boosts on published annotations. Does not expose operator identity.';

revoke all on function private.list_annotation_trending_boosts()
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.list_annotation_trending_boosts()
  to service_role;

create function public.list_annotation_trending_boosts()
returns table (
  annotation_id uuid,
  boost numeric,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.list_annotation_trending_boosts();
$$;

comment on function public.list_annotation_trending_boosts() is
  'Trusted-server wrapper for private.list_annotation_trending_boosts. Execute is service_role only.';

revoke all on function public.list_annotation_trending_boosts()
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.list_annotation_trending_boosts()
  to service_role;
