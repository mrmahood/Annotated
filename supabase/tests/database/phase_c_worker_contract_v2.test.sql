begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select has_function(
  'private', 'release_annotation_media_processing_attempt',
  array['uuid', 'uuid', 'text', 'text'],
  'lease-fenced retryable-attempt transition exists'
);
select has_function(
  'private', 'list_annotation_media_dispatch_candidates', array['integer'],
  'bounded dispatch-candidate function exists'
);
select has_function(
  'private', 'list_annotation_media_reconciliation_candidates', array['integer'],
  'bounded reconciliation-candidate function exists'
);
select has_function(
  'private', 'reconcile_annotation_media_processing', array['uuid'],
  'processing reconciliation transition exists'
);
select has_function(
  'private', 'claim_annotation_media_cleanup', array['uuid'],
  'exact-path cleanup claim exists'
);
select has_function(
  'private', 'confirm_annotation_media_cleanup',
  array['uuid', 'text', 'text', 'timestamp with time zone'],
  'stale-guarded cleanup confirmation exists'
);

select ok(
  not pg_catalog.has_function_privilege('public', 'private.release_annotation_media_processing_attempt(uuid,uuid,text,text)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'private.release_annotation_media_processing_attempt(uuid,uuid,text,text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'private.release_annotation_media_processing_attempt(uuid,uuid,text,text)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'private.release_annotation_media_processing_attempt(uuid,uuid,text,text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'private.list_annotation_media_dispatch_candidates(integer)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'private.list_annotation_media_dispatch_candidates(integer)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'private.claim_annotation_media_cleanup(uuid)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'private.confirm_annotation_media_cleanup(uuid,text,text,timestamp with time zone)', 'execute'),
  'new worker functions are service-only'
);

select ok(
  private.is_worker_capture_metadata_v2(
    '{"version":2,"capture_track":{"mime_type":"audio/webm;codecs=opus","audio_track_count":1,"video_track_count":0,"tracks":[{"kind":"audio","label":"","enabled":true,"muted":false,"readyState":"live","settings":{"sampleRate":48000}}],"loopback_enabled":true},"timing":{"requested_start_ms":12000,"requested_end_ms":16000,"requested_duration_ms":4000,"lead_in_ms":35,"recorder_elapsed_ms":4035,"player_start_ms":12000,"player_end_ms":16000,"lead_in_clock":"offscreen_monotonic"}}'::jsonb,
    'audio', 12000, 16000
  ),
  'complete bounded audio capture metadata v2 is worker-processable'
);
select ok(
  not private.is_worker_capture_metadata_v2('{"version":1}'::jsonb, 'audio', 12000, 16000),
  'capture metadata v1 is never worker-processable'
);

insert into auth.users (id, raw_user_meta_data)
values ('c4000000-0000-4000-8000-000000000001', '{"full_name":"C4 Worker Contract"}'::jsonb);

select pg_catalog.set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select * from public.begin_hosted_audio_annotation(
  'https://example.test/c4-audio', 'https://example.test/c4-audio',
  'C4 audio', 'Host', 'Publisher', 'Series', 12000, 16000, 'C4 worker envelope'
);
select * from public.begin_hosted_audio_annotation(
  'https://example.test/c4-legacy', 'https://example.test/c4-legacy',
  'C4 legacy', 'Host', 'Publisher', 'Series', 20000, 24000, 'C4 legacy recapture'
);
reset role;

select lives_ok(
  $$
    select private.mark_annotation_media_uploading(
      media.id,
      annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
        '/44444444-4444-4444-8444-444444444444.webm',
      'audio/webm', 1000,
      '{"version":2,"capture_track":{"mime_type":"audio/webm;codecs=opus","audio_track_count":1,"video_track_count":0,"tracks":[{"kind":"audio","label":"","enabled":true,"muted":false,"readyState":"live","settings":{"sampleRate":48000}}],"loopback_enabled":true},"timing":{"requested_start_ms":12000,"requested_end_ms":16000,"requested_duration_ms":4000,"lead_in_ms":35,"recorder_elapsed_ms":4035,"player_start_ms":12000,"player_end_ms":16000,"lead_in_clock":"offscreen_monotonic"}}'::jsonb
    )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C4 worker envelope'
  $$,
  'metadata v2 enters uploading through the strict private transition'
);
select lives_ok(
  $$
    select private.accept_annotation_media_upload(media.id)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C4 worker envelope'
  $$,
  'verified metadata v2 upload enters processing'
);

create temporary table c4_claim as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C4 worker envelope'),
  900
) as claimed;

select is((select target_start_ms from c4_claim), 12000, 'claim returns authoritative target start');
select is((select target_end_ms from c4_claim), 16000, 'claim returns authoritative target end');
select is((select resume_stage from c4_claim), 'probing', 'raw-only claim resumes at probing');
select ok(
  (select expected_processed_storage_path =
    'c4000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a'
    from c4_claim),
  'claim returns the exact server-derived processed path'
);
select is(
  (select pg_catalog.count(*) from private.claim_annotation_media_processing(
    (select media_id from c4_claim), 900
  )),
  0::bigint,
  'a live lease cannot be claimed twice'
);

select lives_ok(
  $$
    select private.release_annotation_media_processing_attempt(
      media_id, lease_token, 'probing', 'temporary_failure'
    ) from c4_claim
  $$,
  'retryable failure is recorded through the lease-fenced transition'
);
select ok(
  (select media.processing_status = 'processing'
      and media.processing_stage = 'queued'
      and media.next_attempt_at > pg_catalog.now()
      and media.lease_token is null
      and media.raw_storage_path is not null
    from public.annotation_media as media where media.id = (select media_id from c4_claim)),
  'retry backoff is server-scheduled and preserves the raw artifact'
);

update public.annotation_media
set next_attempt_at = pg_catalog.now()
where id = (select media_id from c4_claim);

create temporary table c4_retry_claim as
select claimed.*
from private.claim_annotation_media_processing((select media_id from c4_claim), 900) as claimed;

select is(
  (select resume_stage from c4_retry_claim),
  'probing',
  'a due retry derives its resume stage from persisted facts'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c4000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      1000,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from c4_retry_claim
  $$,
  '22023',
  'Processed duration is invalid for the requested hosted range.',
  'a one-second derivative cannot satisfy a four-second hosted range'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c4000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      4010,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from c4_retry_claim
  $$,
  '22023',
  'Processed duration is invalid for the requested hosted range.',
  'a derivative may not extend beyond the authoritative four-second hosted range'
);

update public.annotation_media as media
set processing_status = 'processing', processing_stage = 'queued',
  capture_metadata = '{"version":1}'::jsonb,
  raw_storage_path = annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
    '/55555555-5555-4555-8555-555555555555.webm',
  raw_mime_type = 'audio/webm', raw_byte_size = 1000, next_attempt_at = pg_catalog.now()
from public.annotations
where annotations.id = media.annotation_id and annotations.commentary_text = 'C4 legacy recapture';

select is(
  (select pg_catalog.count(*) from private.claim_annotation_media_processing(
    (select media.id from public.annotation_media as media
      join public.annotations on annotations.id = media.annotation_id
      where annotations.commentary_text = 'C4 legacy recapture'),
    900
  )),
  0::bigint,
  'a capture-metadata v1 row cannot produce a worker lease'
);
select is(
  (select media.failure_code from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C4 legacy recapture'),
  'recapture_required',
  'a capture-metadata v1 claim fails closed with bounded recapture_required'
);

-- Construct a historical terminal row without the production timestamp trigger
-- replacing the fixture value with now(). The trigger is restored immediately;
-- both ALTER TABLE statements are also protected by this test transaction.
alter table public.annotation_media disable trigger annotation_media_set_updated_at;

update public.annotation_media as media
set updated_at = pg_catalog.now() - interval '73 hours'
from public.annotations
where annotations.id = media.annotation_id and annotations.commentary_text = 'C4 legacy recapture';

alter table public.annotation_media enable trigger annotation_media_set_updated_at;

create temporary table c4_cleanup as
select claimed.*
from private.claim_annotation_media_cleanup(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C4 legacy recapture')
) as claimed;

select is(
  (select cleanup_reason from c4_cleanup),
  'terminal_raw_cleanup',
  'terminal raw retention produces one exact cleanup claim'
);
select lives_ok(
  $$
    select private.confirm_annotation_media_cleanup(
      media_id, raw_storage_path, processed_storage_path, observed_updated_at
    ) from c4_cleanup
  $$,
  'confirmed Storage absence records cleanup through the stale-guarded transition'
);
select ok(
  (select media.processing_status = 'removed'
      and media.raw_storage_path is null
      and media.processed_storage_path is null
      and media.raw_deleted_at is not null
      and annotations.status = 'draft'
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where media.id = (select media_id from c4_cleanup)),
  'cleanup removes private object references without publishing the annotation'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral pg_catalog.unnest(pg_proc.proargnames) as argument_name
    where pg_namespace.nspname = 'private'
      and pg_proc.proname in (
        'list_annotation_media_dispatch_candidates',
        'list_annotation_media_reconciliation_candidates'
      )
      and argument_name in (
        'raw_storage_path', 'processed_storage_path', 'lease_token',
        'transcript_text', 'provider_metadata'
      )
  ),
  'candidate functions expose no paths, lease tokens, transcript, or provider data'
);

select * from finish();
rollback;
