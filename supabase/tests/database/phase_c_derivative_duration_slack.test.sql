begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select is(
  (
    select pg_catalog.obj_description(pg_proc.oid)
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'stage_annotation_media_derivative'
  ),
  'Worker-only idempotent staging of a final derivative whose duration matches the authoritative hosted range within the JS+SQL 22 ms slack of one AAC-LC frame, still clamped to 1000..90000 ms.',
  'function comment records the shared 22 ms AAC-LC-frame slack'
);

select ok(
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'stage_annotation_media_derivative'
  ),
  'replaced derivative staging stays security definer with an empty search_path'
);

select ok(
  pg_catalog.has_function_privilege(
    'annotated_media_worker',
    'private.stage_annotation_media_derivative(uuid,uuid,text,text,text,integer,integer,integer,bigint,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'private.stage_annotation_media_derivative(uuid,uuid,text,text,text,integer,integer,integer,bigint,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'private.stage_annotation_media_derivative(uuid,uuid,text,text,text,integer,integer,integer,bigint,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'private.stage_annotation_media_derivative(uuid,uuid,text,text,text,integer,integer,integer,bigint,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'private.stage_annotation_media_derivative(uuid,uuid,text,text,text,integer,integer,integer,bigint,text)',
    'execute'
  ),
  'derivative staging remains worker-only execute'
);

insert into auth.users (id, raw_user_meta_data)
values ('c5000000-0000-4000-8000-000000000001', '{"full_name":"C Duration Slack"}'::jsonb);

select pg_catalog.set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select * from public.begin_hosted_audio_annotation(
  'https://example.test/c-duration-slack-audio',
  'https://example.test/c-duration-slack-audio',
  'C duration slack audio', 'Host', 'Publisher', 'Series',
  20000, 29295, 'C duration slack audio 9295'
);
select * from public.begin_hosted_audio_annotation(
  'https://example.test/c-duration-slack-90s',
  'https://example.test/c-duration-slack-90s',
  'C duration slack 90s', 'Host', 'Publisher', 'Series',
  0, 90000, 'C duration slack audio 90s'
);
select * from public.begin_hosted_youtube_annotation(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'dQw4w9WgXcQ', 'C duration slack video', 'Channel',
  10000, 19295, 'C duration slack video 9295'
);
reset role;

select private.mark_annotation_media_uploading(
  media.id,
  annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
    '/55555555-5555-4555-8555-555555555555.webm',
  'audio/webm', 1000,
  '{"version":2,"capture_track":{"mime_type":"audio/webm;codecs=opus","audio_track_count":1,"video_track_count":0,"tracks":[{"kind":"audio","label":"","enabled":true,"muted":false,"readyState":"live","settings":{"sampleRate":48000}}],"loopback_enabled":true},"timing":{"requested_start_ms":20000,"requested_end_ms":29295,"requested_duration_ms":9295,"lead_in_ms":35,"recorder_elapsed_ms":9330,"player_start_ms":20000,"player_end_ms":29295,"lead_in_clock":"offscreen_monotonic"}}'::jsonb
)
from public.annotation_media as media
join public.annotations on annotations.id = media.annotation_id
where annotations.commentary_text = 'C duration slack audio 9295';

select private.mark_annotation_media_uploading(
  media.id,
  annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
    '/66666666-6666-4666-8666-666666666666.webm',
  'audio/webm', 1000,
  '{"version":2,"capture_track":{"mime_type":"audio/webm;codecs=opus","audio_track_count":1,"video_track_count":0,"tracks":[{"kind":"audio","label":"","enabled":true,"muted":false,"readyState":"live","settings":{"sampleRate":48000}}],"loopback_enabled":true},"timing":{"requested_start_ms":0,"requested_end_ms":90000,"requested_duration_ms":90000,"lead_in_ms":35,"recorder_elapsed_ms":90035,"player_start_ms":0,"player_end_ms":90000,"lead_in_clock":"offscreen_monotonic"}}'::jsonb
)
from public.annotation_media as media
join public.annotations on annotations.id = media.annotation_id
where annotations.commentary_text = 'C duration slack audio 90s';

select private.mark_annotation_media_uploading(
  media.id,
  annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
    '/77777777-7777-4777-8777-777777777777.webm',
  'video/webm', 4000000,
  '{"version":2,"viewport":{"start":{"width":1280,"height":720,"device_pixel_ratio":1,"scroll_x":0,"scroll_y":0},"end":{"width":1280,"height":720,"device_pixel_ratio":1,"scroll_x":0,"scroll_y":0}},"video_element":{"start":{"x":0,"y":0,"width":1280,"height":720,"top":0,"right":1280,"bottom":720,"left":0},"end":{"x":0,"y":0,"width":1280,"height":720,"top":0,"right":1280,"bottom":720,"left":0}},"intrinsic_video":{"width":1920,"height":1080},"computed_style":{"object_fit":"contain","object_position":"50% 50%"},"fullscreen":{"start":false,"end":false},"capture_track":{"mime_type":"video/webm;codecs=vp9,opus","audio_track_count":1,"video_track_count":1,"tracks":[{"kind":"audio","label":"","enabled":true,"muted":false,"readyState":"live","settings":{}},{"kind":"video","label":"","enabled":true,"muted":false,"readyState":"live","settings":{"width":1280,"height":720}}],"loopback_enabled":true},"timing":{"requested_start_ms":10000,"requested_end_ms":19295,"requested_duration_ms":9295,"lead_in_ms":40,"recorder_elapsed_ms":9335,"player_start_ms":10000,"player_end_ms":19295,"lead_in_clock":"offscreen_monotonic"}}'::jsonb
)
from public.annotation_media as media
join public.annotations on annotations.id = media.annotation_id
where annotations.commentary_text = 'C duration slack video 9295';

select private.accept_annotation_media_upload(media.id)
from public.annotation_media as media
join public.annotations on annotations.id = media.annotation_id
where annotations.commentary_text in (
  'C duration slack audio 9295',
  'C duration slack audio 90s',
  'C duration slack video 9295'
);

create temporary table slack_audio as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C duration slack audio 9295'),
  900
) as claimed;

create temporary table slack_audio_90s as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C duration slack audio 90s'),
  900
) as claimed;

create temporary table slack_video as
select claimed.*
from private.claim_annotation_media_processing(
  (select media.id from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'C duration slack video 9295'),
  900
) as claimed;

select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      9300,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from slack_audio
  $$,
  'a 9300 ms derivative is valid for a 9295 ms hosted range'
);

select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      9317,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from slack_audio
  $$,
  'a derivative exactly 22 ms past the 9295 ms hosted range is accepted'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      9318,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from slack_audio
  $$,
  '22023',
  'Processed duration is invalid for the requested hosted range.',
  'a derivative 23 ms past the 9295 ms hosted range is rejected'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      90001,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from slack_audio
  $$,
  '22023',
  'Processed duration is invalid for the requested hosted range.',
  'a 90001 ms derivative is rejected even when the hosted range is 9295 ms'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      9272,
      null,
      null,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from slack_audio
  $$,
  '22023',
  'Processed duration is invalid for the requested hosted range.',
  'a derivative 23 ms short of the 9295 ms hosted range is rejected'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('a', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'video/mp4',
      9300,
      426,
      240,
      1000,
      pg_catalog.repeat('b', 64)
    )
    from slack_audio
  $$,
  '22023',
  'Processed media metadata does not match the hosted media type.',
  'audio staging still rejects a video MIME and 240p dimensions'
);

select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('c', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      90000,
      null,
      null,
      1000,
      pg_catalog.repeat('d', 64)
    )
    from slack_audio_90s
  $$,
  'an exact 90,000 ms derivative remains valid for a 90-second hosted range'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('c', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.m4a',
      'audio/mp4',
      90001,
      null,
      null,
      1000,
      pg_catalog.repeat('d', 64)
    )
    from slack_audio_90s
  $$,
  '22023',
  'Processed duration is invalid for the requested hosted range.',
  'the 90-second product ceiling still rejects 90,001 ms'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('e', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.mp4',
      'audio/mp4',
      9300,
      null,
      null,
      1000,
      pg_catalog.repeat('f', 64)
    )
    from slack_video
  $$,
  '22023',
  'Processed media metadata does not match the hosted media type.',
  'video staging still rejects an audio MIME and missing 240p dimensions'
);

select throws_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('e', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.mp4',
      'video/mp4',
      9300,
      426,
      1,
      1000,
      pg_catalog.repeat('f', 64)
    )
    from slack_video
  $$,
  '22023',
  'Processed media metadata does not match the hosted media type.',
  'video staging still rejects a height below the hosted dimension floor'
);

select lives_ok(
  $$
    select private.stage_annotation_media_derivative(
      media_id,
      lease_token,
      pg_catalog.repeat('e', 64),
      'c5000000-0000-4000-8000-000000000001/' || annotation_id::text || '/' || media_id::text || '/excerpt.mp4',
      'video/mp4',
      9300,
      426,
      240,
      3000000,
      pg_catalog.repeat('f', 64)
    )
    from slack_video
  $$,
  'a 426x240 video derivative at 9300 ms is valid for a 9295 ms hosted range'
);

select ok(
  (
    select media.processing_stage = 'transcribing'
      and media.duration_ms = 9300
      and media.width = 426
      and media.height = 240
      and media.processed_mime_type = 'video/mp4'
      and annotations.status = 'draft'
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where media.id = (select media_id from slack_video)
  ),
  'accepted 240p staging persists processed facts without publishing the draft'
);

select * from finish();
rollback;
