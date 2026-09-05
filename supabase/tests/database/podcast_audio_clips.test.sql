begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

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

select is((select pg_catalog.count(*) from public.sources where normalized_url = 'https://example.test/episodes/42'), 1::bigint, 'one podcast source row represents the episode when only audio is published');
select is((select source_type from public.sources where normalized_url = 'https://example.test/episodes/42'), 'podcast', 'the shared audio source is typed as podcast');
select is((select metadata ->> 'show_name' from public.sources where normalized_url = 'https://example.test/episodes/42' and source_type = 'podcast'), 'Example Show', 'show metadata is stored on the podcast source');
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
select lives_ok(
  $$select public.publish_article_annotation('https://example.test/hybrid-page', 'https://example.test/hybrid-page', 'Narrated article', null, null, 'Selected passage', null, null, 'Text first')$$,
  'text publishes on a hybrid page URL'
);
select lives_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/hybrid-page', 'https://example.test/hybrid-page', 'Narrated article', null, null, null, 0, 5000, 'Audio after text')$$,
  'audio publishes on the same URL after an article source exists'
);
select lives_ok(
  $$select public.publish_audio_clip_annotation('https://example.test/audio-then-text', 'https://example.test/audio-then-text', 'Episode first', null, null, null, 0, 4000, 'Audio first')$$,
  'audio publishes first on a shared URL'
);
select lives_ok(
  $$select public.publish_article_annotation('https://example.test/audio-then-text', 'https://example.test/audio-then-text', 'Article after audio', null, null, 'Later passage', null, null, 'Text after audio')$$,
  'text publishes on the same URL after a podcast source exists'
);
select lives_ok(
  $$select public.begin_hosted_audio_annotation('https://example.test/hybrid-page', 'https://example.test/hybrid-page', 'Narrated article', null, null, null, 1000, 4000, 'Hosted audio after text')$$,
  'hosted audio begin inserts a podcast source beside an existing article row'
);
select throws_ok(
  $$select public.publish_youtube_annotation('https://example.test/hybrid-page', 'https://example.test/hybrid-page', 'dQw4w9WgXcQ', 'Not a watch URL', null, 0, 1000, 'Commentary')$$,
  '22023',
  'The normalized URL must identify exactly one canonical YouTube video.',
  'YouTube stays watch-URL identity and does not merge with article or podcast rows'
);
reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://example.test/hybrid-page'
  ),
  2::bigint,
  'the same normalized URL can have article and podcast sources'
);
select ok(
  (
    select pg_catalog.bool_and(source_type in ('article', 'podcast'))
      and pg_catalog.count(distinct source_type) = 2
    from public.sources
    where normalized_url = 'https://example.test/hybrid-page'
  ),
  'hybrid-page sources are article and podcast, not a stolen cross-type row'
);
select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://example.test/audio-then-text'
  ),
  2::bigint,
  'text after audio also keeps both article and podcast source rows'
);
select is(
  (
    select annotations.annotation_type
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.commentary_text = 'Audio after text'
  ),
  'audio_clip',
  'the audio-after-text clip is attached to the podcast source'
);
select is(
  (
    select annotations.annotation_type
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.commentary_text = 'Text after audio'
  ),
  'article_text',
  'the text-after-audio annotation is attached to the article source'
);

select ok(pg_catalog.to_regprocedure('public.publish_article_annotation_with_audio(text,text,text,text,text,text,text,text,text,text,integer,text,integer)') is not null, 'existing recorded audio commentary publishing remains available');
select ok(not pg_catalog.has_table_privilege('anon', 'public.claims', 'select') and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'), 'claim privacy remains intact');

select * from finish();
rollback;
