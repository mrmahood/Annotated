-- Phase D1e: reserve framework-owned first path segments before the accepted
-- /{creator-handle}/{annotation-slug} route can leave Local validation.
-- Existing identities are never renamed: the bounded preflight aborts instead.

create function private.get_reserved_root_handle_conflict_report()
returns table (
  current_handle_conflict_count bigint,
  handle_alias_conflict_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select pg_catalog.count(*)
      from public.profiles
      where pg_catalog.lower(profiles.username) in ('api', 'auth', '_next')
    ),
    (
      select pg_catalog.count(*)
      from public.profile_handle_aliases
      where profile_handle_aliases.handle in ('api', 'auth', '_next')
    )
$$;

comment on function private.get_reserved_root_handle_conflict_report() is
  'Service-only bounded counts for creator handles or aliases that collide with framework-owned public root segments; returns no identities.';
revoke all on function private.get_reserved_root_handle_conflict_report()
  from public, anon, authenticated, service_role;
grant execute on function private.get_reserved_root_handle_conflict_report()
  to service_role;

do $$
declare
  conflict_report record;
begin
  perform pg_catalog.pg_advisory_xact_lock(19020301);
  lock table public.profiles in share row exclusive mode;
  lock table public.profile_handle_aliases in share row exclusive mode;

  select * into conflict_report
  from private.get_reserved_root_handle_conflict_report();

  raise notice 'Phase D1e reserved-root preflight: current_handle_conflicts=%, handle_alias_conflicts=%',
    conflict_report.current_handle_conflict_count,
    conflict_report.handle_alias_conflict_count;

  if conflict_report.current_handle_conflict_count <> 0
    or conflict_report.handle_alias_conflict_count <> 0
  then
    raise exception using
      errcode = '23514',
      message = 'Creator route identities collide with framework-owned root handles.';
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_username_reserved_root_check check (
    username is null
    or pg_catalog.lower(username) not in ('api', 'auth', '_next')
  ) not valid;
alter table public.profiles
  validate constraint profiles_username_reserved_root_check;

comment on constraint profiles_username_reserved_root_check on public.profiles is
  'Creator handles cannot occupy framework-owned first path segments used by the canonical public annotation route.';

alter table public.profile_handle_aliases
  add constraint profile_handle_aliases_reserved_root_check check (
    handle not in ('api', 'auth', '_next')
  ) not valid;
alter table public.profile_handle_aliases
  validate constraint profile_handle_aliases_reserved_root_check;

comment on constraint profile_handle_aliases_reserved_root_check
  on public.profile_handle_aliases is
  'Historical creator handles cannot reserve framework-owned first path segments.';

create or replace function private.ensure_profile_handle(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_handle text;
  display_seed text;
  suffix_length integer;
  suffix text;
  base text;
  candidate text;
begin
  if p_profile_id is null then
    raise exception using errcode = '22023', message = 'A profile ID is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(19020301);

  select profiles.username, profiles.display_name
  into current_handle, display_seed
  from public.profiles
  where profiles.id = p_profile_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'The creator profile does not exist.';
  end if;
  if current_handle is not null then
    return current_handle;
  end if;

  foreach suffix_length in array array[8, 12, 16, 24]
  loop
    suffix := pg_catalog.left(pg_catalog.replace(p_profile_id::text, '-', ''), suffix_length);
    base := private.slugify_route_part(
      display_seed,
      'creator',
      30 - 1 - pg_catalog.char_length(suffix)
    );
    if pg_catalog.char_length(base) < 3 then
      base := 'creator';
    end if;
    candidate := base || '-' || suffix;

    if candidate not in ('api', 'auth', '_next')
      and not exists (
        select 1
        from public.profiles
        where pg_catalog.lower(profiles.username) = candidate
      )
      and not exists (
        select 1
        from public.profile_handle_aliases
        where profile_handle_aliases.handle = candidate
      )
    then
      update public.profiles
      set username = candidate
      where id = p_profile_id;
      return candidate;
    end if;
  end loop;

  raise exception using
    errcode = '23505',
    message = 'A unique creator handle could not be generated.';
end;
$$;

revoke all on function private.ensure_profile_handle(uuid)
  from public, anon, authenticated;

create or replace function private.guard_profile_handle_alias_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.handle in ('api', 'auth', '_next') then
    raise exception using
      errcode = '23514',
      message = 'That creator handle is reserved for application routing.';
  end if;
  if exists (
    select 1
    from public.profiles
    where pg_catalog.lower(profiles.username) = new.handle
  ) then
    raise exception using
      errcode = '23505',
      message = 'The handle is currently assigned to a creator.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_profile_handle_alias_insert()
  from public, anon, authenticated;

create or replace function public.set_profile_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  safe_handle text := pg_catalog.lower(pg_catalog.btrim(p_handle));
  current_handle text;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to change a creator handle.';
  end if;
  if safe_handle is null
    or pg_catalog.char_length(safe_handle) not between 3 and 30
    or safe_handle !~ '^[a-z0-9_-]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'A handle must be 3-30 lowercase letters, numbers, underscores, or hyphens.';
  end if;
  if safe_handle in ('api', 'auth', '_next') then
    raise exception using
      errcode = '22023',
      message = 'That creator handle is reserved for application routing.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(19020301);

  select username
  into current_handle
  from public.profiles
  where id = caller_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'The creator profile is unavailable.';
  end if;
  if current_handle = safe_handle then
    return safe_handle;
  end if;
  if exists (
    select 1 from public.profiles
    where pg_catalog.lower(profiles.username) = safe_handle
      and profiles.id <> caller_id
  ) or exists (
    select 1 from public.profile_handle_aliases
    where profile_handle_aliases.handle = safe_handle
  ) then
    raise exception using errcode = '23505', message = 'That creator handle is unavailable.';
  end if;

  update public.profiles
  set username = safe_handle
  where id = caller_id;

  if current_handle is not null then
    insert into public.profile_handle_aliases (handle, profile_id)
    values (current_handle, caller_id);
  end if;

  return safe_handle;
end;
$$;

revoke all on function public.set_profile_handle(text)
  from public, anon, authenticated;
grant execute on function public.set_profile_handle(text) to authenticated;
