begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select has_function(
  'public',
  'begin_hosted_webpage_video_annotation',
  array['text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'hosted webpage-video begin RPC exists'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_hosted_webpage_video_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_hosted_webpage_video_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'only authenticated clients can begin hosted webpage-video annotations'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'begin_hosted_webpage_video_annotation'
      and argument_name in ('user_id', 'p_user_id', 'owner_id', 'p_owner_id')
  ),
  'webpage-video begin RPC exposes no spoofable ownership argument'
);

insert into auth.users (id, raw_user_meta_data)
values ('b1000000-0000-4000-8000-000000000001', '{"full_name":"Webpage Video Publisher"}'::jsonb);

set local role anon;
select throws_ok(
  $$
    select public.begin_hosted_webpage_video_annotation(
      'https://example.test/news/clip',
      'https://example.test/news/clip',
      'News clip', null, 'Example News', 1000, 8000, 'Commentary'
    )
  $$,
  '42501',
  null,
  'anonymous webpage-video begin is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select public.publish_article_annotation(
      'https://example.test/news/clip',
      'https://example.test/news/clip',
      'News clip', null, 'Example News',
      'Selected passage on the same page', null, null,
      'Text first on the article source'
    )
  $$,
  'article text can publish first on the webpage-video URL'
);

select lives_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://example.test/news/clip',
      'https://example.test/news/clip',
      'News clip', null, 'Example News',
      1000, 8000, 'Webpage video after text'
    )
  $$,
  'webpage video begin reuses the existing article source'
);

select lives_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://example.test/news/clip',
      'https://example.test/news/clip',
      'News clip', null, 'Example News',
      9000, 16000, 'Second webpage video on the same article source'
    )
  $$,
  'a second webpage video on the same article source succeeds'
);

select lives_ok(
  $$
    select * from public.begin_hosted_audio_annotation(
      'https://example.test/news/clip',
      'https://example.test/news/clip',
      'News clip', null, 'Example News', null,
      2000, 7000, 'Podcast audio beside article video'
    )
  $$,
  'hosted audio still inserts a separate podcast source on the same URL'
);

select throws_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'Watch page', null, 'YouTube', 0, 5000, 'Must not steal YouTube identity'
    )
  $$,
  '22023',
  'Webpage video clips cannot use a YouTube watch URL. Use the YouTube hosted begin path.',
  'YouTube watch URLs fail closed for webpage-video begin'
);

select throws_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'Short link', null, 'YouTube', 0, 5000, 'Must not steal youtu.be identity'
    )
  $$,
  '22023',
  'Webpage video clips cannot use a YouTube watch URL. Use the YouTube hosted begin path.',
  'youtu.be URLs fail closed for webpage-video begin'
);

select throws_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://example.test/news/clip?utm_source=share',
      'https://example.test/news/clip?utm_source=share',
      'Tracked', null, null, 0, 5000, 'Tracking must be stripped first'
    )
  $$,
  '22023',
  'The article page identity cannot contain tracking parameters.',
  'tracking parameters fail closed'
);

select throws_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://example.test/news/other',
      'https://example.test/news/other',
      'Too long', null, null, 0, 90001, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip cannot be longer than 90 seconds.',
  'a 90,001 ms webpage-video begin is rejected'
);

select throws_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://example.test/news/other',
      'https://example.test/news/other',
      'Too short', null, null, 0, 999, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip must be at least 1 second long.',
  'a 999 ms webpage-video begin is rejected'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://example.test/news/clip'
  ),
  2::bigint,
  'the same page URL keeps distinct article and podcast sources'
);

select ok(
  (
    select pg_catalog.bool_and(source_type in ('article', 'podcast'))
      and pg_catalog.count(distinct source_type) = 2
    from public.sources
    where normalized_url = 'https://example.test/news/clip'
  ),
  'webpage-video begin does not steal or invent a youtube source on an article URL'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://example.test/news/clip'
      and sources.source_type = 'article'
      and annotations.annotation_type = 'article_text'
      and annotations.status = 'published'
  ),
  1::bigint,
  'existing article_text remains on the article source'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://example.test/news/clip'
      and sources.source_type = 'article'
      and annotations.annotation_type = 'video_clip'
      and annotations.status = 'draft'
  ),
  2::bigint,
  'both webpage video drafts attach to the article source'
);

select is(
  (
    select pg_catalog.count(distinct annotations.source_id)
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://example.test/news/clip'
      and annotations.annotation_type in ('article_text', 'video_clip')
  ),
  1::bigint,
  'article_text and video_clip share one article source row'
);

select is(
  (
    select annotations.annotation_type
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.commentary_text = 'Podcast audio beside article video'
  ),
  'audio_clip',
  'audio on the same URL stays on the podcast source'
);

select ok(
  (
    select pg_catalog.bool_and(
      annotation_media.media_type = 'video'
      and annotation_media.processing_status = 'capture_pending'
    )
    from public.annotation_media
    join public.annotations on annotations.id = annotation_media.annotation_id
    where annotations.commentary_text in (
      'Webpage video after text',
      'Second webpage video on the same article source'
    )
  ),
  'webpage-video begin rows are capture-pending video media'
);

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url in (
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ'
    )
  ),
  0::bigint,
  'rejected YouTube identities create no source rows'
);

select ok(
  not exists (
    select 1
    from public.sources
    where normalized_url = 'https://example.test/news/clip'
      and source_type = 'youtube'
  ),
  'article-page webpage video never creates a youtube source'
);

select * from finish();
rollback;
