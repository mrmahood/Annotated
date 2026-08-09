begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

select has_function(
  'public', 'publish_youtube_annotation',
  array['text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'YouTube publishing RPC exists with no ownership argument'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.publish_youtube_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'anonymous execution is explicitly revoked'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.publish_youtube_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'authenticated execution is explicitly granted'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'publish_youtube_annotation'
      and argument_name in ('user_id', 'p_user_id')
  ),
  'the RPC exposes no spoofable ownership argument'
);

insert into auth.users (id, raw_user_meta_data) values
  ('81000000-0000-4000-8000-000000000001', '{"full_name":"YouTube Publisher"}'::jsonb);

set local role anon;
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', 'Channel', 42000, 73000, 'Commentary')$$,
  '42501', null, 'anonymous publishing is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video title', 'Channel name', 42000, 73000, 'First clip')$$,
  'a valid YouTube clip publishes'
);
select lives_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Alternate title', 'Channel name', 90000, 100000, 'Second clip')$$,
  'a second clip reuses the normalized video source'
);
reset role;

select is(
  (select pg_catalog.count(*) from public.sources where normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  1::bigint, 'one source row represents the video'
);
select is(
  (select source_type from public.sources where normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  'youtube', 'the shared source is typed as YouTube'
);
select is(
  (select pg_catalog.count(*) from public.annotations where user_id = '81000000-0000-4000-8000-000000000001' and annotation_type = 'video_clip' and status = 'published'),
  2::bigint, 'published clips are owned by auth.uid()'
);
select is(
  (select pg_catalog.count(*) from public.annotation_targets where target_type = 'time_range' and start_ms is not null and end_ms is not null),
  2::bigint, 'each clip stores a typed millisecond time range'
);

select pg_catalog.set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.publish_youtube_annotation('https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 1000, 'Commentary')$$,
  '22023', 'The normalized URL must identify exactly one canonical YouTube video.', 'non-normalized input is rejected by the RPC'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '9bZkp7q19f0', 'Video', null, 0, 1000, 'Commentary')$$,
  '22023', 'The normalized URL must identify exactly one canonical YouTube video.', 'a mismatched video ID is rejected'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 1000, 'Commentary')$$,
  '22023', null, 'timestamped source identity is rejected'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 1000, 1000, 'Commentary')$$,
  '22023', 'Clip end must be after clip start.', 'end must be after start'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 999, 'Commentary')$$,
  '22023', 'A clip must be at least 1 second long.', 'minimum duration is enforced'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 300001, 'Commentary')$$,
  '22023', 'A clip cannot be longer than 5 minutes.', 'maximum duration is enforced'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 1000, '   ')$$,
  '22023', 'Commentary text is required.', 'commentary is required'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 1000, pg_catalog.repeat('x', 2001))$$,
  '22023', 'Commentary text cannot exceed 2,000 characters.', 'commentary length is enforced'
);
select lives_ok(
  $$select public.publish_article_annotation('https://example.test/article-still-works', 'https://example.test/article-still-works', 'Article', null, null, 'Selected text', null, null, 'Commentary')$$,
  'existing article publishing still works'
);
reset role;

select ok(
  pg_catalog.to_regprocedure('public.publish_article_annotation_with_audio(text,text,text,text,text,text,text,text,text,text,integer,text,integer)') is not null,
  'existing article audio publishing remains available'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'),
  'claim privacy remains intact'
);

select * from finish();
rollback;
