begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_function(
  'private', 'publish_annotation_media_playable', array['uuid', 'uuid'],
  'playable publication exists before transcription'
);

select ok(
  pg_catalog.has_function_privilege(
    'annotated_media_worker', 'private.publish_annotation_media_playable(uuid,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.publish_annotation_media_playable(uuid,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'private.publish_annotation_media_playable(uuid,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.publish_annotation_media_playable(uuid,uuid)', 'execute'
  ),
  'only the worker and service role can publish a playable excerpt'
);

insert into auth.users (id, raw_user_meta_data)
values ('pbt00000-0000-4000-8000-000000000001', '{"full_name":"Playable Excerpt"}'::jsonb);

select pg_catalog.set_config('request.jwt.claim.sub', 'pbt00000-0000-4000-8000-000000000001', true);
set local role authenticated;
select * from public.begin_hosted_audio_annotation(
  'https://example.test/pbt-geometry', 'https://example.test/pbt-geometry',
  'PBT geometry', 'Host', 'Publisher', 'Series', 12000, 16000, 'PBT geometry'
);
select * from public.begin_hosted_audio_annotation(
  'https://example.test/pbt-changed', 'https://example.test/pbt-changed',
  'PBT changed', 'Host', 'Publisher', 'Series', 12000, 16000, 'PBT changed'
);
select * from public.begin_hosted_audio_annotation(
  'https://example.test/pbt-timeout', 'https://example.test/pbt-timeout',
  'PBT timeout', 'Host', 'Publisher', 'Series', 12000, 16000, 'PBT timeout'
);
select * from public.begin_hosted_audio_annotation(
  'https://example.test/pbt-playable', 'https://example.test/pbt-playable',
  'PBT playable', 'Host', 'Publisher', 'Series', 12000, 16000, 'PBT playable'
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
    where annotations.commentary_text like 'PBT %'
  $$,
  'the four fixtures enter uploading'
);

select lives_ok(
  $$
    select private.accept_annotation_media_upload(media.id)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text like 'PBT %'
  $$,
  'the four fixtures enter processing'
);

create temporary table pbt_geometry as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'PBT geometry'),
  900
) as claimed;

select is(
  (select result_status
    from private.release_annotation_media_processing_attempt(
      (select media_id from pbt_geometry),
      (select lease_token from pbt_geometry),
      'transcoding', 'unsafe_geometry'
    )),
  'failed',
  'unsafe_geometry fails on the first attempt'
);
select ok(
  (select media.processing_status = 'failed'
      and media.failure_code = 'unsafe_geometry'
      and media.next_attempt_at is null
      and media.attempt_count = 1
      and annotations.status = 'draft'
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where media.id = (select media_id from pbt_geometry)),
  'a geometry failure is terminal and leaves the annotation a draft'
);
select is(
  (select pg_catalog.count(*) from private.claim_annotation_media_processing(
    (select media_id from pbt_geometry), 900
  )),
  0::bigint,
  'a terminal geometry failure is not claimed again'
);

create temporary table pbt_changed as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'PBT changed'),
  900
) as claimed;

select is(
  (select result_status
    from private.release_annotation_media_processing_attempt(
      (select media_id from pbt_changed),
      (select lease_token from pbt_changed),
      'transcoding', 'capture_changed'
    )),
  'failed',
  'a viewport change is terminal on the first attempt'
);

create temporary table pbt_timeout as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'PBT timeout'),
  900
) as claimed;

select is(
  (select result_status
    from private.release_annotation_media_processing_attempt(
      (select media_id from pbt_timeout),
      (select lease_token from pbt_timeout),
      'transcoding', 'transcode_timeout'
    )),
  'processing',
  'a transient transcode failure is still retried'
);
select ok(
  (select media.processing_status = 'processing'
      and media.next_attempt_at > pg_catalog.now()
      and media.attempt_count = 1
    from public.annotation_media as media
    where media.id = (select media_id from pbt_timeout)),
  'transient failures keep a future retry time'
);

create temporary table pbt_playable as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'PBT playable'),
  900
) as claimed;

select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id, lease_token, pg_catalog.repeat('a', 64), expected_processed_storage_path,
      'audio/mp4', 4000, null, null, 1000, pg_catalog.repeat('b', 64)
    ) from pbt_playable
  $$,
  'the derivative can be staged before a transcript exists'
);
select lives_ok(
  $$
    select private.confirm_annotation_media_raw_deleted(media_id, lease_token) from pbt_playable
  $$,
  'raw deletion can be confirmed before a transcript exists'
);
select lives_ok(
  $$
    select private.publish_annotation_media_playable(media_id, lease_token) from pbt_playable
  $$,
  'publication succeeds before a transcript exists'
);

select ok(
  (select annotations.status = 'published'
      and media.processing_status = 'ready'
      and media.processing_stage = 'transcribing'
      and media.raw_storage_path is null
      and media.raw_deleted_at is not null
      and media.lease_token is not null
      and not exists (
        select 1 from public.annotation_transcripts as transcript
        where transcript.annotation_id = media.annotation_id
      )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where media.id = (select media_id from pbt_playable)),
  'the annotation is public once the excerpt is playable and before a transcript exists'
);

set local role anon;
select is(
  (select media_state.availability
    from public.get_public_annotation_media_state(
      (select annotation_id from pbt_playable)
    ) as media_state),
  'ready',
  'the public media state is ready without a transcript'
);
select is(
  (select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      (select annotation_id from pbt_playable)
    )),
  0::bigint,
  'the transcript projection stays empty until a transcript row exists'
);
reset role;

set local role service_role;
select is(
  (select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      (select annotation_id from pbt_playable)
    )),
  1::bigint,
  'the feed can sign the playable excerpt before transcription'
);
reset role;

select is(
  (select result_status
    from private.release_annotation_media_processing_attempt(
      (select media_id from pbt_playable),
      (select lease_token from pbt_playable),
      'transcribing', 'provider_timeout'
    )),
  'processing',
  'a transcription failure after publication schedules another attempt'
);
select ok(
  (select annotations.status = 'published'
      and media.processing_status = 'ready'
      and media.next_attempt_at > pg_catalog.now()
      and media.lease_token is null
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where media.id = (select media_id from pbt_playable)),
  'transcription retry does not unpublish or hide the excerpt'
);

update public.annotation_media
set next_attempt_at = pg_catalog.now()
where id = (select media_id from pbt_playable);

select is(
  (select resume_stage
    from private.list_annotation_media_dispatch_candidates(100)
    where media_id = (select media_id from pbt_playable)),
  'transcribing',
  'a published excerpt missing its transcript is due for transcription'
);

create temporary table pbt_transcript_retry as
select claimed.*
from private.claim_annotation_media_processing(
  (select media_id from pbt_playable), 900
) as claimed;

select is(
  (select resume_stage from pbt_transcript_retry),
  'transcribing',
  'the transcript retry resumes at transcription and keeps the published excerpt'
);
select ok(
  (select annotations.status = 'published' and media.processing_status = 'ready'
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where media.id = (select media_id from pbt_transcript_retry)),
  'claiming the transcript retry does not return the annotation to draft'
);

select lives_ok(
  $$
    select private.stage_annotation_media_transcript(
      media_id, lease_token, 'Playable excerpt transcript.', 'en',
      '[{"start_ms":0,"end_ms":4000,"text":"Playable excerpt transcript."}]'::jsonb,
      'deterministic-fake', 'fixture-v1', '{"local_fixture":true}'::jsonb
    ) from pbt_transcript_retry
  $$,
  'the transcript can be attached after the excerpt is already public'
);
select lives_ok(
  $$
    select private.finalize_annotation_media_ready(media_id, lease_token) from pbt_transcript_retry
  $$,
  'finalization clears the lease without requiring the annotation to still be a draft'
);

select is(
  (select pg_catalog.count(*) from private.claim_annotation_media_processing(
    (select media_id from pbt_playable), 900
  )),
  0::bigint,
  'a ready excerpt that already has a transcript is not claimed again'
);

select ok(
  not exists (
    select 1
    from private.list_annotation_media_dispatch_candidates(100)
    where media_id = (select media_id from pbt_playable)
  ),
  'a transcribed ready excerpt is not dispatched again'
);

select * from finish();
rollback;
