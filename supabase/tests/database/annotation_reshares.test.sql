begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select has_table('public', 'annotation_reshares', 'annotation_reshares table exists');
select columns_are(
  'public',
  'annotation_reshares',
  array['id', 'resharer_user_id', 'target_annotation_id', 'comment_text', 'created_at'],
  'reshare rows expose only the intended columns'
);
select col_is_pk(
  'public', 'annotation_reshares', 'id',
  'each reshare has a stable identity'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.annotation_reshares'::regclass
      and conname = 'annotation_reshares_resharer_target_key'
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'UNIQUE') > 0
  ),
  'at most one active reshare exists per user and immediate target annotation'
);
select has_index(
  'public',
  'annotation_reshares',
  'annotation_reshares_target_created_at_idx',
  'target-ordered reshare reads have a supporting index'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_reshares'::regclass),
  'annotation_reshares has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.annotation_reshares', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_reshares', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_reshares', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_reshares', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_reshares', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_reshares', 'delete'),
  'API roles cannot read or write reshare rows directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.create_annotation_reshare(uuid, text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_annotation_reshare(uuid, text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'anon',
    'public.list_public_timeline_items(integer, integer, uuid)',
    'execute'
  ),
  'create/remove stay authenticated; timeline listing is public'
);

insert into auth.users (id, raw_user_meta_data) values
  ('61000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Author One')),
  ('61000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Follower Two')),
  ('61000000-0000-4000-8000-000000000003', pg_catalog.jsonb_build_object('full_name', 'Stranger Three'));

insert into public.sources (id, normalized_url, canonical_url, source_type, title)
values (
  '62000000-0000-4000-8000-000000000001',
  'https://example.test/share-v1',
  'https://example.test/share-v1',
  'article',
  'Share v1'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values
  (
    '63000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'article_text',
    'Published original',
    'published',
    '2026-09-12T12:00:00Z'
  ),
  (
    '63000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'article_text',
    'Draft original',
    'draft',
    null
  ),
  (
    '63000000-0000-4000-8000-000000000003',
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'article_text',
    'Hidden original',
    'hidden',
    '2026-09-12T11:00:00Z'
  ),
  (
    '63000000-0000-4000-8000-000000000004',
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002',
    'article_text',
    'Follower original',
    'published',
    '2026-09-12T10:00:00Z'
  );

set local role anon;
select throws_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'anonymous reshare creation is denied'
);
select is_empty(
  $$select item_kind from public.list_public_timeline_items(20, 0, null) where item_kind = 'reshare'$$,
  'anonymous home timeline stays annotation-only'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000001', '  Own published share  ')$$,
  'users may reshare their own published annotations'
);
select throws_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000002')$$,
  '22023',
  'That annotation is unavailable.',
  'draft targets cannot be reshared'
);
select throws_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000003')$$,
  '22023',
  'That annotation is unavailable.',
  'hidden targets cannot be reshared'
);
select throws_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000001', 'again')$$,
  '23505',
  'You have already shared this annotation.',
  'duplicate reshare of the same immediate target is denied'
);
select throws_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000004', pg_catalog.repeat('x', 1001))$$,
  '22023',
  'Reshare comments cannot exceed 1,000 characters.',
  'reshare comments follow the 1,000-character comment norm'
);
select lives_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000004', '   ')$$,
  'whitespace-only reshare comments still create the row'
);
reset role;

select is(
  (select comment_text from public.annotation_reshares
    where resharer_user_id = '61000000-0000-4000-8000-000000000001'
      and target_annotation_id = '63000000-0000-4000-8000-000000000001'),
  'Own published share',
  'reshare comments are trimmed and stored on the reshare row'
);
select is(
  (select comment_text from public.annotation_reshares
    where resharer_user_id = '61000000-0000-4000-8000-000000000001'
      and target_annotation_id = '63000000-0000-4000-8000-000000000004'),
  null,
  'blank reshare comments are stored as null'
);

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000001', 'Nested share of an already shared annotation')$$,
  'a different user may reshare an already reshared published target'
);
select is(
  public.remove_annotation_reshare('63000000-0000-4000-8000-000000000004'),
  false,
  'unshare of another user''s target is a no-op'
);
reset role;

select is(
  (select count(*) from public.annotation_reshares
    where target_annotation_id = '63000000-0000-4000-8000-000000000001'),
  2::bigint,
  'nested reshares are unique per user against the immediate target annotation'
);

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.remove_annotation_reshare('63000000-0000-4000-8000-000000000001'),
  true,
  'owner unshare removes their reshare'
);
select lives_ok(
  $$select public.create_annotation_reshare('63000000-0000-4000-8000-000000000001')$$,
  'unshare frees the unique slot so the owner can share again'
);
select results_eq(
  $$select annotation_id from public.get_current_annotation_reshares(array[
    '63000000-0000-4000-8000-000000000001'::uuid,
    '63000000-0000-4000-8000-000000000004'::uuid
  ]) order by 1$$,
  $$values
    ('63000000-0000-4000-8000-000000000001'::uuid),
    ('63000000-0000-4000-8000-000000000004'::uuid)
  $$,
  'caller reshare state returns only their published targets'
);
reset role;

insert into public.profile_follows (follower_id, followed_id) values
  ('61000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001');

set local role anon;
select is_empty(
  $$select item_id from public.list_public_timeline_items(20, 0, null) where item_kind = 'reshare'$$,
  'anonymous home timeline never includes reshares'
);
select results_eq(
  $$select item_kind, annotation_id, resharer_user_id
    from public.list_public_timeline_items(20, 0, '61000000-0000-4000-8000-000000000001')
    where item_kind = 'reshare'
    order by annotation_id, resharer_user_id$$
  $$values
    ('reshare'::text, '63000000-0000-4000-8000-000000000001'::uuid, '61000000-0000-4000-8000-000000000001'::uuid),
    ('reshare'::text, '63000000-0000-4000-8000-000000000004'::uuid, '61000000-0000-4000-8000-000000000001'::uuid)
  $$,
  'public profile timeline includes that actor''s reshares'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select results_eq(
  $$select item_kind, annotation_id, resharer_user_id
    from public.list_public_timeline_items(20, 0, null)
    where item_kind = 'reshare'
    order by annotation_id, resharer_user_id$$
  $$values
    ('reshare'::text, '63000000-0000-4000-8000-000000000001'::uuid, '61000000-0000-4000-8000-000000000001'::uuid),
    ('reshare'::text, '63000000-0000-4000-8000-000000000001'::uuid, '61000000-0000-4000-8000-000000000002'::uuid),
    ('reshare'::text, '63000000-0000-4000-8000-000000000004'::uuid, '61000000-0000-4000-8000-000000000001'::uuid)
  $$,
  'followers see followee and own reshares on the signed-in home timeline'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is_empty(
  $$select item_id from public.list_public_timeline_items(20, 0, null) where item_kind = 'reshare'$$,
  'signed-in users who follow nobody do not see stranger reshares on home'
);
select throws_ok(
  $$select * from public.annotation_reshares$$,
  '42501',
  null,
  'authenticated clients cannot select the reshare table'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.profile_follows', 'select'),
  'follow graph remains unreadable while reshares project through trusted functions'
);
reset role;

set local role anon;
select is_empty(
  $$select item_id from public.list_public_timeline_items(20, 0, null)
    where annotation_id = '63000000-0000-4000-8000-000000000002'$$,
  'unpublished annotations stay off the public timeline'
);
select throws_ok(
  $$select public.list_public_timeline_items(0, 0, null)$$,
  '22023',
  'Timeline limit must be between 1 and 100.',
  'timeline limits are bounded'
);
reset role;

select throws_ok(
  $$insert into public.annotation_reshares (
    resharer_user_id, target_annotation_id, comment_text
  ) values (
    '61000000-0000-4000-8000-000000000003',
    '63000000-0000-4000-8000-000000000001',
    ''
  )$$,
  '23514',
  null,
  'empty reshare comments are rejected by the table check'
);

select * from finish();
rollback;
