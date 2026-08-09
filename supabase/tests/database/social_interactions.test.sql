begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('public', 'profile_follows', 'profile_follows table exists');
select has_table('public', 'annotation_comments', 'annotation_comments table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.profile_follows'::regclass), 'profile_follows has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_comments'::regclass), 'annotation_comments has RLS enabled');

insert into auth.users (id, raw_user_meta_data) values
  ('51000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Follower One')),
  ('51000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Creator Two')),
  ('51000000-0000-4000-8000-000000000003', pg_catalog.jsonb_build_object('full_name', 'Reader Three'));

insert into public.sources (id, normalized_url, canonical_url, source_type, title)
values (
  '52000000-0000-4000-8000-000000000001',
  'https://example.test/social-foundation',
  'https://example.test/social-foundation',
  'article',
  'Social foundation'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values
  ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'article_text', 'Published', 'published', pg_catalog.now()),
  ('53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'article_text', 'Draft', 'draft', null);

insert into public.annotation_comments (id, annotation_id, user_id, body, status) values
  ('54000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000003', 'Removed fixture', 'removed'),
  ('54000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 'Draft fixture', 'public');

set local role anon;
select throws_ok(
  $$insert into public.profile_follows (follower_id, followed_id) values ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'anonymous follow insertion is denied'
);
reset role;

set local role anon;
select throws_ok(
  $$insert into public.annotation_comments (annotation_id, user_id, body) values ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Anonymous')$$,
  '42501', null, 'anonymous comment insertion is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$insert into public.annotation_comments (id, annotation_id, user_id, body) values ('54000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'A valid public comment')$$,
  'authenticated comment insertion succeeds'
);
select throws_ok(
  $$insert into public.annotation_comments (annotation_id, user_id, body) values ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000003', 'Spoofed')$$,
  '42501', null, 'spoofed comment user_id is denied'
);
select throws_ok(
  $$insert into public.annotation_comments (annotation_id, user_id, body) values ('53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', 'Draft')$$,
  '42501', null, 'comments on unpublished annotations are denied'
);
select throws_ok(
  $$insert into public.annotation_comments (annotation_id, user_id, body) values ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '')$$,
  '23514', null, 'empty comment bodies are denied'
);
select throws_ok(
  $$insert into public.annotation_comments (annotation_id, user_id, body) values ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '   ')$$,
  '23514', null, 'whitespace-only comment bodies are denied'
);
select throws_ok(
  $$insert into public.annotation_comments (annotation_id, user_id, body) values ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', pg_catalog.repeat('x', 1001))$$,
  '23514', null, 'comment bodies over 1,000 characters are denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$insert into public.profile_follows (follower_id, followed_id) values ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002')$$,
  'authenticated follow succeeds'
);
select throws_ok(
  $$insert into public.profile_follows (follower_id, followed_id) values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'spoofed follower_id is denied'
);
select throws_ok(
  $$insert into public.profile_follows (follower_id, followed_id) values ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'self-follow is denied'
);
select throws_ok(
  $$insert into public.profile_follows (follower_id, followed_id) values ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002')$$,
  '23505', null, 'duplicate follow is denied'
);
select lives_ok(
  $$select public.unfollow_profile('51000000-0000-4000-8000-000000000002')$$,
  'authenticated own unfollow succeeds'
);
reset role;
select is((select count(*) from public.profile_follows), 0::bigint, 'own unfollow removes the edge');

insert into public.profile_follows (follower_id, followed_id) values
  ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002'),
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002'),
  ('51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003');

select pg_catalog.set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$delete from public.profile_follows where follower_id = '51000000-0000-4000-8000-000000000003' and followed_id = '51000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'deleting another user follow is denied'
);
reset role;

set local role anon;
select results_eq(
  $$select follower_count, following_count from public.get_profile_social_counts('51000000-0000-4000-8000-000000000002')$$,
  $$values (2::bigint, 1::bigint)$$,
  'public follow statistics return correct counts'
);
select ok(not pg_catalog.has_table_privilege('anon', 'public.profile_follows', 'select'), 'anonymous users cannot inspect follow rows');
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(public.is_following_profile('51000000-0000-4000-8000-000000000002'), true, 'authenticated caller can inspect their follow state');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.profile_follows', 'select'), 'authenticated users cannot inspect the complete follow graph');
reset role;

set local role anon;
select is(
  (select count(*) from public.annotation_comments where id = '54000000-0000-4000-8000-000000000003'),
  1::bigint,
  'anonymous users can read valid public comments'
);
select is(
  (select count(*) from public.annotation_comments where id = '54000000-0000-4000-8000-000000000001'),
  0::bigint,
  'removed comments are not publicly visible'
);
select is(
  (select count(*) from public.annotation_comments where id = '54000000-0000-4000-8000-000000000002'),
  0::bigint,
  'comments on unpublished annotations are not publicly visible'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;
delete from public.annotation_comments where id = '54000000-0000-4000-8000-000000000003';
reset role;
select is(
  (select count(*) from public.annotation_comments where id = '54000000-0000-4000-8000-000000000003'),
  0::bigint,
  'own-comment deletion succeeds'
);

insert into public.annotation_comments (id, annotation_id, user_id, body)
values ('54000000-0000-4000-8000-000000000004', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000003', 'Another user comment');
select pg_catalog.set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
set local role authenticated;
delete from public.annotation_comments where id = '54000000-0000-4000-8000-000000000004';
reset role;
select is(
  (select count(*) from public.annotation_comments where id = '54000000-0000-4000-8000-000000000004'),
  1::bigint,
  'deleting another user comment is denied'
);

set local role anon;
select results_eq(
  $$select annotation_id, comment_count from public.get_public_annotation_comment_counts(array['53000000-0000-4000-8000-000000000001'::uuid])$$,
  $$values ('53000000-0000-4000-8000-000000000001'::uuid, 1::bigint)$$,
  'public comment counts include only visible comments'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'),
  'existing claim privacy remains intact'
);
reset role;

select * from finish();
rollback;
