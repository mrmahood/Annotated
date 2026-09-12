begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select has_table('public', 'annotation_trending_boosts', 'annotation_trending_boosts table exists');
select columns_are(
  'public',
  'annotation_trending_boosts',
  array['annotation_id', 'boost', 'updated_at', 'updated_by'],
  'boost rows expose only the intended columns'
);
select col_is_pk(
  'public', 'annotation_trending_boosts', 'annotation_id',
  'at most one boost exists per annotation'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.annotation_trending_boosts'::regclass),
  'annotation_trending_boosts has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.annotation_trending_boosts', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_trending_boosts', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_trending_boosts', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_trending_boosts', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_trending_boosts', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_trending_boosts', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_trending_boosts', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_trending_boosts', 'delete'),
  'API roles cannot read or write trending boosts directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'anon',
    'public.list_trending_annotations(integer)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_trending_annotations(integer)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.set_annotation_trending_boost(uuid, uuid, numeric)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_annotation_trending_boost(uuid, uuid, numeric)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.clear_annotation_trending_boost(uuid, uuid)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.clear_annotation_trending_boost(uuid, uuid)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.list_annotation_trending_boosts()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_annotation_trending_boosts()',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.set_annotation_trending_boost(uuid, uuid, numeric)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.clear_annotation_trending_boost(uuid, uuid)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.list_annotation_trending_boosts()',
    'execute'
  ),
  'list is public; boost set/clear/list stay service_role only'
);
select ok(
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'list_trending_annotations'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'set_annotation_trending_boost'
  ),
  'trending functions are security definers with empty search paths'
);

insert into auth.users (id, raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Author One')),
  ('71000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Author Two')),
  ('71000000-0000-4000-8000-000000000003', pg_catalog.jsonb_build_object('full_name', 'Author Three')),
  ('71000000-0000-4000-8000-000000000004', pg_catalog.jsonb_build_object('full_name', 'Commenter One')),
  ('71000000-0000-4000-8000-000000000005', pg_catalog.jsonb_build_object('full_name', 'Commenter Two')),
  ('71000000-0000-4000-8000-000000000006', pg_catalog.jsonb_build_object('full_name', 'Follower Six')),
  ('71000000-0000-4000-8000-000000000007', pg_catalog.jsonb_build_object('full_name', 'Operator Seven'));

insert into public.sources (id, normalized_url, canonical_url, source_type, title)
values (
  '72000000-0000-4000-8000-000000000001',
  'https://example.test/trending-v1',
  'https://example.test/trending-v1',
  'article',
  'Trending v1'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'article_text',
  'Solo published A1',
  'published',
  pg_catalog.now()
);

select is_empty(
  $$select annotation_id from public.list_trending_annotations(8)$$,
  'fewer than two scored items hides the trending list'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values
  (
    '73000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002',
    'article_text',
    'Published B1',
    'published',
    pg_catalog.now()
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'article_text',
    'Second A2 same author',
    'published',
    pg_catalog.now() - interval '2 hours'
  ),
  (
    '73000000-0000-4000-8000-000000000004',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000003',
    'article_text',
    'Published C1',
    'published',
    pg_catalog.now()
  ),
  (
    '73000000-0000-4000-8000-000000000005',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'article_text',
    'Draft A',
    'draft',
    null
  ),
  (
    '73000000-0000-4000-8000-000000000006',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002',
    'article_text',
    'Hidden B',
    'hidden',
    pg_catalog.now()
  ),
  (
    '73000000-0000-4000-8000-000000000007',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000003',
    'article_text',
    'Old C without recent signal',
    'published',
    pg_catalog.now() - interval '10 days'
  );

insert into public.annotation_comments (id, annotation_id, user_id, body, status, created_at)
values
  (
    '74000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000004',
    'First comment',
    'public',
    pg_catalog.now()
  ),
  (
    '74000000-0000-4000-8000-000000000002',
    '73000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000005',
    'Second commenter',
    'public',
    pg_catalog.now()
  ),
  (
    '74000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000004',
    'Repeat commenter',
    'public',
    pg_catalog.now()
  ),
  (
    '74000000-0000-4000-8000-000000000004',
    '73000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000005',
    'Removed comment',
    'removed',
    pg_catalog.now()
  ),
  (
    '74000000-0000-4000-8000-000000000005',
    '73000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000004',
    'Stale comment',
    'public',
    pg_catalog.now() - interval '8 days'
  );

insert into public.profile_follows (follower_id, followed_id, created_at)
values (
  '71000000-0000-4000-8000-000000000006',
  '71000000-0000-4000-8000-000000000001',
  pg_catalog.now()
);

insert into public.annotation_reshares (
  id, resharer_user_id, target_annotation_id, comment_text, created_at
)
values (
  '75000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000006',
  '73000000-0000-4000-8000-000000000001',
  'Reshare A1',
  pg_catalog.now()
);

select results_eq(
  $$select annotation_id from public.list_trending_annotations(8)$$,
  $$values
    ('73000000-0000-4000-8000-000000000001'::uuid),
    ('73000000-0000-4000-8000-000000000004'::uuid),
    ('73000000-0000-4000-8000-000000000002'::uuid)
  $$,
  'ranked list keeps one card per author and omits draft, hidden, and stale rows'
);

select ok(
  (
    select pg_catalog.round(score, 4) = 17.0000
    from public.list_trending_annotations(8)
    where annotation_id = '73000000-0000-4000-8000-000000000001'
  ),
  'A1 score is 3×3 comments + 2×2 unique commenters + 2×1 follow + 1×1 reshare + recency 1'
);

select is_empty(
  $$select annotation_id from public.list_trending_annotations(8)
    where annotation_id in (
      '73000000-0000-4000-8000-000000000003',
      '73000000-0000-4000-8000-000000000005',
      '73000000-0000-4000-8000-000000000006',
      '73000000-0000-4000-8000-000000000007'
    )$$,
  'author cap drops A2; draft, hidden, and 10-day-old rows stay out'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.set_annotation_trending_boost(
    '71000000-0000-4000-8000-000000000007',
    '73000000-0000-4000-8000-000000000004',
    12
  )$$,
  '42501',
  null,
  'authenticated callers cannot set a trending boost'
);
select throws_ok(
  $$select public.clear_annotation_trending_boost(
    '71000000-0000-4000-8000-000000000007',
    '73000000-0000-4000-8000-000000000004'
  )$$,
  '42501',
  null,
  'authenticated callers cannot clear a trending boost'
);
select throws_ok(
  $$select * from public.list_annotation_trending_boosts()$$,
  '42501',
  null,
  'authenticated callers cannot list trending boosts'
);
select throws_ok(
  $$select * from public.annotation_trending_boosts$$,
  '42501',
  null,
  'authenticated callers cannot select boost rows'
);
reset role;

set local role anon;
select lives_ok(
  $$select annotation_id from public.list_trending_annotations(8)$$,
  'anonymous readers can load the public trending list'
);
select throws_ok(
  $$select public.set_annotation_trending_boost(
    '71000000-0000-4000-8000-000000000007',
    '73000000-0000-4000-8000-000000000004',
    12
  )$$,
  '42501',
  null,
  'anonymous callers cannot set a trending boost'
);
reset role;

select results_eq(
  $$select annotation_id, boost
    from public.set_annotation_trending_boost(
      '71000000-0000-4000-8000-000000000007',
      '73000000-0000-4000-8000-000000000004',
      20
    )$$,
  $$values ('73000000-0000-4000-8000-000000000004'::uuid, 20.00)$$,
  'service-role /ops can set a published boost'
);

select results_eq(
  $$select annotation_id from public.list_trending_annotations(8)$$,
  $$values
    ('73000000-0000-4000-8000-000000000004'::uuid),
    ('73000000-0000-4000-8000-000000000001'::uuid),
    ('73000000-0000-4000-8000-000000000002'::uuid)
  $$,
  'manual /ops boost lifts C1 above engagement-ranked A1'
);

select throws_ok(
  $$select public.set_annotation_trending_boost(
    '71000000-0000-4000-8000-000000000007',
    '73000000-0000-4000-8000-000000000005',
    10
  )$$,
  '22023',
  'That annotation is unavailable.',
  'draft targets cannot receive a trending boost'
);

select results_eq(
  $$select annotation_id, cleared
    from public.clear_annotation_trending_boost(
      '71000000-0000-4000-8000-000000000007',
      '73000000-0000-4000-8000-000000000004'
    )$$,
  $$values ('73000000-0000-4000-8000-000000000004'::uuid, true)$$,
  'service-role /ops can clear a boost'
);

select results_eq(
  $$select annotation_id from public.list_trending_annotations(8)$$,
  $$values
    ('73000000-0000-4000-8000-000000000001'::uuid),
    ('73000000-0000-4000-8000-000000000004'::uuid),
    ('73000000-0000-4000-8000-000000000002'::uuid)
  $$,
  'clearing the boost restores engagement ranking'
);

select throws_ok(
  $$select public.list_trending_annotations(0)$$,
  '22023',
  'Trending limit must be between 1 and 8.',
  'limit below 1 is rejected'
);
select throws_ok(
  $$select public.list_trending_annotations(9)$$,
  '22023',
  'Trending limit must be between 1 and 8.',
  'limit above 8 is rejected'
);

insert into auth.users (id, raw_user_meta_data)
select
  pg_catalog.format('71000000-0000-4000-8000-0000000000%02s', 10 + extras.n)::uuid,
  pg_catalog.jsonb_build_object('full_name', 'Extra ' || extras.n)
from generate_series(1, 7) as extras(n);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
select
  pg_catalog.format('73000000-0000-4000-8000-0000000000%02s', 10 + extras.n)::uuid,
  '72000000-0000-4000-8000-000000000001',
  pg_catalog.format('71000000-0000-4000-8000-0000000000%02s', 10 + extras.n)::uuid,
  'article_text',
  'Extra published ' || extras.n,
  'published',
  pg_catalog.now()
from generate_series(1, 7) as extras(n);

select is(
  (select pg_catalog.count(*) from public.list_trending_annotations(8)),
  8::bigint,
  'the public list returns at most eight cards'
);

select is(
  (
    select pg_catalog.count(*)
    from (
      select annotations.user_id
      from public.list_trending_annotations(8) as trending
      join public.annotations on annotations.id = trending.annotation_id
    ) as authors
  ),
  (
    select pg_catalog.count(distinct annotations.user_id)
    from public.list_trending_annotations(8) as trending
    join public.annotations on annotations.id = trending.annotation_id
  ),
  'returned cards never repeat an author'
);

select * from finish();
rollback;
