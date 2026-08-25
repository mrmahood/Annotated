begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_function( -- 1
  'public',
  'get_current_annotation_vote',
  array['uuid', 'uuid'],
  'the bounded current-user vote projection exists'
);
select is( -- 2
  pg_catalog.pg_get_function_result(
    'public.get_current_annotation_vote(uuid,uuid)'::regprocedure
  ),
  'TABLE(annotation_id uuid, current_vote smallint)',
  'the projection returns only annotation identity and the one current direction'
);
select ok( -- 3
  (
    select prosecdef
      and proconfig @> array['search_path=""']
      and proconfig @> array['statement_timeout=5s']
      and proconfig @> array['lock_timeout=2s']
    from pg_catalog.pg_proc
    where oid = 'public.get_current_annotation_vote(uuid,uuid)'::regprocedure
  ),
  'the projection has a hardened bounded definer context'
);
select ok( -- 4
  not pg_catalog.has_function_privilege(
    'public', 'public.get_current_annotation_vote(uuid,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.get_current_annotation_vote(uuid,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.get_current_annotation_vote(uuid,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.get_current_annotation_vote(uuid,uuid)', 'execute'
  ),
  'only the service role can execute the current-user projection'
);
select ok( -- 5
  not pg_catalog.has_table_privilege(
    'service_role', 'public.annotation_votes', 'select'
  ),
  'the projection does not weaken the direct vote-table privacy boundary'
);

insert into auth.users (id, raw_user_meta_data) values
  ('d2b00000-0000-4000-8000-000000000001', '{"full_name":"D2B Creator"}'::jsonb),
  ('d2b00000-0000-4000-8000-000000000002', '{"full_name":"D2B Voter"}'::jsonb),
  ('d2b00000-0000-4000-8000-000000000003', '{"full_name":"D2B Other"}'::jsonb);

update public.profiles
set username = 'd2b-creator'
where id = 'd2b00000-0000-4000-8000-000000000001';

insert into public.sources (
  id, normalized_url, canonical_url, source_type, title
) values (
  'd2b20000-0000-4000-8000-000000000001',
  'https://example.test/d2b/current-vote',
  'https://example.test/d2b/current-vote',
  'article',
  'D2b current vote projection'
);

insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values
  ('d2b10000-0000-4000-8000-000000000001', 'd2b20000-0000-4000-8000-000000000001', 'd2b00000-0000-4000-8000-000000000001', 'article_text', 'D2b published annotation', 'published', pg_catalog.now()),
  ('d2b10000-0000-4000-8000-000000000002', 'd2b20000-0000-4000-8000-000000000001', 'd2b00000-0000-4000-8000-000000000001', 'article_text', 'D2b draft annotation', 'draft', null);

set local role anon;
select throws_ok( -- 6
  $$select * from public.get_current_annotation_vote(
    'd2b00000-0000-4000-8000-000000000002',
    'd2b10000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'permission denied for function get_current_annotation_vote',
  'anonymous callers cannot inspect current-user vote state'
);
reset role;

set local role authenticated;
select throws_ok( -- 7
  $$select * from public.get_current_annotation_vote(
    'd2b00000-0000-4000-8000-000000000002',
    'd2b10000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'permission denied for function get_current_annotation_vote',
  'authenticated callers cannot substitute a user ID'
);
reset role;

set local role service_role;
select results_eq( -- 8
  $$select annotation_id, current_vote
    from public.get_current_annotation_vote(
      'd2b00000-0000-4000-8000-000000000002',
      'd2b10000-0000-4000-8000-000000000001'
    )$$,
  $$values ('d2b10000-0000-4000-8000-000000000001'::uuid, null::smallint)$$,
  'the trusted boundary returns an explicit no-vote state'
);
reset role;

select is( -- 9
  (select result_code from public.mutate_annotation_vote(
    'd2b00000-0000-4000-8000-000000000002',
    'd2b10000-0000-4000-8000-000000000001',
    1::smallint
  )),
  'CREATED',
  'the fixture vote is created only through the trusted mutation'
);

set local role service_role;
select results_eq( -- 10
  $$select annotation_id, current_vote
    from public.get_current_annotation_vote(
      'd2b00000-0000-4000-8000-000000000002',
      'd2b10000-0000-4000-8000-000000000001'
    )$$,
  $$values ('d2b10000-0000-4000-8000-000000000001'::uuid, 1::smallint)$$,
  'the projection returns only the exact verified user direction'
);
select results_eq( -- 11
  $$select annotation_id, current_vote
    from public.get_current_annotation_vote(
      'd2b00000-0000-4000-8000-000000000003',
      'd2b10000-0000-4000-8000-000000000001'
    )$$,
  $$values ('d2b10000-0000-4000-8000-000000000001'::uuid, null::smallint)$$,
  'another verified user cannot infer the voter direction'
);
select is_empty( -- 12
  $$select * from public.get_current_annotation_vote(
    'd2b00000-0000-4000-8000-000000000002',
    'd2b10000-0000-4000-8000-000000000002'
  )$$,
  'draft annotations expose no current-vote row'
);
select is_empty( -- 13
  $$select * from public.get_current_annotation_vote(
    'd2bfffff-0000-4000-8000-000000000001',
    'd2b10000-0000-4000-8000-000000000001'
  )$$,
  'unknown users expose no projection row'
);
select is_empty( -- 14
  $$select * from public.get_current_annotation_vote(
    'd2b00000-0000-4000-8000-000000000002',
    'd2bfffff-0000-4000-8000-000000000001'
  )$$,
  'unknown annotations expose no projection row'
);
reset role;

update public.annotations
set status = 'hidden'
where id = 'd2b10000-0000-4000-8000-000000000001';

set local role service_role;
select is_empty( -- 15
  $$select * from public.get_current_annotation_vote(
    'd2b00000-0000-4000-8000-000000000002',
    'd2b10000-0000-4000-8000-000000000001'
  )$$,
  'withdrawn annotations immediately stop exposing current-vote state'
);
reset role;

select ok( -- 16
  exists (
    select 1 from public.annotation_votes
    where annotation_id = 'd2b10000-0000-4000-8000-000000000001'
      and user_id = 'd2b00000-0000-4000-8000-000000000002'
      and value = 1
  ),
  'visibility withdrawal does not rewrite durable private vote state'
);

select * from finish();
rollback;
