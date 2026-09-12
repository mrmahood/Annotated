begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('public', 'annotation_bookmarks', 'annotation_bookmarks table exists');
select columns_are(
  'public',
  'annotation_bookmarks',
  array['id', 'user_id', 'annotation_id', 'created_at'],
  'bookmark rows expose only the intended columns'
);
select col_is_pk(
  'public', 'annotation_bookmarks', 'id',
  'each bookmark has a stable identity'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.annotation_bookmarks'::regclass
      and conname = 'annotation_bookmarks_user_annotation_key'
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'UNIQUE') > 0
  ),
  'at most one bookmark exists per user and annotation'
);
select has_index(
  'public',
  'annotation_bookmarks',
  'annotation_bookmarks_user_created_at_idx',
  'owner newest-first bookmark reads have a supporting index'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_bookmarks'::regclass),
  'annotation_bookmarks has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.annotation_bookmarks', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_bookmarks', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_bookmarks', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_bookmarks', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_bookmarks', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_bookmarks', 'delete'),
  'API roles cannot read or write bookmark rows directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.create_annotation_bookmark(uuid)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_annotation_bookmark(uuid)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.list_current_annotation_bookmarks(integer, integer)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_current_annotation_bookmarks(integer, integer)',
    'execute'
  ),
  'create/remove/list stay authenticated'
);

insert into auth.users (id, raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Author One')),
  ('71000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Reader Two')),
  ('71000000-0000-4000-8000-000000000003', pg_catalog.jsonb_build_object('full_name', 'Stranger Three'));

insert into public.sources (id, normalized_url, canonical_url, source_type, title)
values (
  '72000000-0000-4000-8000-000000000001',
  'https://example.test/bookmark-v1',
  'https://example.test/bookmark-v1',
  'article',
  'Bookmark v1'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values
  (
    '73000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'article_text',
    'Published original',
    'published',
    '2026-09-12T12:00:00Z'
  ),
  (
    '73000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'article_text',
    'Draft original',
    'draft',
    null
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'article_text',
    'Hidden original',
    'hidden',
    '2026-09-12T11:00:00Z'
  ),
  (
    '73000000-0000-4000-8000-000000000004',
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002',
    'article_text',
    'Reader original',
    'published',
    '2026-09-12T10:00:00Z'
  );

set local role anon;
select throws_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'anonymous bookmark creation is denied'
);
select throws_ok(
  $$select public.list_current_annotation_bookmarks(20, 0)$$,
  '42501',
  null,
  'anonymous bookmark listing is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000001')$$,
  'users may bookmark their own published annotations'
);
select throws_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000002')$$,
  '22023',
  'That annotation is unavailable.',
  'draft targets cannot be bookmarked'
);
select throws_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000003')$$,
  '22023',
  'That annotation is unavailable.',
  'hidden targets cannot be bookmarked'
);
select throws_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000001')$$,
  '23505',
  'You have already bookmarked this annotation.',
  'duplicate bookmark of the same annotation is denied'
);
select lives_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000004')$$,
  'users may bookmark another creator''s published annotation'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000001')$$,
  'a different user may bookmark the same published target'
);
select is(
  public.remove_annotation_bookmark('73000000-0000-4000-8000-000000000004'),
  false,
  'removing another user''s bookmark is a no-op'
);
reset role;

select is(
  (select count(*) from public.annotation_bookmarks
    where annotation_id = '73000000-0000-4000-8000-000000000001'),
  2::bigint,
  'the same published annotation can be bookmarked by more than one user'
);

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.remove_annotation_bookmark('73000000-0000-4000-8000-000000000001'),
  true,
  'owner remove deletes their bookmark'
);
select lives_ok(
  $$select public.create_annotation_bookmark('73000000-0000-4000-8000-000000000001')$$,
  'remove frees the unique slot so the owner can bookmark again'
);
select results_eq(
  $$select annotation_id from public.get_current_annotation_bookmarks(array[
    '73000000-0000-4000-8000-000000000001'::uuid,
    '73000000-0000-4000-8000-000000000002'::uuid,
    '73000000-0000-4000-8000-000000000004'::uuid
  ]) order by 1$$,
  $$values
    ('73000000-0000-4000-8000-000000000001'::uuid),
    ('73000000-0000-4000-8000-000000000004'::uuid)
  $$,
  'caller bookmark state returns only their published targets'
);
reset role;

update public.annotation_bookmarks
set created_at = '2026-09-12T12:00:00Z'
where user_id = '71000000-0000-4000-8000-000000000001'
  and annotation_id = '73000000-0000-4000-8000-000000000001';
update public.annotation_bookmarks
set created_at = '2026-09-12T13:00:00Z'
where user_id = '71000000-0000-4000-8000-000000000001'
  and annotation_id = '73000000-0000-4000-8000-000000000004';

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$select annotation_id from public.list_current_annotation_bookmarks(20, 0)$$,
  $$values
    ('73000000-0000-4000-8000-000000000004'::uuid),
    ('73000000-0000-4000-8000-000000000001'::uuid)
  $$,
  'owner list is newest-first and published-only'
);
reset role;

update public.annotations
set status = 'hidden'
where id = '73000000-0000-4000-8000-000000000004';

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$select annotation_id from public.list_current_annotation_bookmarks(20, 0)$$,
  $$values ('73000000-0000-4000-8000-000000000001'::uuid)$$,
  'later-hidden annotations drop off the owner bookmark list'
);
select is_empty(
  $$select annotation_id from public.get_current_annotation_bookmarks(array[
    '73000000-0000-4000-8000-000000000004'::uuid
  ])$$,
  'caller bookmark state omits unpublished targets'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is_empty(
  $$select annotation_id from public.list_current_annotation_bookmarks(20, 0)$$,
  'a stranger''s bookmark list does not include other users'' rows'
);
select throws_ok(
  $$select * from public.annotation_bookmarks$$,
  '42501',
  null,
  'authenticated clients cannot select the bookmark table'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.profile_follows', 'select'),
  'follow graph remains unreadable while bookmarks project through trusted functions'
);
select throws_ok(
  $$select public.list_current_annotation_bookmarks(0, 0)$$,
  '22023',
  'Bookmark list limit must be between 1 and 100.',
  'bookmark list limits are bounded'
);
select throws_ok(
  $$select public.get_current_annotation_bookmarks(array[null]::uuid[])$$,
  '22023',
  'Annotation IDs cannot contain null values.',
  'bookmark state inspection rejects null IDs'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok(
  $$select public.get_current_annotation_bookmarks(array[
    '73000000-0000-4000-8000-000000000001'::uuid
  ])$$,
  '42501',
  null,
  'anonymous bookmark state inspection is denied'
);
reset role;

select * from finish();
rollback;
