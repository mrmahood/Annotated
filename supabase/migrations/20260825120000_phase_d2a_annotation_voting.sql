create table public.annotation_votes (
  annotation_id uuid not null
    references public.annotations (id) on delete cascade,
  user_id uuid not null
    references public.profiles (id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (annotation_id, user_id),
  constraint annotation_votes_value_check check (value in (-1, 1))
);

create index annotation_votes_user_updated_at_idx
  on public.annotation_votes (user_id, updated_at desc);

create trigger annotation_votes_set_updated_at
before update on public.annotation_votes
for each row execute function public.set_updated_at();

alter table public.annotation_votes enable row level security;
alter table public.annotation_votes force row level security;

revoke all privileges on table public.annotation_votes
  from public, anon, authenticated, service_role;

comment on table public.annotation_votes is
  'Private one-row-per-user annotation votes. Rows and voter identities are never client-readable; trusted functions expose only the caller state and separate published totals.';

create table private.annotation_vote_pair_rate_limits (
  user_id uuid not null
    references public.profiles (id) on delete cascade,
  annotation_id uuid not null
    references public.annotations (id) on delete cascade,
  window_started_at timestamptz not null,
  mutation_count smallint not null,
  primary key (user_id, annotation_id),
  constraint annotation_vote_pair_rate_count_check check (
    mutation_count between 1 and 20
  )
);

create index annotation_vote_pair_rate_window_idx
  on private.annotation_vote_pair_rate_limits (window_started_at);

alter table private.annotation_vote_pair_rate_limits enable row level security;
alter table private.annotation_vote_pair_rate_limits force row level security;

revoke all privileges on table private.annotation_vote_pair_rate_limits
  from public, anon, authenticated, service_role;

comment on table private.annotation_vote_pair_rate_limits is
  'Private fixed-window state allowing at most 20 accepted vote mutation requests per user and annotation in ten minutes.';

create table private.annotation_vote_user_rate_limits (
  user_id uuid primary key
    references public.profiles (id) on delete cascade,
  window_started_at timestamptz not null,
  mutation_count smallint not null,
  constraint annotation_vote_user_rate_count_check check (
    mutation_count between 1 and 100
  )
);

create index annotation_vote_user_rate_window_idx
  on private.annotation_vote_user_rate_limits (window_started_at);

alter table private.annotation_vote_user_rate_limits enable row level security;
alter table private.annotation_vote_user_rate_limits force row level security;

revoke all privileges on table private.annotation_vote_user_rate_limits
  from public, anon, authenticated, service_role;

comment on table private.annotation_vote_user_rate_limits is
  'Private fixed-window state allowing at most 100 accepted vote mutation requests per user across annotations in ten minutes.';

create function public.get_public_annotation_vote_totals(
  p_annotation_ids uuid[]
)
returns table (
  annotation_id uuid,
  upvote_count bigint,
  downvote_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
declare
  requested_count integer;
  unique_count integer;
begin
  if p_annotation_ids is null then
    raise exception using
      errcode = '22023',
      message = 'Vote aggregate request is invalid.';
  end if;

  requested_count := pg_catalog.cardinality(p_annotation_ids);
  if requested_count > 100
    or exists (
      select 1
      from pg_catalog.unnest(p_annotation_ids) as requested(id)
      where requested.id is null
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Vote aggregate request is invalid.';
  end if;

  select pg_catalog.count(distinct requested.id)::integer
  into unique_count
  from pg_catalog.unnest(p_annotation_ids) as requested(id);

  if unique_count <> requested_count then
    raise exception using
      errcode = '22023',
      message = 'Vote aggregate request is invalid.';
  end if;

  return query
  select
    annotations.id,
    pg_catalog.count(votes.annotation_id)
      filter (where votes.value = 1)::bigint,
    pg_catalog.count(votes.annotation_id)
      filter (where votes.value = -1)::bigint
  from pg_catalog.unnest(p_annotation_ids) with ordinality
    as requested(id, ordinal)
  join public.annotations
    on annotations.id = requested.id
   and annotations.status = 'published'
  left join public.annotation_votes as votes
    on votes.annotation_id = annotations.id
  group by requested.ordinal, annotations.id
  order by requested.ordinal;
end;
$$;

comment on function public.get_public_annotation_vote_totals(uuid[]) is
  'Returns separate nonnegative totals for at most 100 unique published annotation IDs without exposing voter rows, identities, direction state, or timestamps.';

revoke all on function public.get_public_annotation_vote_totals(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_vote_totals(uuid[])
  to anon, authenticated, service_role;

create function public.mutate_annotation_vote(
  p_user_id uuid,
  p_annotation_id uuid,
  p_value smallint
)
returns table (
  result_code text,
  current_vote smallint,
  upvote_count bigint,
  downvote_count bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_annotation_owner uuid;
  v_annotation_status text;
  v_pair_window_started_at timestamptz;
  v_pair_mutation_count smallint;
  v_user_window_started_at timestamptz;
  v_user_mutation_count smallint;
  v_pair_retry integer := 0;
  v_user_retry integer := 0;
  v_existing_vote smallint;
  v_vote_exists boolean := false;
  v_result_code text;
  v_current_vote smallint;
  v_upvote_count bigint;
  v_downvote_count bigint;
begin
  if p_value is not null and p_value not in (-1, 1) then
    return query
    select 'INVALID_VOTE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  if p_user_id is null then
    return query
    select 'VOTE_UNAVAILABLE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  if p_annotation_id is null then
    return query
    select 'ANNOTATION_UNAVAILABLE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  -- A single per-user transaction lock serializes both the global and pair
  -- counters across every server instance. Hash collisions only reduce
  -- concurrency; they cannot weaken either rate limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('annotation-vote-user:' || p_user_id::text, 0)
  );

  perform 1
  from public.profiles
  where profiles.id = p_user_id
  for key share;

  if not found then
    return query
    select 'VOTE_UNAVAILABLE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  select annotations.user_id, annotations.status
  into v_annotation_owner, v_annotation_status
  from public.annotations
  where annotations.id = p_annotation_id
  for update;

  if not found or v_annotation_status <> 'published' then
    return query
    select 'ANNOTATION_UNAVAILABLE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  if v_annotation_owner = p_user_id then
    return query
    select 'SELF_VOTE_FORBIDDEN'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  -- Each accepted request performs bounded opportunistic cleanup. Expired
  -- rows are unnecessary after a fixed window closes; no schedule is needed.
  delete from private.annotation_vote_pair_rate_limits as stale
  where (stale.user_id, stale.annotation_id) in (
    select candidates.user_id, candidates.annotation_id
    from private.annotation_vote_pair_rate_limits as candidates
    where candidates.window_started_at <= v_now - interval '10 minutes'
    order by candidates.window_started_at, candidates.user_id, candidates.annotation_id
    limit 25
  );

  delete from private.annotation_vote_user_rate_limits as stale
  where stale.user_id in (
    select candidates.user_id
    from private.annotation_vote_user_rate_limits as candidates
    where candidates.window_started_at <= v_now - interval '10 minutes'
    order by candidates.window_started_at, candidates.user_id
    limit 25
  );

  select limits.window_started_at, limits.mutation_count
  into v_pair_window_started_at, v_pair_mutation_count
  from private.annotation_vote_pair_rate_limits as limits
  where limits.user_id = p_user_id
    and limits.annotation_id = p_annotation_id
  for update;

  if not found then
    v_pair_window_started_at := v_now;
    v_pair_mutation_count := 0;
  end if;

  select limits.window_started_at, limits.mutation_count
  into v_user_window_started_at, v_user_mutation_count
  from private.annotation_vote_user_rate_limits as limits
  where limits.user_id = p_user_id
  for update;

  if not found then
    v_user_window_started_at := v_now;
    v_user_mutation_count := 0;
  end if;

  if v_pair_mutation_count >= 20 then
    v_pair_retry := pg_catalog.greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from v_pair_window_started_at + interval '10 minutes' - v_now
        )
      )::integer
    );
  end if;

  if v_user_mutation_count >= 100 then
    v_user_retry := pg_catalog.greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from v_user_window_started_at + interval '10 minutes' - v_now
        )
      )::integer
    );
  end if;

  if v_pair_retry > 0 or v_user_retry > 0 then
    select votes.value
    into v_current_vote
    from public.annotation_votes as votes
    where votes.annotation_id = p_annotation_id
      and votes.user_id = p_user_id;

    select
      pg_catalog.count(votes.annotation_id)
        filter (where votes.value = 1)::bigint,
      pg_catalog.count(votes.annotation_id)
        filter (where votes.value = -1)::bigint
    into v_upvote_count, v_downvote_count
    from public.annotation_votes as votes
    where votes.annotation_id = p_annotation_id;

    return query
    select
      'RATE_LIMITED'::text,
      v_current_vote,
      v_upvote_count,
      v_downvote_count,
      pg_catalog.greatest(v_pair_retry, v_user_retry);
    return;
  end if;

  insert into private.annotation_vote_pair_rate_limits (
    user_id,
    annotation_id,
    window_started_at,
    mutation_count
  ) values (
    p_user_id,
    p_annotation_id,
    v_pair_window_started_at,
    (v_pair_mutation_count + 1)::smallint
  )
  on conflict (user_id, annotation_id) do update
  set window_started_at = excluded.window_started_at,
      mutation_count = excluded.mutation_count;

  insert into private.annotation_vote_user_rate_limits (
    user_id,
    window_started_at,
    mutation_count
  ) values (
    p_user_id,
    v_user_window_started_at,
    (v_user_mutation_count + 1)::smallint
  )
  on conflict (user_id) do update
  set window_started_at = excluded.window_started_at,
      mutation_count = excluded.mutation_count;

  select votes.value
  into v_existing_vote
  from public.annotation_votes as votes
  where votes.annotation_id = p_annotation_id
    and votes.user_id = p_user_id;
  v_vote_exists := found;

  if p_value is null then
    if v_vote_exists then
      delete from public.annotation_votes as votes
      where votes.annotation_id = p_annotation_id
        and votes.user_id = p_user_id;
      v_result_code := 'CLEARED';
    else
      v_result_code := 'UNCHANGED';
    end if;
    v_current_vote := null;
  elsif not v_vote_exists then
    insert into public.annotation_votes (annotation_id, user_id, value)
    values (p_annotation_id, p_user_id, p_value);
    v_result_code := 'CREATED';
    v_current_vote := p_value;
  elsif v_existing_vote = p_value then
    v_result_code := 'UNCHANGED';
    v_current_vote := p_value;
  else
    update public.annotation_votes as votes
    set value = p_value
    where votes.annotation_id = p_annotation_id
      and votes.user_id = p_user_id;
    v_result_code := 'CHANGED';
    v_current_vote := p_value;
  end if;

  select
    pg_catalog.count(votes.annotation_id)
      filter (where votes.value = 1)::bigint,
    pg_catalog.count(votes.annotation_id)
      filter (where votes.value = -1)::bigint
  into v_upvote_count, v_downvote_count
  from public.annotation_votes as votes
  where votes.annotation_id = p_annotation_id;

  return query
  select
    v_result_code,
    v_current_vote,
    v_upvote_count,
    v_downvote_count,
    null::integer;
end;
$$;

comment on function public.mutate_annotation_vote(uuid, uuid, smallint) is
  'Service-only atomic vote mutation. Disallows creator self-votes, requires a published annotation, enforces 20-per-pair and 100-per-user ten-minute fixed windows before changing a vote, and returns only bounded state/totals/retry data.';

revoke all on function public.mutate_annotation_vote(uuid, uuid, smallint)
  from public, anon, authenticated, service_role;
grant execute on function public.mutate_annotation_vote(uuid, uuid, smallint)
  to service_role;
