begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, raw_user_meta_data)
values ('d2000000-0000-4000-8000-000000000001', '{"full_name":"Watch Audio Publisher"}'::jsonb);

select pg_catalog.set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ', 'Watch title', 'Channel',
      1000, 8000, 'Video clip on the watch URL'
    )
  $$,
  'YouTube video begin still succeeds on the watch URL'
);

select lives_ok(
  $$
    select * from public.begin_hosted_audio_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'Watch title', 'Channel', 'YouTube', null,
      2000, 9000, 'Audio clip on the same YouTube URL'
    )
  $$,
  'hosted audio begin creates a podcast source beside the YouTube source'
);

select lives_ok(
  $$
    select * from public.begin_hosted_tiktok_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      '7550123456789012345', 'BBC clip', '@bbcnews',
      1000, 8000, 'TikTok video clip'
    )
  $$,
  'TikTok video begin still succeeds on the watch URL'
);

select lives_ok(
  $$
    select * from public.begin_hosted_audio_annotation(
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'https://www.tiktok.com/@bbcnews/video/7550123456789012345',
      'BBC clip', '@bbcnews', 'TikTok', null,
      1500, 7500, 'Audio clip on the same TikTok URL'
    )
  $$,
  'hosted audio begin creates a podcast source beside the TikTok source'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  ),
  2::bigint,
  'the same YouTube URL keeps distinct youtube and podcast sources'
);

select ok(
  (
    select pg_catalog.bool_and(source_type in ('youtube', 'podcast'))
      and pg_catalog.count(distinct source_type) = 2
    from public.sources
    where normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  ),
  'YouTube watch-page sources are youtube and podcast, not a stolen cross-type row'
);

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
  ),
  2::bigint,
  'the same TikTok URL keeps distinct tiktok and podcast sources'
);

select ok(
  (
    select pg_catalog.bool_and(source_type in ('tiktok', 'podcast'))
      and pg_catalog.count(distinct source_type) = 2
    from public.sources
    where normalized_url = 'https://www.tiktok.com/@bbcnews/video/7550123456789012345'
  ),
  'TikTok watch-page sources are tiktok and podcast, not a stolen cross-type row'
);

select * from finish();
rollback;
