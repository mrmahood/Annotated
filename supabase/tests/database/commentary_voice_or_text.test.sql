begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_function(
  'public',
  'attach_owner_annotation_audio',
  array['uuid', 'text', 'integer', 'text', 'integer'],
  'owner commentary attach RPC exists'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.attach_owner_annotation_audio(uuid,text,integer,text,integer)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.attach_owner_annotation_audio(uuid,text,integer,text,integer)',
    'execute'
  ),
  'only authenticated clients can attach owner commentary audio'
);

insert into auth.users (id, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', pg_catalog.jsonb_build_object('full_name', 'Voice Publisher')),
  ('e1000000-0000-4000-8000-000000000002', pg_catalog.jsonb_build_object('full_name', 'Other Voice Publisher'));

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  (
    'annotation-audio',
    'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001.webm',
    'e1000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('mimetype', 'audio/webm', 'size', 2048)
  ),
  (
    'annotation-audio',
    'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000002.webm',
    'e1000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('mimetype', 'audio/webm', 'size', 2048)
  ),
  (
    'annotation-audio',
    'e1000000-0000-4000-8000-000000000002/e2000000-0000-4000-8000-000000000003.webm',
    'e1000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_build_object('mimetype', 'audio/webm', 'size', 2048)
  );

set local role anon;
select throws_ok(
  $$
    select public.attach_owner_annotation_audio(
      'e3000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001.webm',
      1500, 'audio/webm', 2048
    )
  $$,
  '42501',
  null,
  'anonymous commentary attach is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ', 'Voice title', 'Channel',
      1000, 8000, ''
    )
  $$,
  'hosted YouTube begin accepts empty typed commentary for a later voice attach'
);

select lives_ok(
  $$
    select public.attach_owner_annotation_audio(
      (
        select annotations.id
        from public.annotations
        join public.sources on sources.id = annotations.source_id
        where sources.normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
          and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
          and annotations.status = 'draft'
      ),
      'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001.webm',
      1500,
      'audio/webm',
      2048
    )
  $$,
  'owner can attach commentary audio to a hosted draft'
);

select lives_ok(
  $$
    select public.publish_article_annotation_with_audio(
      'https://example.test/articles/voice-only',
      'https://example.test/articles/voice-only',
      'Voice only',
      null,
      null,
      'A passage with voice commentary.',
      null,
      null,
      '',
      'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000002.webm',
      1500,
      'audio/webm',
      2048
    )
  $$,
  'article publish with audio accepts empty typed commentary'
);

select lives_ok(
  $$
    select * from public.begin_hosted_spotify_annotation(
      'https://open.spotify.com/episode/6EMoFpxEsLelogfZz8eAC2',
      'https://open.spotify.com/episode/6EMoFpxEsLelogfZz8eAC2',
      '6EMoFpxEsLelogfZz8eAC2', 'Episode', 'Host', 'Show',
      1000, 8000, ''
    )
  $$,
  'hosted Spotify begin accepts empty typed commentary'
);

select throws_ok(
  $$
    select public.publish_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ', 'Legacy', 'Channel', 0, 5000, ''
    )
  $$,
  '22023',
  'Commentary text is required.',
  'legacy time-code YouTube publish still requires typed commentary'
);

select throws_ok(
  $$
    select public.attach_owner_annotation_audio(
      (
        select annotations.id
        from public.annotations
        join public.sources on sources.id = annotations.source_id
        where sources.normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
          and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
          and annotations.status = 'draft'
      ),
      'e1000000-0000-4000-8000-000000000002/e2000000-0000-4000-8000-000000000003.webm',
      1500,
      'audio/webm',
      2048
    )
  $$,
  '22023',
  null,
  'a storage path under another user UUID is rejected'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_audio
    join public.annotations on annotations.id = annotation_audio.annotation_id
    where annotations.status = 'draft'
      and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'voice commentary metadata is attached to the hosted draft'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_audio
    join public.annotations on annotations.id = annotation_audio.annotation_id
    where annotations.status = 'published'
      and annotations.annotation_type = 'article_text'
      and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
      and pg_catalog.btrim(annotations.commentary_text) = ''
  ),
  1::bigint,
  'voice-only article publication attaches audio metadata'
);

-- Guard: empty commentary without audio still cannot publish a hosted row.
update public.annotation_media as media
set
  processing_status = 'ready',
  processing_stage = null,
  raw_storage_path = null,
  raw_deleted_at = pg_catalog.now(),
  processed_storage_path = 'e1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/excerpt.mp4',
  processed_mime_type = 'video/mp4',
  duration_ms = 7000,
  width = 426,
  height = 240,
  byte_size = 2000,
  checksum_sha256 = pg_catalog.repeat('a', 64),
  processed_at = pg_catalog.now()
where media.annotation_id = (
  select annotations.id
  from public.annotations
  join public.sources on sources.id = annotations.source_id
  where sources.normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
    and annotations.status = 'draft'
);

insert into public.annotation_transcripts (
  annotation_id, transcript_text, provider, model
)
select annotations.id, 'Excerpt transcript', 'test', 'test'
from public.annotations
join public.sources on sources.id = annotations.source_id
where sources.normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
  and annotations.status = 'draft';

select lives_ok(
  $$
    update public.annotations
    set status = 'published', published_at = pg_catalog.now()
    where user_id = 'e1000000-0000-4000-8000-000000000001'
      and status = 'draft'
      and commentary_text = ''
      and exists (
        select 1 from public.annotation_audio
        where annotation_audio.annotation_id = annotations.id
      )
  $$,
  'hosted publication succeeds with empty typed commentary when voice commentary exists'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      'jNQXAC9IVRw', 'No voice', 'Channel',
      9000, 16000, ''
    )
  $$,
  'a second empty-commentary hosted draft can be created'
);
reset role;

update public.annotation_media as media
set
  processing_status = 'ready',
  processing_stage = null,
  raw_storage_path = null,
  raw_deleted_at = pg_catalog.now(),
  processed_storage_path = 'e1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/excerpt.mp4',
  processed_mime_type = 'video/mp4',
  duration_ms = 7000,
  width = 426,
  height = 240,
  byte_size = 2000,
  checksum_sha256 = pg_catalog.repeat('b', 64),
  processed_at = pg_catalog.now()
where media.annotation_id = (
  select annotations.id
  from public.annotations
  join public.sources on sources.id = annotations.source_id
  where sources.normalized_url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
    and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
    and annotations.status = 'draft'
);

insert into public.annotation_transcripts (
  annotation_id, transcript_text, provider, model
)
select annotations.id, 'Excerpt transcript without voice', 'test', 'test'
from public.annotations
join public.sources on sources.id = annotations.source_id
where sources.normalized_url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  and annotations.user_id = 'e1000000-0000-4000-8000-000000000001'
  and annotations.status = 'draft';

select throws_ok(
  $$
    update public.annotations
    set status = 'published', published_at = pg_catalog.now()
    where user_id = 'e1000000-0000-4000-8000-000000000001'
      and status = 'draft'
      and commentary_text = ''
      and source_id = (
        select sources.id
        from public.sources
        where sources.normalized_url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
      )
  $$,
  '23514',
  'Required commentary must be present before hosted publication.',
  'hosted publication still fails with empty commentary and no voice clip'
);

select * from finish();
rollback;
