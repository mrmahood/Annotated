begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('public', 'annotation_audio', 'annotation_audio table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_audio'::regclass),
  'annotation_audio has RLS enabled'
);
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'annotation-audio'$$,
  $$values (true, 6291456::bigint, array['audio/webm']::text[])$$,
  'the public annotation-audio bucket enforces size and MIME restrictions'
);

insert into auth.users (id, raw_user_meta_data) values
  ('61000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Audio Publisher')),
  ('61000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Other Publisher'));

insert into public.sources (id, normalized_url, canonical_url, source_type, title)
values (
  '62000000-0000-4000-8000-000000000001',
  'https://example.test/audio-fixtures',
  'https://example.test/audio-fixtures',
  'article',
  'Audio fixtures'
);

insert into public.annotations
  (id, source_id, user_id, annotation_type, commentary_text, status, published_at)
values
  ('63000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'article_text', 'Published with audio', 'published', pg_catalog.now()),
  ('63000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'article_text', 'Draft with hidden audio', 'draft', null);

insert into public.annotation_audio
  (annotation_id, storage_path, duration_ms, mime_type, byte_size)
values
  ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000001.webm', 42000, 'audio/webm', 420000),
  ('63000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000002.webm', 12000, 'audio/webm', 120000);

select throws_ok(
  $$insert into public.annotation_audio values ('63000000-0000-4000-8000-000000000001', 'duplicate.webm', 1000, 'audio/webm', 1, pg_catalog.now())$$,
  '23505', null,
  'the primary key prevents replacing existing audio metadata'
);
select throws_ok(
  $$update public.annotation_audio set duration_ms = 999 where annotation_id = '63000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'audio shorter than one second is rejected'
);
select throws_ok(
  $$update public.annotation_audio set duration_ms = 300001 where annotation_id = '63000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'audio longer than five minutes is rejected'
);
select throws_ok(
  $$update public.annotation_audio set mime_type = 'audio/mpeg' where annotation_id = '63000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'non-WebM metadata is rejected'
);
select throws_ok(
  $$update public.annotation_audio set byte_size = 6291457 where annotation_id = '63000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'audio metadata over 6 MiB is rejected'
);

set local role anon;
select is(
  (select pg_catalog.count(*) from public.annotation_audio where annotation_id = '63000000-0000-4000-8000-000000000001'),
  1::bigint,
  'anonymous users can read audio metadata for published annotations'
);
select is(
  (select pg_catalog.count(*) from public.annotation_audio where annotation_id = '63000000-0000-4000-8000-000000000002'),
  0::bigint,
  'anonymous users cannot read audio metadata for unpublished annotations'
);
select throws_ok(
  $$insert into public.annotation_audio (annotation_id, storage_path, duration_ms, mime_type, byte_size) values ('63000000-0000-4000-8000-000000000001', 'arbitrary.webm', 1000, 'audio/webm', 1)$$,
  '42501', null,
  'anonymous clients cannot insert audio metadata'
);
select throws_ok(
  $$select public.publish_article_annotation_with_audio('https://example.test/anon-audio', 'https://example.test/anon-audio', 'Anon', null, null, 'Passage', null, null, 'Text remains required', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000003.webm', 1000, 'audio/webm', 1)$$,
  '42501', null,
  'anonymous execution of the audio publishing RPC is denied'
);
reset role;

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('annotation-audio', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000010.webm', '61000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('mimetype', 'audio/webm', 'size', 2048)),
  ('annotation-audio', '61000000-0000-4000-8000-000000000002/71000000-0000-4000-8000-000000000011.webm', '61000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('mimetype', 'audio/webm', 'size', 2048)),
  ('annotation-audio', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000012.webm', '61000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('mimetype', 'audio/webm', 'size', 6291457)),
  ('annotation-audio', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000013.webm', '61000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('mimetype', 'audio/mpeg', 'size', 2048));

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$insert into public.annotation_audio (annotation_id, storage_path, duration_ms, mime_type, byte_size) values ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001/direct.webm', 1000, 'audio/webm', 1)$$,
  '42501', null,
  'authenticated clients cannot insert audio metadata directly'
);

select lives_ok(
  $$select public.publish_article_annotation_with_audio(
    'https://example.test/articles/audio-publish',
    'https://example.test/articles/audio-publish',
    'Audio publishing',
    'Ada Audio',
    'Daily Example',
    'A passage with supplemental audio.',
    'Before',
    'After',
    'Required written commentary.',
    '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000010.webm',
    1500,
    'audio/webm',
    2048
  )$$,
  'authenticated audio publishing succeeds with a valid owned object'
);

reset role;
select is(
  (select pg_catalog.count(*) from public.annotation_audio where storage_path = '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000010.webm'),
  1::bigint,
  'audio metadata is attached to the returned publication'
);
select is(
  (
    select annotations.user_id
    from public.annotations
    join public.annotation_audio on annotation_audio.annotation_id = annotations.id
    where annotation_audio.storage_path = '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000010.webm'
  ),
  '61000000-0000-4000-8000-000000000001'::uuid,
  'audio annotation ownership remains auth.uid()'
);

select pg_catalog.set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.publish_article_annotation_with_audio('https://example.test/spoofed-audio', 'https://example.test/spoofed-audio', 'Spoofed', null, null, 'Passage', null, null, 'Commentary', '61000000-0000-4000-8000-000000000002/71000000-0000-4000-8000-000000000011.webm', 1500, 'audio/webm', 2048)$$,
  '22023', null,
  'a storage path under another user UUID is rejected'
);
select throws_ok(
  $$select public.publish_article_annotation_with_audio('https://example.test/missing-audio', 'https://example.test/missing-audio', 'Missing', null, null, 'Passage', null, null, 'Commentary', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000099.webm', 1500, 'audio/webm', 2048)$$,
  '42501', null,
  'a nonexistent Storage object is rejected'
);
select throws_ok(
  $$select public.publish_article_annotation_with_audio('https://example.test/oversized-audio', 'https://example.test/oversized-audio', 'Oversized', null, null, 'Passage', null, null, 'Commentary', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000012.webm', 1500, 'audio/webm', 6291456)$$,
  '22023', null,
  'an oversized Storage object is rejected even when supplied metadata claims the maximum'
);
select throws_ok(
  $$select public.publish_article_annotation_with_audio('https://example.test/invalid-mime', 'https://example.test/invalid-mime', 'Invalid MIME', null, null, 'Passage', null, null, 'Commentary', '61000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000013.webm', 1500, 'audio/webm', 2048)$$,
  '22023', null,
  'an object with invalid MIME metadata is rejected'
);

select lives_ok(
  $$select public.publish_article_annotation('https://example.test/text-still-works', 'https://example.test/text-still-works', 'Text only', null, null, 'Text passage', null, null, 'Text commentary')$$,
  'the existing text-only publishing RPC still succeeds unchanged'
);
reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_audio
    join public.annotations on annotations.id = annotation_audio.annotation_id
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://example.test/text-still-works'
  ),
  0::bigint,
  'text-only publishing does not create audio metadata'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'),
  'existing claims privacy remains intact'
);

select * from finish();
rollback;
