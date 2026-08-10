begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_function(
  'public', 'publish_audio_clip_annotation',
  array['text', 'text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'audio clip publishing RPC exists with no ownership argument'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.publish_audio_clip_annotation(text,text,text,text,text,text,integer,integer,text)', 'execute'),
  'anonymous execution is explicitly revoked'
);
select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.publish_audio_clip_annotation(text,text,text,text,text,text,integer,integer,text)', 'execute'),
  'authenticated execution is explicitly granted'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'publish_audio_clip_annotation'
      and argument_name in ('user_id', 'p_user_id')
  ),
  'the RPC exposes no spoofable ownership argument'
);

insert into auth.users (id, raw_user_meta_data) values
  ('91000000-0000-4000-8000-000000000001', '{"full_name":"Audio Publisher"}'::jsonb);

set local role anon;
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/42', 'https://example.test/episodes/42', 'Episode 42', 'Host', 'Example FM', 'Example Show', 42000, 73000, 'Commentary')$$,
  '42501', null, 'anonymous publishing is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/42', 'https://example.test/episodes/42', 'Episode 42', 'Host', 'Example FM', 'Example Show', 42000, 73000, 'First clip')$$,
  'a valid audio clip publishes'
);
select lives_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/42', 'https://example.test/episodes/42', 'Alternate title', null, 'Example FM', 'Example Show', 90000, 100000, 'Second clip')$$,
  'a second clip reuses the normalized episode source'
);
reset role;

select is((select pg_catalog.count(*) from public.sources where normalized_url = 'https://example.test/episodes/42'), 1::bigint, 'one source row represents the episode');
select is((select source_type from public.sources where normalized_url = 'https://example.test/episodes/42'), 'podcast', 'the shared source is typed as podcast');
select is((select metadata ->> 'show_name' from public.sources where normalized_url = 'https://example.test/episodes/42'), 'Example Show', 'show metadata is stored on the source');
select is((select pg_catalog.count(*) from public.annotations where user_id = '91000000-0000-4000-8000-000000000001' and annotation_type = 'audio_clip' and status = 'published'), 2::bigint, 'published clips are owned by auth.uid()');
select is((select pg_catalog.count(*) from public.annotation_targets targets join public.annotations annotations on annotations.id = targets.annotation_id where annotations.annotation_type = 'audio_clip' and targets.target_type = 'time_range'), 2::bigint, 'each audio clip stores a typed time range');

select pg_catalog.set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/42?t=20', 'https://example.test/episodes/42?t=20', 'Episode', null, null, null, 0, 1000, 'Commentary')$$,
  '22023', 'The episode identity cannot contain tracking or playback-location parameters.', 'playback timestamps are rejected from identity'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/43', 'https://example.test/other', 'Episode', null, null, null, 0, 1000, 'Commentary')$$,
  '22023', 'The canonical URL must match the normalized episode identity.', 'mismatched canonical identity is rejected'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('javascript:alert(1)', 'javascript:alert(1)', 'Episode', null, null, null, 0, 1000, 'Commentary')$$,
  '22023', null, 'non-HTTP source identity is rejected'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/44', 'https://example.test/episodes/44', 'Episode', null, null, null, -1, 1000, 'Commentary')$$,
  '22023', 'Clip start must be zero or greater.', 'negative starts are rejected'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/44', 'https://example.test/episodes/44', 'Episode', null, null, null, 1000, 1000, 'Commentary')$$,
  '22023', 'Clip end must be after clip start.', 'end must be after start'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/44', 'https://example.test/episodes/44', 'Episode', null, null, null, 0, 999, 'Commentary')$$,
  '22023', 'A clip must be at least 1 second long.', 'minimum duration is enforced'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/44', 'https://example.test/episodes/44', 'Episode', null, null, null, 0, 300001, 'Commentary')$$,
  '22023', 'A clip cannot be longer than 5 minutes.', 'maximum duration is enforced'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/44', 'https://example.test/episodes/44', 'Episode', null, null, null, 0, 1000, '   ')$$,
  '22023', 'Commentary text is required.', 'commentary is required'
);
select throws_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/episodes/44', 'https://example.test/episodes/44', 'Episode', null, null, null, 0, 1000, pg_catalog.repeat('x', 2001))$$,
  '22023', 'Commentary text cannot exceed 2,000 characters.', 'commentary length is enforced'
);
select lives_ok(
  $$select public.publish_article_annotation('https://example.test/article-after-audio', 'https://example.test/article-after-audio', 'Article', null, null, 'Selected text', null, null, 'Commentary')$$,
  'existing article publishing still works'
);
select lives_ok(
  $$select public.publish_youtube_annotation('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Video', null, 0, 1000, 'Commentary')$$,
  'existing YouTube publishing still works'
);
reset role;

select ok(pg_catalog.to_regprocedure('public.publish_article_annotation_with_audio(text,text,text,text,text,text,text,text,text,text,integer,text,integer)') is not null, 'existing recorded audio commentary publishing remains available');
select ok(not pg_catalog.has_table_privilege('anon', 'public.claims', 'select') and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'), 'claim privacy remains intact');

select * from finish();
rollback;
