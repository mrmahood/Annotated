begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function(
  'public',
  'begin_hosted_tiktok_annotation',
  array['text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'hosted TikTok begin RPC exists'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_hosted_tiktok_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_hosted_tiktok_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'only authenticated clients can begin hosted TikTok annotations'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'begin_hosted_tiktok_annotation'
      and argument_name in ('user_id', 'p_user_id', 'owner_id', 'p_owner_id')
  ),
  'TikTok begin RPC exposes no spoofable ownership argument'
);

insert into auth.users (id, raw_user_meta_data)
values ('c1000000-0000-4000-8000-000000000001', '{"full_name":"TikTok Publisher"}'::jsonb);

set local role anon;
select throws_ok(
  $$
    select public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      '7550123456789012345', 'BBC clip', '@bbcnews', 1000, 8000, 'Commentary'
    )
  $$,
  '42501',
  null,
  'anonymous TikTok begin is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      '7550123456789012345', 'BBC clip', '@bbcnews',
      1000, 8000, 'First TikTok clip'
    )
  $$,
  'authenticated TikTok begin creates a draft'
);

select lives_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      '7550123456789012345', 'BBC clip', '@bbcnews',
      9000, 16000, 'Second TikTok clip on the same source'
    )
  $$,
  'a second TikTok clip reuses the tiktok source'
);

select lives_ok(
  $$
    select public.publish_article_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'BBC clip page', null, 'TikTok',
      'Selected passage on a TikTok URL used as an article', null, null,
      'Article text can coexist on the same URL'
    )
  $$,
  'article text can publish on the same TikTok URL without stealing tiktok identity'
);

select throws_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://m.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://m.tiktok.com/@bbcnews/video/7550123456789012345',
      '7550123456789012345', 'Mobile', null, 0, 5000, 'Must be canonical first'
    )
  $$,
  '22023',
  'The normalized URL must identify exactly one canonical TikTok video.',
  'mobile host fails closed until the client normalizes'
);

select throws_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/foryou',
      'https://www.tiktok.com/foryou',
      '7550123456789012345', 'For You', null, 0, 5000, 'No stable video'
    )
  $$,
  '22023',
  'The normalized URL must identify exactly one canonical TikTok video.',
  'For You URLs fail closed'
);

select throws_ok(
  $$
    select * from public.begin_hosted_webpage_video_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'BBC clip', null, 'TikTok', 0, 5000, 'Must not steal TikTok identity'
    )
  $$,
  '22023',
  'Webpage video clips cannot use a TikTok watch URL. Use the TikTok hosted begin path.',
  'TikTok watch URLs fail closed for webpage-video begin'
);

select throws_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012346',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012346',
      '7550123456789012346', 'Too long', null, 0, 90001, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip cannot be longer than 90 seconds.',
  'a 90,001 ms TikTok begin is rejected'
);

select throws_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012346',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012346',
      '7550123456789012346', 'Too short', null, 0, 999, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip must be at least 1 second long.',
  'a 999 ms TikTok begin is rejected'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
  ),
  2::bigint,
  'the same TikTok URL keeps distinct tiktok and article sources'
);

select ok(
  (
    select pg_catalog.bool_and(source_type in ('tiktok', 'article'))
      and pg_catalog.count(distinct source_type) = 2
    from public.sources
    where normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
  ),
  'TikTok begin does not invent a youtube or podcast source'
);

select is(
  (
    select sources.source_type
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.commentary_text = 'First TikTok clip'
  ),
  'tiktok',
  'TikTok drafts attach to the tiktok source'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
      and sources.source_type = 'tiktok'
      and annotations.annotation_type = 'video_clip'
      and annotations.status = 'draft'
  ),
  2::bigint,
  'both TikTok drafts attach to the tiktok source'
);

select is(
  (
    select annotations.annotation_type
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.commentary_text = 'Article text can coexist on the same URL'
  ),
  'article_text',
  'article text on the same URL stays on the article source'
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
      'First TikTok clip',
      'Second TikTok clip on the same source'
    )
  ),
  'TikTok begin rows are capture-pending video media'
);

select is(
  (
    select metadata ->> 'video_id'
    from public.sources
    where source_type = 'tiktok'
      and normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
  ),
  '7550123456789012345',
  'TikTok source metadata stores the video id'
);

select is(
  (
    select metadata ->> 'handle'
    from public.sources
    where source_type = 'tiktok'
      and normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
  ),
  'bbcnews',
  'TikTok source metadata stores the handle extracted from the watch URL'
);

select * from finish();
rollback;
