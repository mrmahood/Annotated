begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_function( -- 1
  'public',
  'get_public_annotation_transcript',
  array['uuid'],
  'the bounded public transcript projection exists'
);
select ok( -- 2
  pg_catalog.has_function_privilege(
    'anon', 'public.get_public_annotation_transcript(uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.get_public_annotation_transcript(uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.get_public_annotation_transcript(uuid)', 'execute'
  ),
  'public readers and the trusted server may execute the projection'
);
select ok( -- 3
  not pg_catalog.has_table_privilege(
    'anon', 'public.annotation_transcripts', 'select'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.annotation_transcripts', 'select'
  ),
  'browser roles still cannot read the transcript table directly'
);
select ok( -- 4
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'get_public_annotation_transcript'
  ),
  'the transcript projection is a security definer with an empty search path'
);
select ok( -- 5
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_transcript(uuid)'::regprocedure
    ),
    'provider'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_transcript(uuid)'::regprocedure
    ),
    'storage'
  ) = 0,
  'the public result type omits provider and Storage fields'
);

insert into auth.users (id, raw_user_meta_data)
values (
  'd1c00000-0000-4000-8000-000000000001',
  '{"full_name":"D1C Creator"}'::jsonb
);

insert into public.sources (
  id, normalized_url, canonical_url, source_type, title, author, publisher, metadata
) values (
  'd1c10000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'youtube',
  'D1C Ready Hosted Video',
  'Google for Developers',
  'YouTube',
  '{"video_id":"M7lc1UVf-VE"}'::jsonb
);
insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values (
  'd1c20000-0000-4000-8000-000000000001',
  'd1c10000-0000-4000-8000-000000000001',
  'd1c00000-0000-4000-8000-000000000001',
  'video_clip',
  'D1c ready hosted commentary',
  'draft',
  null
);
insert into public.annotation_targets (
  annotation_id, target_type, start_ms, end_ms
) values (
  'd1c20000-0000-4000-8000-000000000001', 'time_range', 1000, 10000
);
insert into public.annotation_media (
  id, annotation_id, media_type, processing_status,
  processed_storage_path, processed_mime_type, duration_ms,
  width, height, byte_size, checksum_sha256, processed_at, raw_deleted_at
) values (
  'd1c30000-0000-4000-8000-000000000001',
  'd1c20000-0000-4000-8000-000000000001',
  'video',
  'ready',
  'd1c00000-0000-4000-8000-000000000001/d1c20000-0000-4000-8000-000000000001/d1c30000-0000-4000-8000-000000000001/excerpt.mp4',
  'video/mp4',
  9000,
  426,
  240,
  400000,
  pg_catalog.repeat('a', 64),
  pg_catalog.now(),
  pg_catalog.now()
);
insert into public.annotation_transcripts (
  annotation_id, transcript_text, language, segments,
  provider, model, provider_metadata
) values (
  'd1c20000-0000-4000-8000-000000000001',
  'Only this nine-second D1c excerpt.',
  'en',
  '[{"start_ms":0,"end_ms":9000,"text":"Only this nine-second D1c excerpt."}]'::jsonb,
  'private-test-provider',
  'private-test-model',
  '{"confidential":"provider-audit-marker"}'::jsonb
);
update public.annotations
set status = 'published', published_at = pg_catalog.now()
where id = 'd1c20000-0000-4000-8000-000000000001';

set local role anon;
select is( -- 6
  (
    select transcript.transcript_text
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    ) as transcript
  ),
  'Only this nine-second D1c excerpt.',
  'an anonymous reader receives only the ready excerpt transcript'
);
select is( -- 7
  (
    select transcript.language
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    ) as transcript
  ),
  'en',
  'the bounded transcript language is public'
);
select is( -- 8
  (
    select transcript.segments -> 0 ->> 'text'
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    ) as transcript
  ),
  'Only this nine-second D1c excerpt.',
  'bounded relative transcript segments are public'
);
select ok( -- 9
  pg_catalog.strpos(
    (
      select pg_catalog.row_to_json(transcript)::text
      from public.get_public_annotation_transcript(
        'd1c20000-0000-4000-8000-000000000001'
      ) as transcript
    ),
    'provider-audit-marker'
  ) = 0,
  'provider metadata never enters the public projection'
);
reset role;

update public.annotation_media
set processed_storage_path =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
  'd1c20000-0000-4000-8000-000000000001/' ||
  'd1c30000-0000-4000-8000-000000000001/excerpt.mp4'
where id = 'd1c30000-0000-4000-8000-000000000001';
set local role anon;
select is( -- 10
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'a syntactically valid path bound to the wrong owner suppresses transcript text'
);
reset role;

update public.annotation_media
set processed_storage_path =
  'd1c00000-0000-4000-8000-000000000001/' ||
  'd1c20000-0000-4000-8000-000000000001/' ||
  'd1c30000-0000-4000-8000-000000000001/excerpt.mp4'
where id = 'd1c30000-0000-4000-8000-000000000001';
update public.annotation_transcripts
set segments = '[{"start_ms":0,"end_ms":10000,"text":"Outside derivative duration."}]'::jsonb
where annotation_id = 'd1c20000-0000-4000-8000-000000000001';
set local role anon;
select is( -- 11
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'a segment beyond the authoritative derivative duration suppresses the transcript'
);
reset role;

update public.annotation_transcripts
set segments = '[{"start_ms":0,"end_ms":9000,"text":"Only this nine-second D1c excerpt."}]'::jsonb
where annotation_id = 'd1c20000-0000-4000-8000-000000000001';
update public.annotation_media
set processing_status = 'removed', removed_at = pg_catalog.now()
where id = 'd1c30000-0000-4000-8000-000000000001';
set local role anon;
select is( -- 12
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'removed media suppresses its transcript immediately'
);
reset role;

update public.annotation_media
set processing_status = 'ready', removed_at = null
where id = 'd1c30000-0000-4000-8000-000000000001';
update public.annotations
set status = 'hidden'
where id = 'd1c20000-0000-4000-8000-000000000001';
set local role anon;
select is( -- 13
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'a hidden annotation suppresses transcript text'
);
reset role;

update public.annotations
set status = 'published'
where id = 'd1c20000-0000-4000-8000-000000000001';
set local role authenticated;
select is( -- 14
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  1::bigint,
  'authenticated public readers receive the same bounded projection'
);
reset role;

delete from public.annotation_transcripts
where annotation_id = 'd1c20000-0000-4000-8000-000000000001';
set local role anon;
select is( -- 15
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'missing transcript rows never produce a public placeholder'
);
reset role;

set local role anon;
select is( -- 16
  (
    select media_state.availability
    from public.get_public_annotation_media_state(
      'd1c20000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'ready',
  'a ready excerpt stays available when its transcript row is absent'
);
reset role;

set local role service_role;
select is( -- 17
  (
    select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      'd1c20000-0000-4000-8000-000000000001'
    )
  ),
  1::bigint,
  'the same missing-transcript row can still be signed by the trusted server'
);
reset role;

select ok( -- 18
  not pg_catalog.has_function_privilege(
    'public', 'public.get_public_annotation_transcript(uuid)', 'execute'
  ),
  'the function has no ambient PUBLIC execute grant'
);

select * from finish();
rollback;
