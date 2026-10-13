begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('public', 'annotation_tweet_captures', 'annotation_tweet_captures table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_tweet_captures'::regclass),
  'annotation_tweet_captures has RLS enabled'
);
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'annotation-tweet-captures'$$,
  $$values (true, 1572864::bigint, array['image/jpeg']::text[])$$,
  'the post screenshot bucket is public and JPEG-limited'
);
select has_table('public', 'annotation_receipt_sources', 'annotation_receipt_sources table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_receipt_sources'::regclass),
  'annotation_receipt_sources has RLS enabled'
);

insert into auth.users (id, raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Post Publisher')),
  ('71000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Other Publisher'));

insert into public.sources (id, normalized_url, canonical_url, source_type, title)
values (
  '72000000-0000-4000-8000-000000000001',
  'https://example.test/post-fixtures',
  'https://example.test/post-fixtures',
  'article',
  'Post fixtures'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'article_text', 'Published take', 'published', pg_catalog.now()),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'article_text', 'Draft take', 'draft', null);

insert into public.annotation_tweet_captures (
  annotation_id, status_url, tweet_id, author_handle, tweet_text, embed
) values
  ('73000000-0000-4000-8000-000000000001', 'https://x.com/reader/status/111', '111', 'reader', 'Published post', '{"url":"https://x.com/reader/status/111"}'::jsonb),
  ('73000000-0000-4000-8000-000000000002', 'https://x.com/reader/status/222', '222', 'reader', 'Draft post', '{"url":"https://x.com/reader/status/222"}'::jsonb);

insert into public.annotation_receipt_sources (annotation_id, url, title, origin)
values (
  '73000000-0000-4000-8000-000000000002',
  'https://agency.example/draft-only',
  'Draft receipt',
  'ai-suggested'
);

insert into storage.objects (bucket_id, name, owner_id, metadata) values (
  'annotation-tweet-captures',
  '71000000-0000-4000-8000-000000000001/74000000-0000-4000-8000-000000000010.jpg',
  '71000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048)
);

set local role anon;
select is(
  (select pg_catalog.count(*) from public.annotation_tweet_captures where annotation_id = '73000000-0000-4000-8000-000000000001'),
  1::bigint,
  'anonymous readers can see a preserved post on a published annotation'
);
select is(
  (select pg_catalog.count(*) from public.annotation_tweet_captures where annotation_id = '73000000-0000-4000-8000-000000000002'),
  0::bigint,
  'anonymous readers cannot see a preserved post on a draft'
);
select throws_ok(
  $$insert into public.annotation_tweet_captures (annotation_id, status_url, tweet_id, author_handle, embed) values ('73000000-0000-4000-8000-000000000001', 'https://x.com/reader/status/333', '333', 'reader', '{}'::jsonb)$$,
  '42501', null,
  'anonymous clients cannot insert a post capture'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$insert into public.annotation_tweet_captures (annotation_id, status_url, tweet_id, author_handle, embed) values ('73000000-0000-4000-8000-000000000001', 'https://x.com/reader/status/333', '333', 'reader', '{}'::jsonb)$$,
  '42501', null,
  'authenticated clients cannot insert a post capture directly'
);

select lives_ok(
  $$select public.publish_article_annotation(
    'https://x.com/reader/status/1234567890123456789',
    'https://x.com/reader/status/1234567890123456789',
    'A post',
    'Reader',
    'X',
    'The highlighted post text.',
    null,
    null,
    'A take on the post.'
  )$$,
  'article publication of a status URL still succeeds'
);

select is(
  public.attach_annotation_tweet_capture(
    (select annotations.id from public.annotations join public.sources on sources.id = annotations.source_id where sources.canonical_url = 'https://x.com/reader/status/1234567890123456789'),
    'https://x.com/reader/status/1234567890123456789',
    '1234567890123456789',
    'reader',
    'Reader',
    'The highlighted post text.',
    null,
    null,
    null,
    null,
    null
  ),
  true,
  'an owned status snapshot without a screenshot is stored'
);

select lives_ok(
  $$select public.publish_article_annotation(
    'https://twitter.com/reader/status/2234567890123456789',
    'https://twitter.com/reader/status/2234567890123456789',
    'Another post',
    'Reader',
    'X',
    'Second highlighted post.',
    null,
    null,
    'Another take.'
  )$$,
  'a twitter.com status can still be published as an article'
);

select is(
  public.attach_annotation_tweet_capture(
    (select annotations.id from public.annotations join public.sources on sources.id = annotations.source_id where sources.canonical_url = 'https://twitter.com/reader/status/2234567890123456789'),
    'https://x.com/reader/status/2234567890123456789',
    '2234567890123456789',
    'Reader',
    'Reader',
    'Second highlighted post.',
    null,
    '71000000-0000-4000-8000-000000000001/74000000-0000-4000-8000-000000000010.jpg',
    640,
    360,
    2048
  ),
  true,
  'a cropped JPEG owned by the publisher is attached'
);

select throws_ok(
  $$select public.attach_annotation_tweet_capture(
    '73000000-0000-4000-8000-000000000001',
    'https://x.com/reader/status/111',
    '111',
    'reader',
    null,
    null,
    null,
    null,
    null,
    null,
    null
  )$$,
  '22023', null,
  'a capture is rejected when the annotation source is not that post'
);

select is(
  (
    select embed ->> 'url'
    from public.annotation_tweet_captures
    where status_url = 'https://x.com/reader/status/1234567890123456789'
  ),
  'https://x.com/reader/status/1234567890123456789',
  'the stored embed keeps the canonical post URL'
);

select lives_ok(
  $$insert into public.annotation_receipt_sources (annotation_id, url, title, publisher, origin) values
    ('73000000-0000-4000-8000-000000000001', 'https://www.congress.gov/bill/1', 'Bill', 'Congress', 'ai-suggested'),
    ('73000000-0000-4000-8000-000000000001', 'https://www.govinfo.gov/bill', 'Bill text', 'GovInfo', 'ai-suggested'),
    ('73000000-0000-4000-8000-000000000001', 'https://data.example/set', 'Dataset', null, 'ai-suggested')$$,
  'the owner can attach three approved AI-suggested sources'
);
select throws_ok(
  $$insert into public.annotation_receipt_sources (annotation_id, url, title, origin) values ('73000000-0000-4000-8000-000000000001', 'https://fourth.example/doc', 'Fourth', 'ai-suggested')$$,
  '23514', null,
  'a fourth receipt source is rejected'
);
select throws_ok(
  $$insert into public.annotation_receipt_sources (annotation_id, url, title, origin) values ('73000000-0000-4000-8000-000000000001', 'https://www.congress.gov/bill/1', 'Again', 'ai-suggested')$$,
  '23505', null,
  'the same source URL cannot be attached twice'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$insert into public.annotation_receipt_sources (annotation_id, url, title, origin) values ('73000000-0000-4000-8000-000000000001', 'https://other.example/doc', 'Other', 'ai-suggested')$$,
  '42501', null,
  'another user cannot attach a source to this annotation'
);
reset role;

set local role anon;
select is(
  (select pg_catalog.count(*) from public.annotation_receipt_sources where annotation_id = '73000000-0000-4000-8000-000000000001'),
  3::bigint,
  'anonymous readers can see approved sources on a published annotation'
);
select is(
  (select pg_catalog.count(*) from public.annotation_receipt_sources where annotation_id = '73000000-0000-4000-8000-000000000002'),
  0::bigint,
  'anonymous readers cannot see receipt sources on a draft'
);
select throws_ok(
  $$insert into public.annotation_receipt_sources (annotation_id, url, title, origin) values ('73000000-0000-4000-8000-000000000001', 'http://insecure.example/doc', 'Insecure', 'ai-suggested')$$,
  '42501', null,
  'anonymous clients cannot insert receipt sources'
);
reset role;

select throws_ok(
  $$insert into public.annotation_receipt_sources (annotation_id, url, title, origin) values ('73000000-0000-4000-8000-000000000002', 'https://origin.example/doc', 'Bad origin', 'user')$$,
  '23514', null,
  'only AI-suggested origins are stored in the receipt table'
);

select * from finish();
rollback;
