begin;

create extension if not exists pgtap with schema extensions;
select plan(77);

select has_table('public', 'annotation_media', 'annotation_media table exists');
select has_table('public', 'annotation_transcripts', 'annotation_transcripts table exists');
select has_table('public', 'profile_handle_aliases', 'profile handle aliases table exists');
select has_column('public', 'annotations', 'slug', 'annotations has an additive slug column');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_media'::regclass),
  'annotation_media has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_transcripts'::regclass),
  'annotation_transcripts has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profile_handle_aliases'::regclass),
  'profile_handle_aliases has RLS enabled'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.annotation_media', 'select,insert,update,delete'),
  'anonymous clients have no direct annotation_media privileges'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.annotation_media', 'select,insert,update,delete'),
  'authenticated clients have no direct annotation_media privileges'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.annotation_transcripts', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_transcripts', 'select,insert,update,delete'),
  'clients have no direct transcript privileges'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.profile_handle_aliases', 'select,insert,update,delete'),
  'authenticated clients cannot browse or mutate handle aliases'
);

select ok(
  not pg_catalog.has_column_privilege('authenticated', 'public.annotations', 'status', 'update')
  and pg_catalog.has_column_privilege('authenticated', 'public.annotations', 'commentary_text', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotations', 'delete'),
  'annotation status is hardened while commentary remains owner-editable'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.annotation_targets', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_targets', 'delete'),
  'stored targets cannot be directly rewritten or deleted by clients'
);
select ok(
  not pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'username', 'update')
  and pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update'),
  'username is controlled while ordinary profile editing remains available'
);

select has_function(
  'public',
  'begin_hosted_youtube_annotation',
  array['text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'hosted YouTube begin RPC exists'
);
select has_function(
  'public',
  'begin_hosted_audio_annotation',
  array['text', 'text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'hosted audio begin RPC exists'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_hosted_youtube_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_hosted_youtube_annotation(text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'only authenticated clients can begin hosted YouTube annotations'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_hosted_audio_annotation(text,text,text,text,text,text,integer,integer,text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_hosted_audio_annotation(text,text,text,text,text,text,integer,integer,text)',
    'execute'
  ),
  'only authenticated clients can begin hosted audio annotations'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'public'
      and pg_proc.proname in ('begin_hosted_youtube_annotation', 'begin_hosted_audio_annotation')
      and argument_name in ('user_id', 'p_user_id', 'owner_id', 'p_owner_id')
  ),
  'hosted begin RPCs expose no spoofable ownership argument'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'private.claim_annotation_media_processing(uuid,integer)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'private.finalize_annotation_media_ready(uuid,uuid)',
    'execute'
  ),
  'worker state functions are not client-callable'
);

select is(
  (select pg_catalog.count(*) from storage.buckets where id in ('annotation-media-raw', 'annotation-media')),
  2::bigint,
  'both hosted media buckets exist'
);
select is(
  (select pg_catalog.count(*) from storage.buckets where id in ('annotation-media-raw', 'annotation-media') and public),
  0::bigint,
  'both hosted media buckets are private'
);
select ok(
  exists (
    select 1 from storage.buckets
    where id = 'annotation-media-raw'
      and file_size_limit = 52428800
      and allowed_mime_types @> array['video/webm', 'audio/webm']::text[]
  ),
  'raw bucket is limited to 50 MiB WebM audio/video'
);
select ok(
  exists (
    select 1 from storage.buckets
    where id = 'annotation-media'
      and not public
      and allowed_mime_types @> array['video/mp4', 'audio/mp4']::text[]
  ),
  'processed bucket accepts only private browser playback formats'
);
select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies
    where coalesce(qual, '') like '%annotation-media-raw%'
      or coalesce(qual, '') like '%annotation-media%'
      or coalesce(with_check, '') like '%annotation-media-raw%'
      or coalesce(with_check, '') like '%annotation-media%'
  ),
  0::bigint,
  'no general client Storage policy exposes either hosted media bucket'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('a1000000-0000-4000-8000-000000000001', '{"full_name":"Hosted Creator"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000002', '{"full_name":"Other Creator"}'::jsonb);

set local role anon;
select throws_ok(
  $$
    select public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ', 'Video', 'Channel', 0, 1000, 'Commentary'
    )
  $$,
  '42501',
  null,
  'anonymous hosted begin is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ', 'Same Source Title', 'Channel', 10000, 100000, 'Hosted video 90 seconds'
    )
  $$,
  'a 90,000 ms hosted video begin succeeds'
);

select throws_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=9bZkp7q19f0',
      'https://www.youtube.com/watch?v=9bZkp7q19f0',
      '9bZkp7q19f0', 'Too long', 'Channel', 0, 90001, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip cannot be longer than 90 seconds.',
  'a 90,001 ms hosted video begin is rejected'
);

select throws_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=9bZkp7q19f0',
      'https://www.youtube.com/watch?v=9bZkp7q19f0',
      '9bZkp7q19f0', 'Too short', 'Channel', 0, 999, 'Rejected range'
    )
  $$,
  '22023',
  'A hosted clip must be at least 1 second long.',
  'a 999 ms hosted video begin is rejected'
);

select lives_ok(
  $$
    select * from public.begin_hosted_audio_annotation(
      'https://example.test/podcast/phase-a',
      'https://example.test/podcast/phase-a',
      'Phase A episode', 'Host', 'Example FM', 'Example Show',
      20000, 50000, 'Hosted audio 30 seconds'
    )
  $$,
  'a valid hosted audio begin succeeds'
);

select lives_ok(
  $$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ', 'Same Source Title', 'Channel', 120000, 150000, 'Hosted video for retry'
    )
  $$,
  'a second hosted video on the same source succeeds'
);

reset role;

select is(
  (
    select status from public.annotations
    where commentary_text = 'Hosted video 90 seconds'
  ),
  'draft',
  'hosted video begins as a private draft'
);
select is(
  (
    select media.processing_status
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted video 90 seconds'
  ),
  'capture_pending',
  'hosted video begins capture-pending'
);
select is(
  (
    select targets.end_ms - targets.start_ms
    from public.annotation_targets as targets
    join public.annotations on annotations.id = targets.annotation_id
    where annotations.commentary_text = 'Hosted video 90 seconds'
  ),
  90000,
  'hosted target records the accepted 90-second range'
);
select ok(
  (
    select username ~ '^hosted-creator-[0-9a-f]{8}$'
    from public.profiles
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'hosted begin deterministically generates a valid creator handle'
);
select ok(
  (
    select slug ~ '^same-source-title-[0-9a-f]{8,32}$'
    from public.annotations
    where commentary_text = 'Hosted video 90 seconds'
  ),
  'hosted begin generates a readable immutable slug with UUID suffix'
);
select is(
  (
    select pg_catalog.count(distinct slug)
    from public.annotations
    where commentary_text in ('Hosted video 90 seconds', 'Hosted video for retry')
  ),
  2::bigint,
  'same-title hosted annotations receive unique deterministic slugs'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$
    update public.annotations
    set status = 'published', published_at = pg_catalog.now()
    where commentary_text = 'Hosted video 90 seconds'
  $$,
  '42501',
  null,
  'an owner cannot directly bypass draft hosted publication'
);
reset role;

set local role anon;
select is(
  (
    select pg_catalog.count(*) from public.annotations
    where commentary_text in (
      'Hosted video 90 seconds', 'Hosted audio 30 seconds', 'Hosted video for retry'
    )
  ),
  0::bigint,
  'draft hosted annotations are not publicly visible'
);
select throws_ok(
  $$
    insert into public.annotation_media (annotation_id, media_type)
    values ('00000000-0000-4000-8000-000000000001', 'video')
  $$,
  '42501',
  null,
  'anonymous direct hosted media DML is denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$
    insert into public.annotation_media (annotation_id, media_type)
    values ('00000000-0000-4000-8000-000000000001', 'video')
  $$,
  '42501',
  null,
  'authenticated direct hosted media DML is denied'
);
select throws_ok(
  $$
    insert into public.annotation_transcripts (
      annotation_id, transcript_text, provider, model
    ) values (
      '00000000-0000-4000-8000-000000000001', 'Transcript', 'provider', 'model'
    )
  $$,
  '42501',
  null,
  'authenticated direct transcript DML is denied'
);
select lives_ok(
  $$select public.set_profile_handle('hosted-creator')$$,
  'the owner can change a handle through the controlled RPC'
);
reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.profile_handle_aliases
    where profile_id = 'a1000000-0000-4000-8000-000000000001'
      and handle = 'hosted-creator-a1000000'
  ),
  1::bigint,
  'the prior generated handle is permanently reserved as an alias'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.set_profile_handle('hosted-creator-a1000000')$$,
  '23505',
  'That creator handle is unavailable.',
  'another creator cannot claim a reserved handle alias'
);
select throws_ok(
  $$update public.profiles set username = 'unsafe-change' where id = 'a1000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'direct username changes are denied'
);
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.publish_youtube_annotation(
      'https://www.youtube.com/watch?v=J---aiyznGQ',
      'https://www.youtube.com/watch?v=J---aiyznGQ',
      'J---aiyznGQ', 'Legacy long video', 'Legacy channel',
      0, 120000, 'Legacy YouTube remains readable'
    )
  $$,
  'legacy YouTube time-code publication remains available through Phase A'
);
select lives_ok(
  $$
    select public.publish_audio_clip_annotation(
      'https://example.test/podcast/legacy',
      'https://example.test/podcast/legacy',
      'Legacy episode', 'Host', 'Publisher', 'Show',
      0, 120000, 'Legacy podcast remains readable'
    )
  $$,
  'legacy podcast time-code publication remains available through Phase A'
);
select lives_ok(
  $$
    select public.publish_article_annotation(
      'https://example.test/article/phase-a',
      'https://example.test/article/phase-a',
      'Article remains', null, null, 'Selected passage', null, null,
      'Article publishing remains unchanged'
    )
  $$,
  'article publishing remains unchanged'
);
reset role;

set local role anon;
select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    where commentary_text in (
      'Legacy YouTube remains readable', 'Legacy podcast remains readable'
    )
  ),
  2::bigint,
  'legacy published YouTube and podcast rows remain publicly readable'
);
select is(
  (
    select pg_catalog.count(*)
    from public.annotation_targets as targets
    join public.annotations on annotations.id = targets.annotation_id
    where annotations.commentary_text in (
      'Legacy YouTube remains readable', 'Legacy podcast remains readable'
    )
      and targets.end_ms - targets.start_ms = 120000
  ),
  2::bigint,
  'historical stored targets over 90 seconds remain readable'
);
reset role;

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'),
  'claim privacy remains unchanged'
);

select throws_ok(
  $$
    update public.annotation_media
    set processing_status = 'not_a_state'
    where annotation_id = (
      select id from public.annotations where commentary_text = 'Hosted video for retry'
    )
  $$,
  '23514',
  null,
  'annotation_media rejects unknown durable states'
);
select throws_ok(
  $$
    insert into public.annotation_transcripts (
      annotation_id, transcript_text, provider, model
    ) values (
      (select id from public.annotations where commentary_text = 'Hosted video for retry'),
      '   ', 'provider', 'model'
    )
  $$,
  '23514',
  null,
  'annotation_transcripts rejects blank transcript text'
);
select throws_ok(
  $$
    insert into public.annotation_transcripts (
      annotation_id, transcript_text, segments, provider, model
    ) values (
      (select id from public.annotations where commentary_text = 'Hosted video for retry'),
      'Invalid segments',
      '[{"start_ms":1000,"end_ms":500,"text":"backwards"}]'::jsonb,
      'provider', 'model'
    )
  $$,
  '23514',
  null,
  'annotation_transcripts rejects invalid timestamp segments'
);

-- Publication guard: processed fields without confirmed raw deletion remain
-- processing and cannot publish.
update public.annotation_media as media
set
  processing_status = 'processing',
  processing_stage = 'finalizing',
  raw_storage_path = 'a1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webm',
  raw_mime_type = 'video/webm',
  raw_byte_size = 1000,
  processed_storage_path = 'a1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/excerpt.mp4',
  processed_mime_type = 'video/mp4',
  duration_ms = 90000,
  width = 426,
  height = 240,
  byte_size = 2000,
  checksum_sha256 = pg_catalog.repeat('a', 64),
  processed_at = pg_catalog.now()
where media.annotation_id = (
  select id from public.annotations where commentary_text = 'Hosted video 90 seconds'
);

select throws_ok(
  $$
    update public.annotations
    set status = 'published', published_at = pg_catalog.now()
    where commentary_text = 'Hosted video 90 seconds'
  $$,
  '23514',
  'Hosted media must be ready with valid final metadata and confirmed raw deletion before publication.',
  'hosted publication is rejected without confirmed raw deletion'
);

update public.annotation_media as media
set
  processing_status = 'ready',
  processing_stage = null,
  raw_storage_path = null,
  raw_deleted_at = pg_catalog.now()
where media.annotation_id = (
  select id from public.annotations where commentary_text = 'Hosted video 90 seconds'
);

select throws_ok(
  $$
    update public.annotations
    set status = 'published', published_at = pg_catalog.now()
    where commentary_text = 'Hosted video 90 seconds'
  $$,
  '23514',
  'A hosted media transcript is required before publication.',
  'ready hosted media cannot publish without a transcript'
);

-- Worker failure/retry: stage a valid derivative, fail transcription, and prove
-- the next lease starts at transcription with both raw and processed artifacts.
select private.mark_annotation_media_uploading(
  media.id,
  'a1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webm',
  'video/webm',
  4000000,
  '{"version":1,"viewport":{"width":1280,"height":720}}'::jsonb
)
from public.annotation_media as media
join public.annotations on annotations.id = media.annotation_id
where annotations.commentary_text = 'Hosted video for retry';

select lives_ok(
  $$
    select private.accept_annotation_media_upload(media.id)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted video for retry'
  $$,
  'an accepted private raw upload enters queued processing'
);

select is(
  (
    select pg_catalog.count(*)
    from private.claim_annotation_media_processing(
      (select media.id from public.annotation_media as media join public.annotations on annotations.id = media.annotation_id where annotations.commentary_text = 'Hosted video for retry'),
      600
    )
  ),
  1::bigint,
  'the first worker atomically acquires the processing lease'
);
select is(
  (
    select pg_catalog.count(*)
    from private.claim_annotation_media_processing(
      (select media.id from public.annotation_media as media join public.annotations on annotations.id = media.annotation_id where annotations.commentary_text = 'Hosted video for retry'),
      600
    )
  ),
  0::bigint,
  'a second worker cannot acquire an active lease'
);

select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media.id,
      media.lease_token,
      pg_catalog.repeat('b', 64),
      'a1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/excerpt.mp4',
      'video/mp4',
      30000,
      426,
      240,
      3000000,
      pg_catalog.repeat('c', 64)
    )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted video for retry'
  $$,
  'the worker stages a valid processed video derivative'
);

select lives_ok(
  $$
    select private.mark_annotation_media_processing_failed(
      media.id, media.lease_token, 'transcribing', 'provider_timeout'
    )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted video for retry'
  $$,
  'a transcription failure is recorded as a sanitized terminal attempt'
);
select ok(
  (
    select media.processed_storage_path is not null and media.raw_storage_path is not null
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted video for retry'
  ),
  'transcription failure retains both derivative and raw input for retry'
);
select lives_ok(
  $$
    select private.retry_annotation_media_processing(media.id)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted video for retry'
  $$,
  'a failed processing attempt can be queued for retry'
);
select is(
  (
    select claimed.processing_stage
    from private.claim_annotation_media_processing(
      (select media.id from public.annotation_media as media join public.annotations on annotations.id = media.annotation_id where annotations.commentary_text = 'Hosted video for retry'),
      600
    ) as claimed
  ),
  'transcribing',
  'transcription retry reuses the staged derivative without recapture or retranscode'
);

-- Complete the hosted audio path through raw allocation, lease, derivative,
-- excerpt-only transcript, confirmed raw deletion, and atomic publication.
select private.mark_annotation_media_uploading(
  media.id,
  'a1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webm',
  'audio/webm',
  1000000,
  '{"version":1,"timing":{"requested_duration_ms":30000}}'::jsonb
)
from public.annotation_media as media
join public.annotations on annotations.id = media.annotation_id
where annotations.commentary_text = 'Hosted audio 30 seconds';

select lives_ok(
  $$
    select private.accept_annotation_media_upload(media.id)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted audio 30 seconds'
  $$,
  'valid hosted audio upload enters processing'
);
select is(
  (
    select pg_catalog.count(*)
    from private.claim_annotation_media_processing(
      (select media.id from public.annotation_media as media join public.annotations on annotations.id = media.annotation_id where annotations.commentary_text = 'Hosted audio 30 seconds'),
      600
    )
  ),
  1::bigint,
  'the worker leases hosted audio processing'
);
select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media.id,
      media.lease_token,
      pg_catalog.repeat('d', 64),
      'a1000000-0000-4000-8000-000000000001/' || media.annotation_id::text || '/' || media.id::text || '/excerpt.m4a',
      'audio/mp4',
      30000,
      null,
      null,
      500000,
      pg_catalog.repeat('e', 64)
    )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted audio 30 seconds'
  $$,
  'the worker stages a valid processed audio derivative'
);
select lives_ok(
  $$
    select private.stage_annotation_media_transcript(
      media.id,
      media.lease_token,
      'Only the captured thirty-second excerpt.',
      'en',
      '[{"start_ms":0,"end_ms":15000,"text":"Only the captured"},{"start_ms":15000,"end_ms":30000,"text":"thirty-second excerpt."}]'::jsonb,
      'test-provider',
      'test-model',
      '{"request_id":"confidential"}'::jsonb
    )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted audio 30 seconds'
  $$,
  'the worker stages an excerpt-only timestamped transcript'
);
select lives_ok(
  $$
    select private.confirm_annotation_media_raw_deleted(media.id, media.lease_token)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted audio 30 seconds'
  $$,
  'raw deletion is confirmed only after derivative and transcript staging'
);
select lives_ok(
  $$
    select private.finalize_annotation_media_ready(media.id, media.lease_token)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'Hosted audio 30 seconds'
  $$,
  'valid hosted media finalization publishes atomically'
);
select ok(
  exists (
    select 1
    from public.annotations
    join public.annotation_media as media on media.annotation_id = annotations.id
    where annotations.commentary_text = 'Hosted audio 30 seconds'
      and annotations.status = 'published'
      and annotations.published_at is not null
      and media.processing_status = 'ready'
      and media.raw_storage_path is null
      and media.raw_deleted_at is not null
  ),
  'finalization commits published annotation, ready media, and raw-deletion invariant together'
);

set local role anon;
select is(
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media(
      (select id from public.annotations where commentary_text = 'Hosted audio 30 seconds')
    )
  ),
  1::bigint,
  'public ready-media projection exposes the finalized hosted artifact'
);
select is(
  (
    select transcript_text
    from public.get_public_annotation_transcript(
      (select id from public.annotations where commentary_text = 'Hosted audio 30 seconds')
    )
  ),
  'Only the captured thirty-second excerpt.',
  'public transcript projection exposes only the archived excerpt transcript'
);
reset role;

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_media(uuid)'::regprocedure
    ),
    'storage_path'
  ) = 0,
  'public ready-media projection does not expose a processed storage path'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_transcript(uuid)'::regprocedure
    ),
    'provider'
  ) = 0,
  'public transcript projection omits provider audit metadata'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_owned_annotation_media_status(uuid)'::regprocedure
    ),
    'storage_path'
  ) = 0,
  'owner status projection omits raw and processed storage paths'
);

select * from finish();
rollback;
