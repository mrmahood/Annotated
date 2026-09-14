begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select ok( -- 1
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''api'', ''auth'', ''_next'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''ops'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''me'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''trending'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''who-to-follow'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''privacy'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''terms'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.set_profile_handle(text)'::regprocedure),
    '''legal'''
  ) > 0,
  'the controlled handle RPC rejects every application reserved root'
);
select ok( -- 2
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('private.ensure_profile_handle(uuid)'::regprocedure),
    '''api'', ''auth'', ''_next'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('private.ensure_profile_handle(uuid)'::regprocedure),
    '''who-to-follow'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('private.ensure_profile_handle(uuid)'::regprocedure),
    '''ops'''
  ) > 0,
  'automatic handle generation still skips reserved roots and adds app routes'
);
select ok( -- 3
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.guard_profile_handle_alias_insert()'::regprocedure
    ),
    '''me'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.guard_profile_handle_alias_insert()'::regprocedure
    ),
    '''legal'''
  ) > 0,
  'the alias trigger rejects the expanded reserved roots'
);
select ok( -- 4
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
    'a0e00000-0000-4000-8000-000000000001',
    '{"full_name":"App Root Owner"}'::jsonb
  ),
  (
    'a0e10000-0000-4000-8000-000000000001',
    '{"full_name":"App Root Other"}'::jsonb
  ),
  (
    'a0e20000-0000-4000-8000-000000000001',
    '{"full_name":"Ops"}'::jsonb
  );

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a0e00000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select throws_ok( -- 5
  $$select public.set_profile_handle('me')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the me root handle'
);
select throws_ok( -- 6
  $$select public.set_profile_handle(' OPS ')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'reserved-root validation follows controlled normalization for ops'
);
select throws_ok( -- 7
  $$select public.set_profile_handle('trending')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the trending root handle'
);
select throws_ok( -- 8
  $$select public.set_profile_handle('who-to-follow')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the who-to-follow root handle'
);
select throws_ok( -- 9
  $$select public.set_profile_handle('privacy')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the privacy root handle'
);
select throws_ok( -- 10
  $$select public.set_profile_handle('terms')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the terms root handle'
);
select throws_ok( -- 11
  $$select public.set_profile_handle('legal')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'an owner cannot assign the legal root handle'
);
select throws_ok( -- 12
  $$select public.set_profile_handle('api')$$,
  '22023',
  'That creator handle is reserved for application routing.',
  'framework-owned api remains reserved'
);
select lives_ok( -- 13
  $$select public.set_profile_handle('app-root-owner')$$,
  'a non-reserved creator handle remains assignable'
);
select lives_ok( -- 14
  $$select public.set_profile_handle('app-root-current')$$,
  'a later rename remains available and aliases the prior handle'
);
reset role;

select is( -- 15
  (
    select pg_catalog.count(*)
    from public.profile_handle_aliases
    where profile_id = 'a0e00000-0000-4000-8000-000000000001'
      and handle = 'app-root-owner'
  ),
  1::bigint,
  'a valid prior handle still becomes a permanent alias'
);

select throws_ok( -- 16
  $$
    insert into public.profile_handle_aliases (handle, profile_id)
    values ('me', 'a0e10000-0000-4000-8000-000000000001')
  $$,
  '23514',
  'That creator handle is reserved for application routing.',
  'direct alias insertion cannot reserve me'
);
select throws_ok( -- 17
  $$
    update public.profiles
    set username = 'ops'
    where id = 'a0e10000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the table constraint blocks a privileged direct ops assignment'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a0e20000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok( -- 18
  $$
    select public.publish_article_annotation(
      'https://example.test/app-root/automatic-route',
      'https://example.test/app-root/automatic-route',
      'Reserved App Root Article',
      'App Root Author',
      'App Root Publisher',
      'The reserved-app-root automatic selected passage.',
      null,
      null,
      'Reserved app-root automatic commentary'
    )
  $$,
  'first Create still auto-generates a handle via ensure_profile_handle'
);
reset role;

select ok( -- 19
  (
    select username = 'ops-a0e20000'
      and username not in (
        'api', 'auth', '_next', 'ops', 'me', 'trending', 'who-to-follow',
        'privacy', 'terms', 'legal'
      )
    from public.profiles
    where id = 'a0e20000-0000-4000-8000-000000000001'
  ),
  'an Ops display seed produces a safe suffixed handle, never the ops root'
);
select ok( -- 20
  (
    select resolved.annotation_id = annotations.id
      and resolved.current_creator_handle = 'ops-a0e20000'
      and not resolved.matched_handle_is_alias
    from public.annotations
    cross join lateral public.resolve_public_annotation_route(
      'ops-a0e20000',
      annotations.slug
    ) as resolved
    where annotations.commentary_text = 'Reserved app-root automatic commentary'
  ),
  'the safe automatically generated handle still resolves canonically'
);
select is( -- 21
  (
    select pg_catalog.count(*)
    from public.annotations
    where commentary_text = 'Reserved app-root automatic commentary'
      and status = 'published'
  ),
  1::bigint,
  'article publication remains immediate after reserved-app-root hardening'
);
select ok( -- 22
  (
    select current_handle_conflict_count = 0
      and handle_alias_conflict_count = 0
    from private.get_reserved_root_handle_conflict_report()
  ),
  'the bounded report remains zero after supported identity operations'
);
select is( -- 23
  (
    select pg_catalog.count(*)
    from public.profiles
    where pg_catalog.lower(username) in (
      'api', 'auth', '_next', 'ops', 'me', 'trending', 'who-to-follow',
      'privacy', 'terms', 'legal'
    )
  ),
  0::bigint,
  'no current creator occupies an application-owned root'
);
select is( -- 24
  (
    select pg_catalog.count(*)
    from public.profile_handle_aliases
    where handle in (
      'api', 'auth', '_next', 'ops', 'me', 'trending', 'who-to-follow',
      'privacy', 'terms', 'legal'
    )
  ),
  0::bigint,
  'no historical alias occupies an application-owned root'
);

select * from finish();
rollback;
