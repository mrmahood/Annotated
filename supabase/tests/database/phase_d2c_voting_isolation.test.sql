begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select lives_ok(
  $$
    insert into auth.users (id, raw_user_meta_data) values
      ('d2c00000-0000-4000-8000-000000000001', '{"full_name":"D2C Creator"}'::jsonb),
      ('d2c00000-0000-4000-8000-000000000002', '{"full_name":"D2C Voter"}'::jsonb),
      ('d2c00000-0000-4000-8000-000000000003', '{"full_name":"D2C Commenter"}'::jsonb),
      ('d2c00000-0000-4000-8000-000000000004', '{"full_name":"D2C Follower"}'::jsonb);

    insert into public.sources (
      id, normalized_url, canonical_url, source_type, title
    ) values (
      'd2c20000-0000-4000-8000-000000000001',
      'https://example.test/d2c/isolation',
      'https://example.test/d2c/isolation',
      'article',
      'D2c isolation source'
    );

    insert into public.annotations (
      id, source_id, user_id, annotation_type, commentary_text, status,
      published_at, created_at, updated_at
    ) values
      (
        'd2c10000-0000-4000-8000-000000000001',
        'd2c20000-0000-4000-8000-000000000001',
        'd2c00000-0000-4000-8000-000000000001',
        'article_text', 'D2c older public annotation', 'published',
        '2026-08-25 12:00:00+00', '2026-08-25 12:00:00+00', '2026-08-25 12:00:00+00'
      ),
      (
        'd2c10000-0000-4000-8000-000000000002',
        'd2c20000-0000-4000-8000-000000000001',
        'd2c00000-0000-4000-8000-000000000001',
        'article_text', 'D2c newer public annotation', 'published',
        '2026-08-25 12:01:00+00', '2026-08-25 12:01:00+00', '2026-08-25 12:01:00+00'
      ),
      (
        'd2c10000-0000-4000-8000-000000000003',
        'd2c20000-0000-4000-8000-000000000001',
        'd2c00000-0000-4000-8000-000000000001',
        'audio_clip', 'D2c removed annotation', 'draft',
        null, '2026-08-25 12:02:00+00', '2026-08-25 12:02:00+00'
      );

    insert into public.annotation_targets (
      id, annotation_id, target_type, selected_text, start_ms, end_ms
    ) values
      (
        'd2c30000-0000-4000-8000-000000000001',
        'd2c10000-0000-4000-8000-000000000001',
        'text', 'D2c older selected text', null, null
      ),
      (
        'd2c30000-0000-4000-8000-000000000002',
        'd2c10000-0000-4000-8000-000000000002',
        'text', 'D2c newer selected text', null, null
      ),
      (
        'd2c30000-0000-4000-8000-000000000003',
        'd2c10000-0000-4000-8000-000000000003',
        'time_range', null, 1000, 5000
      );

    insert into public.claims (
      id, annotation_id, claimant_name, claimant_email,
      relationship_to_content, reason, details, status,
      created_at, updated_at
    ) values (
      'd2c40000-0000-4000-8000-000000000001',
      'd2c10000-0000-4000-8000-000000000003',
      'D2c claimant', 'd2c-claimant@example.test', 'rights holder',
      'D2c exact removal reason', 'D2c exact private details', 'resolved',
      '2026-08-25 12:03:00+00', '2026-08-25 12:03:00+00'
    );

    insert into public.annotation_media (
      id, annotation_id, media_type, processing_status, removed_at,
      removal_claim_id, created_at, updated_at
    ) values (
      'd2c50000-0000-4000-8000-000000000001',
      'd2c10000-0000-4000-8000-000000000003',
      'audio', 'removed', '2026-08-25 12:04:00+00',
      'd2c40000-0000-4000-8000-000000000001',
      '2026-08-25 12:02:00+00', '2026-08-25 12:04:00+00'
    );

    update public.annotations
    set status = 'removed'
    where id = 'd2c10000-0000-4000-8000-000000000003';

    insert into public.annotation_comments (
      id, annotation_id, user_id, body, status, created_at
    ) values (
      'd2c60000-0000-4000-8000-000000000001',
      'd2c10000-0000-4000-8000-000000000001',
      'd2c00000-0000-4000-8000-000000000003',
      'D2c public comment', 'public', '2026-08-25 12:05:00+00'
    );

    insert into public.profile_follows (follower_id, followed_id, created_at)
    values (
      'd2c00000-0000-4000-8000-000000000004',
      'd2c00000-0000-4000-8000-000000000001',
      '2026-08-25 12:06:00+00'
    );

    select pg_catalog.set_config(
      'request.jwt.claim.sub', 'd2c00000-0000-4000-8000-000000000001', true
    );
    set local role authenticated;
    select * from public.begin_hosted_audio_annotation(
      'https://example.test/d2c/worker',
      'https://example.test/d2c/worker',
      'D2c worker source', 'D2c host', 'D2c publisher', 'D2c series',
      12000, 16000, 'D2c worker candidate'
    );
    reset role;

    select private.mark_annotation_media_uploading(
      media.id,
      annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
        '/d2c70000-0000-4000-8000-000000000001.webm',
      'audio/webm', 1000,
      '{"version":2,"capture_track":{"mime_type":"audio/webm;codecs=opus","audio_track_count":1,"video_track_count":0,"tracks":[{"kind":"audio","label":"","enabled":true,"muted":false,"readyState":"live","settings":{"sampleRate":48000}}],"loopback_enabled":true},"timing":{"requested_start_ms":12000,"requested_end_ms":16000,"requested_duration_ms":4000,"lead_in_ms":35,"recorder_elapsed_ms":4035,"player_start_ms":12000,"player_end_ms":16000,"lead_in_clock":"offscreen_monotonic"}}'::jsonb
    )
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'D2c worker candidate';

    select private.accept_annotation_media_upload(media.id)
    from public.annotation_media as media
    join public.annotations on annotations.id = media.annotation_id
    where annotations.commentary_text = 'D2c worker candidate';
  $$,
  'exact discovery, social, claim, removal, media, and worker fixtures are valid'
); -- 1

create temporary table d2c_before (
  boundary text primary key,
  payload jsonb not null
);

insert into d2c_before (boundary, payload) values
  (
    'feed_order',
    (select pg_catalog.jsonb_agg(id order by published_at desc, id desc)
     from public.annotations
     where status = 'published' and id::text like 'd2c1%')
  ),
  (
    'profile_order',
    (select pg_catalog.jsonb_agg(id order by published_at desc, id desc)
     from public.annotations
     where status = 'published'
       and user_id = 'd2c00000-0000-4000-8000-000000000001'
       and id::text like 'd2c1%')
  ),
  (
    'annotations',
    (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
     from (
       select * from public.annotations
       where user_id = 'd2c00000-0000-4000-8000-000000000001'
         and (id::text like 'd2c1%' or commentary_text = 'D2c worker candidate')
     ) as rows)
  ),
  (
    'comments',
    (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
     from (select * from public.annotation_comments where id::text like 'd2c6%') as rows)
  ),
  (
    'follows',
    (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.follower_id, rows.followed_id)
     from (select * from public.profile_follows
           where follower_id = 'd2c00000-0000-4000-8000-000000000004') as rows)
  ),
  (
    'claims',
    (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
     from (select * from public.claims where id::text like 'd2c4%') as rows)
  ),
  (
    'media',
    (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
     from (
       select media.* from public.annotation_media as media
       join public.annotations on annotations.id = media.annotation_id
       where media.id::text like 'd2c5%' or annotations.commentary_text = 'D2c worker candidate'
     ) as rows)
  ),
  (
    'worker_candidates',
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.media_id), '[]'::jsonb)
     from (
       select candidates.*
       from private.list_annotation_media_dispatch_candidates(500) as candidates
       join public.annotation_media as media on media.id = candidates.media_id
       join public.annotations on annotations.id = media.annotation_id
       where annotations.commentary_text = 'D2c worker candidate'
     ) as rows)
  );

select results_eq( -- 2
  $$select result_code, current_vote, upvote_count, downvote_count
    from public.mutate_annotation_vote(
      'd2c00000-0000-4000-8000-000000000002',
      'd2c10000-0000-4000-8000-000000000001',
      1::smallint
    )$$,
  $$values ('CREATED'::text, 1::smallint, 1::bigint, 0::bigint)$$,
  'the isolation probe performs one real trusted vote mutation'
);

select is( -- 3
  (select payload from d2c_before where boundary = 'feed_order'),
  (select pg_catalog.jsonb_agg(id order by published_at desc, id desc)
   from public.annotations where status = 'published' and id::text like 'd2c1%'),
  'votes do not change feed membership or published-at and ID ordering'
);

select is( -- 4
  (select payload from d2c_before where boundary = 'profile_order'),
  (select pg_catalog.jsonb_agg(id order by published_at desc, id desc)
   from public.annotations
   where status = 'published'
     and user_id = 'd2c00000-0000-4000-8000-000000000001'
     and id::text like 'd2c1%'),
  'votes do not change profile-card membership or ordering'
);

select is( -- 5
  (select payload from d2c_before where boundary = 'annotations'),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
   from (
     select * from public.annotations
     where user_id = 'd2c00000-0000-4000-8000-000000000001'
       and (id::text like 'd2c1%' or commentary_text = 'D2c worker candidate')
   ) as rows),
  'voting changes no annotation publication, visibility, removal, route, or timestamp field'
);

select results_eq( -- 6
  $$select id, status from public.annotations
    where id::text like 'd2c1%' order by id$$,
  $$values
      ('d2c10000-0000-4000-8000-000000000001'::uuid, 'published'::text),
      ('d2c10000-0000-4000-8000-000000000002'::uuid, 'published'::text),
      ('d2c10000-0000-4000-8000-000000000003'::uuid, 'removed'::text)$$,
  'published and removed visibility states remain exact'
);

select is( -- 7
  (select payload from d2c_before where boundary = 'comments'),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
   from (select * from public.annotation_comments where id::text like 'd2c6%') as rows),
  'voting changes no comment content, status, author, or order field'
);

select is( -- 8
  (select payload from d2c_before where boundary = 'follows'),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.follower_id, rows.followed_id)
   from (select * from public.profile_follows
         where follower_id = 'd2c00000-0000-4000-8000-000000000004') as rows),
  'voting changes no private follow edge or timestamp'
);

select is( -- 9
  (select payload from d2c_before where boundary = 'claims'),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
   from (select * from public.claims where id::text like 'd2c4%') as rows),
  'voting changes no claim status or confidential claim field'
);

select is( -- 10
  (select payload from d2c_before where boundary = 'media'),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.id)
   from (
     select media.* from public.annotation_media as media
     join public.annotations on annotations.id = media.annotation_id
     where media.id::text like 'd2c5%' or annotations.commentary_text = 'D2c worker candidate'
   ) as rows),
  'voting changes no removed-media or active media-lifecycle field'
);

select is( -- 11
  (select payload from d2c_before where boundary = 'worker_candidates'),
  (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows) order by rows.media_id), '[]'::jsonb)
   from (
     select candidates.*
     from private.list_annotation_media_dispatch_candidates(500) as candidates
     join public.annotation_media as media on media.id = candidates.media_id
     join public.annotations on annotations.id = media.annotation_id
     where annotations.commentary_text = 'D2c worker candidate'
   ) as rows),
  'voting changes neither worker-candidate membership nor queue metadata'
);

select results_eq( -- 12
  $$select annotation_id, upvote_count, downvote_count
    from public.get_public_annotation_vote_totals(array[
      'd2c10000-0000-4000-8000-000000000001'::uuid,
      'd2c10000-0000-4000-8000-000000000002'::uuid,
      'd2c10000-0000-4000-8000-000000000003'::uuid
    ])$$,
  $$values
      ('d2c10000-0000-4000-8000-000000000001'::uuid, 1::bigint, 0::bigint),
      ('d2c10000-0000-4000-8000-000000000002'::uuid, 0::bigint, 0::bigint)$$,
  'the vote affects only its published annotation aggregate and omits removed content'
);

select is( -- 13
  (select pg_catalog.count(*) from public.annotation_votes
   where annotation_id::text like 'd2c1%'),
  1::bigint,
  'one vote mutation creates exactly one private vote row'
);

select ok( -- 14
  (select pg_catalog.pg_get_functiondef(oid)
   from pg_catalog.pg_proc
   where oid = 'public.mutate_annotation_vote(uuid,uuid,smallint)'::regprocedure)
    !~ 'annotation_comments|profile_follows|public[.]claims|annotation_media|annotation_transcripts',
  'the trusted vote mutation has no social, claim, removal, or media write path'
);

select ok( -- 15
  (select pg_catalog.pg_get_functiondef(oid)
   from pg_catalog.pg_proc
   where oid = 'private.list_annotation_media_dispatch_candidates(integer)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits',
  'worker dispatch selection has no vote or limiter dependency'
);

select ok( -- 16
  not exists (
    select 1
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname in ('public', 'private')
      and pg_proc.proname in (
        'publish_article_annotation', 'publish_article_annotation_with_audio',
        'publish_youtube_annotation', 'publish_audio_clip_annotation',
        'finalize_annotation_media_ready', 'claim_annotation_media_cleanup_v2',
        'moderate_media_only_withdrawal',
        'moderate_annotation_hide', 'moderate_annotation_unhide',
        'get_public_annotation_comment_counts', 'get_profile_social_counts'
      )
      and pg_catalog.pg_get_functiondef(pg_proc.oid)
        ~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits'
  ),
  'publication, removal, media, comments, and follows remain structurally vote-independent'
);

select * from finish();

rollback;
