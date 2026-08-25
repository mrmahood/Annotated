begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

select has_function( -- 1
  'private',
  'get_reserved_root_handle_conflict_report',
  array[]::text[],
  'the bounded reserved-root conflict report exists'
);
select ok( -- 2
  not pg_catalog.has_function_privilege(
    'anon',
    'private.get_reserved_root_handle_conflict_report()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'private.get_reserved_root_handle_conflict_report()',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'private.get_reserved_root_handle_conflict_report()',
    'execute'
  ),
  'only the service role may execute the bounded conflict report'
);
select ok( -- 3
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'get_reserved_root_handle_conflict_report'
  ),
  'the conflict report is a security definer with an empty search path'
);
select ok( -- 4
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_reserved_root_check'
      and contype = 'c'
      and convalidated
  ),
  'the profile reserved-root constraint is validated'
);
select ok( -- 5
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.profile_handle_aliases'::regclass
      and conname = 'profile_handle_aliases_reserved_root_check'
      and contype = 'c'
      and convalidated
  ),
  'the handle-alias reserved-root constraint is validated'
);
select ok( -- 6
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''api'', ''auth'', ''_next'''
  ) > 0,
  'the controlled handle RPC explicitly rejects every reserved root'
);
select ok( -- 7
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('private.ensure_profile_handle(uuid)'::regprocedure),
    '''api'', ''auth'', ''_next'''
  ) > 0,
  'automatic handle generation explicitly skips every reserved root'
);
select ok( -- 8
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.guard_profile_handle_alias_insert()'::regprocedure
    ),
    '''api'', ''auth'', ''_next'''
  ) > 0,
  'the alias trigger explicitly rejects every reserved root'
);
select ok( -- 9
  (
    select current_handle_conflict_count = 0
      and handle_alias_conflict_count = 0
    from private.get_reserved_root_handle_conflict_report()
  ),
  'the Local preflight begins with zero reserved-root conflicts'
);

insert into auth.users (id, raw_user_meta_data)
values
  (
    'd1e00000-0000-4000-8000-000000000001',
    '{"full_name":"D1E Owner"}'::jsonb
  ),
  (
    'd1e10000-0000-4000-8000-000000000001',
    '{"full_name":"D1E Other"}'::jsonb
  ),
  (
    'd1e20000-0000-4000-8000-000000000001',
    '{"full_name":"API"}'::jsonb
  );

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'd1e00000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select throws_ok( -- 10
  $$select public.set_profile_handle('api')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the api root handle'
);
select throws_ok( -- 11
  $$select public.set_profile_handle(' AUTH ')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'reserved-root validation follows controlled normalization'
);
select throws_ok( -- 12
  $$select public.set_profile_handle('_next')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the Next.js internal root handle'
);
select lives_ok( -- 13
  $$select public.set_profile_handle('d1e-owner')$$,
  'a non-reserved creator handle remains assignable'
);
select lives_ok( -- 14
  $$select public.set_profile_handle('d1e-current')$$,
  'a valid handle change remains available'
);
reset role;

select is( -- 15
  (
    select pg_catalog.count(*)
    from public.profile_handle_aliases
    where profile_id = 'd1e00000-0000-4000-8000-000000000001'
      and handle = 'd1e-owner'
  ),
  1::bigint,
  'a valid prior handle still becomes a permanent alias'
);

select throws_ok( -- 16
  $$
    insert into public.profile_handle_aliases (handle, profile_id)
    values ('api', 'd1e10000-0000-4000-8000-000000000001')
  $$,
  '23514',
  'That creator handle is reserved for application routing.',
  'direct alias insertion cannot reserve api'
);
select throws_ok( -- 17
  $$
    insert into public.profile_handle_aliases (handle, profile_id)
    values ('auth', 'd1e10000-0000-4000-8000-000000000001')
  $$,
  '23514',
  'That creator handle is reserved for application routing.',
  'direct alias insertion cannot reserve auth'
);
select throws_ok( -- 18
  $$
    insert into public.profile_handle_aliases (handle, profile_id)
    values ('_next', 'd1e10000-0000-4000-8000-000000000001')
  $$,
  '23514',
  'That creator handle is reserved for application routing.',
  'direct alias insertion cannot reserve _next'
);

select throws_ok( -- 19
  $$
    update public.profiles
    set username = 'api'
    where id = 'd1e10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the table constraint blocks a privileged direct api assignment'
);
select throws_ok( -- 20
  $$
    update public.profiles
    set username = 'auth'
    where id = 'd1e10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the table constraint blocks a privileged direct auth assignment'
);
select throws_ok( -- 21
  $$
    update public.profiles
    set username = '_next'
    where id = 'd1e10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the table constraint blocks a privileged direct _next assignment'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'd1e00000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok( -- 22
  $$
    select public.publish_article_annotation(
      'https://example.test/d1e/current-route',
      'https://example.test/d1e/current-route',
      'D1E Current Route Article',
      'D1E Author',
      'D1E Publisher',
      'The D1e current-route selected passage.',
      null,
      null,
      'D1e current-route commentary'
    )
  $$,
  'article publication remains immediate after reserved-root hardening'
);
reset role;

select ok( -- 23
  (
    select annotations.slug ~ '^d1e-current-route-article-[0-9a-f]{8}$'
    from public.annotations
    where commentary_text = 'D1e current-route commentary'
  ),
  'the accepted title-derived slug keeps its stable UUID suffix'
);
select ok( -- 24
  (
    select resolved.annotation_id = annotations.id
      and resolved.current_creator_handle = 'd1e-current'
      and resolved.annotation_slug = annotations.slug
      and not resolved.matched_handle_is_alias
    from public.annotations
    cross join lateral public.resolve_public_annotation_route(
      'd1e-current',
      annotations.slug
    ) as resolved
    where annotations.commentary_text = 'D1e current-route commentary'
  ),
  'the current root handle and accepted slug resolve canonically'
);
select ok( -- 25
  (
    select resolved.annotation_id = annotations.id
      and resolved.current_creator_handle = 'd1e-current'
      and resolved.annotation_slug = annotations.slug
      and resolved.matched_handle_is_alias
    from public.annotations
    cross join lateral public.resolve_public_annotation_route(
      'd1e-owner',
      annotations.slug
    ) as resolved
    where annotations.commentary_text = 'D1e current-route commentary'
  ),
  'a valid historical handle still resolves to the current canonical route'
);
select is( -- 26
  (
    select resolved.current_creator_handle
    from public.annotations
    cross join lateral public.resolve_public_annotation_uuid(
      annotations.id
    ) as resolved
    where annotations.commentary_text = 'D1e current-route commentary'
  ),
  'd1e-current',
  'UUID compatibility still returns the current creator handle'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'd1e20000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok( -- 27
  $$
    select public.publish_article_annotation(
      'https://example.test/d1e/automatic-route',
      'https://example.test/d1e/automatic-route',
      'Reserved Route Article',
      'D1E Author',
      'D1E Publisher',
      'The D1e automatic-route selected passage.',
      null,
      null,
      'D1e automatic-route commentary'
    )
  $$,
  'automatic handle generation remains available for article publication'
);
reset role;

select ok( -- 28
  (
    select username = 'api-d1e20000'
      and username not in ('api', 'auth', '_next')
    from public.profiles
    where id = 'd1e20000-0000-4000-8000-000000000001'
  ),
  'an API display seed produces a safe suffixed handle, never the api root'
);
select ok( -- 29
  (
    select annotations.slug ~ '^reserved-route-article-[0-9a-f]{8}$'
    from public.annotations
    where commentary_text = 'D1e automatic-route commentary'
  ),
  'automatic publication preserves the accepted readable slug suffix contract'
);
select ok( -- 30
  (
    select resolved.annotation_id = annotations.id
      and resolved.current_creator_handle = 'api-d1e20000'
      and resolved.annotation_slug = annotations.slug
      and not resolved.matched_handle_is_alias
    from public.annotations
    cross join lateral public.resolve_public_annotation_route(
      'api-d1e20000',
      annotations.slug
    ) as resolved
    where annotations.commentary_text = 'D1e automatic-route commentary'
  ),
  'the safe automatically generated root route resolves canonically'
);
select is( -- 31
  (
    select pg_catalog.count(*)
    from public.annotations
    where commentary_text in (
      'D1e current-route commentary',
      'D1e automatic-route commentary'
    )
      and status = 'published'
  ),
  2::bigint,
  'both article regression fixtures remain published'
);
select ok( -- 32
  (
    select current_handle_conflict_count = 0
      and handle_alias_conflict_count = 0
    from private.get_reserved_root_handle_conflict_report()
  ),
  'the bounded report remains zero after all supported identity operations'
);
select is( -- 33
  (
    select pg_catalog.count(*)
    from public.profiles
    where pg_catalog.lower(username) in ('api', 'auth', '_next')
  ),
  0::bigint,
  'no current creator occupies a framework-owned root'
);
select is( -- 34
  (
    select pg_catalog.count(*)
    from public.profile_handle_aliases
    where handle in ('api', 'auth', '_next')
  ),
  0::bigint,
  'no historical alias occupies a framework-owned root'
);

select * from finish();
rollback;
