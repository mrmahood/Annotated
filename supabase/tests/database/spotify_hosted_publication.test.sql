begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function(
  'public',
  'begin_hosted_spotify_annotation',
  array['text', 'text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'hosted Spotify begin RPC exists'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_hosted_spotify_annotation(text,text,text,text,text,text,integer,integer,text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_hosted_spotify_annotation(text,text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'only authenticated clients can begin hosted Spotify annotations'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'begin_hosted_spotify_annotation'
      and argument_name in ('user_id', 'p_user_id', 'owner_id', 'p_owner_id')
  ),
  'Spotify begin RPC exposes no spoofable ownership argument'
);

insert into auth.users (id, raw_user_meta_data)
values ('c2000000-0000-4000-8000-000000000001', '{"full_name":"Spotify Publisher"}'::jsonb);

set local role anon;
select throws_ok(
  $$
    select public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      '7makk4oTQel546B0P8lOOJ', 'The Daily', 'The New York Times', 'The Daily',
      1000, 8000, 'Commentary'
    )
  $$,
  '42501',
  null,
  'anonymous Spotify begin is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      '7makk4oTQel546B0P8lOOJ', 'The Daily', 'The New York Times', 'The Daily',
      1000, 8000, 'First Spotify clip'
    )
  $$,
  'authenticated Spotify begin creates a draft'
);

select lives_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      '7makk4oTQel546B0P8lOOJ', 'The Daily', 'The New York Times', 'The Daily',
      9000, 16000, 'Second Spotify clip on the same source'
    )
  $$,
  'a second Spotify clip reuses the spotify source'
);

select lives_ok(
  $$
    select public.publish_article_annotation(
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'The Daily page', null, 'Spotify',
      'Selected passage on a Spotify URL used as an article', null, null,
      'Article text can coexist on the same URL'
    )
  $$,
  'article text can publish on the same Spotify URL without stealing spotify identity'
);

select throws_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/embed/episode/7makk4oTQel546B0P8lOOJ',
      'https://open.spotify.com/embed/episode/7makk4oTQel546B0P8lOOJ',
      '7makk4oTQel546B0P8lOOJ', 'Embed', null, null, 0, 5000, 'Must be canonical first'
    )
  $$,
  '22023',
  'The normalized URL must identify exactly one canonical Spotify episode.',
  'embed host path fails closed until the client normalizes'
);

select throws_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
      'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
      '7makk4oTQel546B0P8lOOJ', 'Show only', null, null, 0, 5000, 'No episode'
    )
  $$,
  '22023',
  'The normalized URL must identify exactly one canonical Spotify episode.',
  'show-only URLs fail closed'
);

select throws_ok(
  $$
    select * from public.begin_hosted_audio_annotation(
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ',
      'The Daily', null, 'Spotify', 'The Daily', 0, 5000, 'Must not steal Spotify identity'
    )
  $$,
  '22023',
  'Podcast audio clips cannot use a Spotify episode URL. Use the Spotify hosted begin path.',
  'Spotify episode URLs fail closed for generic podcast begin'
);

select throws_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
      'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
      '4rOoJ6Egrf8K2IrywzwOMk', 'Too long', null, null, 0, 90001, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip cannot be longer than 90 seconds.',
  'a 90,001 ms Spotify begin is rejected'
);

select throws_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
      'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
      '4rOoJ6Egrf8K2IrywzwOMk', 'Too short', null, null, 0, 999, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip must be at least 1 second long.',
  'a 999 ms Spotify begin is rejected'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ'
  ),
  2::bigint,
  'the same Spotify URL keeps distinct spotify and article sources'
);

select ok(
  (
    select pg_catalog.bool_and(source_type in ('spotify', 'article'))
      and pg_catalog.count(distinct source_type) = 2
    from public.sources
    where normalized_url = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ'
  ),
  'Spotify begin does not invent a podcast or youtube source'
);

select is(
  (
    select sources.source_type
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.commentary_text = 'First Spotify clip'
  ),
  'spotify',
  'Spotify drafts attach to the spotify source'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ'
      and sources.source_type = 'spotify'
      and annotations.annotation_type = 'audio_clip'
      and annotations.status = 'draft'
  ),
  2::bigint,
  'both Spotify drafts attach to the spotify source as audio clips'
);

select ok(
  (
    select pg_catalog.bool_and(
      annotation_media.media_type = 'audio'
      and annotation_media.processing_status = 'capture_pending'
    )
    from public.annotation_media
    join public.annotations on annotations.id = annotation_media.annotation_id
    where annotations.commentary_text in (
      'First Spotify clip',
      'Second Spotify clip on the same source'
    )
  ),
  'Spotify begin rows are capture-pending audio media'
);

select is(
  (
    select metadata ->> 'episode_id'
    from public.sources
    where source_type = 'spotify'
      and normalized_url = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ'
  ),
  '7makk4oTQel546B0P8lOOJ',
  'Spotify source metadata stores the episode id'
);

select is(
  (
    select metadata ->> 'show_name'
    from public.sources
    where source_type = 'spotify'
      and normalized_url = 'https://open.spotify.com/episode/7makk4oTQel546B0P8lOOJ'
  ),
  'The Daily',
  'Spotify source metadata stores the show name'
);

select * from finish();
rollback;
