begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- 1-8: contract, grants, and fail-closed search_path.
select has_table( -- 1
  'private', 'moderation_audit',
  'the append-only F4 moderation audit table exists'
);

select ok( -- 2
  (select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'private.moderation_audit'::regclass),
  'moderation audit has RLS forced on'
);

select ok( -- 3
  not pg_catalog.has_table_privilege('anon', 'private.moderation_audit', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'private.moderation_audit', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('annotated_media_worker', 'private.moderation_audit', 'select,insert,update,delete'),
  'clients and the media worker have no direct moderation audit privileges'
);

select has_function( -- 4
  'private', 'moderate_media_only_withdrawal',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'the service-only private media-only withdrawal RPC exists'
);

select has_function( -- 5
  'public', 'moderate_media_only_withdrawal',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'the trusted-server public wrapper exists'
);

select has_column( -- 6
  'public', 'annotation_transcripts', 'content_cleared_at',
  'transcripts record content-clear timestamps instead of relying on row deletion'
);

select ok( -- 7
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'moderate_media_only_withdrawal'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'moderate_media_only_withdrawal'
  ),
  'media-only withdrawal functions are security definers with empty search paths'
);

select ok( -- 8
  not pg_catalog.has_function_privilege(
    'public', 'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'private.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'private.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)', 'execute'
  ),
  'only service_role may execute media-only withdrawal; worker and clients cannot'
);

select ok( -- 9
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)'::regprocedure
    ),
    'transcript_text'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)'::regprocedure
    ),
    'email'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)'::regprocedure
    ),
    'storage_path'
  ) = 0
  and not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'private.moderation_audit'::regclass
      and not attisdropped
      and attnum > 0
      and attname ~ 'email|transcript|path|storage'
  ),
  'withdrawal results and audit storage omit transcript text, emails, and Storage paths'
);

select ok( -- 10
  (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.moderate_media_only_withdrawal(uuid,uuid,uuid,text,uuid)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits',
  'media-only withdrawal does not read or write vote state'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('f4000000-0000-4000-8000-000000000001', '{"full_name":"F4 Creator"}'::jsonb),
  ('f4000000-0000-4000-8000-000000000002', '{"full_name":"F4 Operator"}'::jsonb),
  ('f4000000-0000-4000-8000-000000000003', '{"full_name":"F4 Voter"}'::jsonb),
  ('f4000000-0000-4000-8000-000000000004', '{"full_name":"F4 Commenter"}'::jsonb);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select lives_ok( -- 11
  $$
    select public.publish_article_annotation(
      'https://example.test/f4/article',
      'https://example.test/f4/article',
      'F4 Article Regression',
      'Article Author',
      'Article Publisher',
      'The F4 selected article passage.',
      null,
      null,
      'F4 article commentary remains immediately publishable'
    )
  $$,
  'article publication remains immediate through the validated RPC'
);
reset role;

set local role authenticated;
select throws_ok( -- 12
  $$
    select * from public.moderate_media_only_withdrawal(
      'f4000000-0000-4000-8000-000000000002',
      'f4100000-0000-4000-8000-000000000001',
      'f4300000-0000-4000-8000-000000000001',
      'copyright',
      null
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot execute media-only withdrawal'
);
reset role;

set local role anon;
select throws_ok( -- 13
  $$
    select * from public.moderate_media_only_withdrawal(
      'f4000000-0000-4000-8000-000000000002',
      'f4100000-0000-4000-8000-000000000001',
      'f4300000-0000-4000-8000-000000000001',
      'copyright',
      null
    )
  $$,
  '42501',
  null,
  'anonymous clients cannot execute media-only withdrawal'
);
reset role;

insert into public.sources (
  id, normalized_url, canonical_url, source_type, title, author, publisher, metadata
) values (
  'f4200000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=F4Hosted001',
  'https://www.youtube.com/watch?v=F4Hosted001',
  'youtube',
  'F4 hosted source',
  'F4 Author',
  'YouTube',
  '{"video_id":"F4Hosted001"}'::jsonb
);

insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values (
  'f4100000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'video_clip',
  'F4 ready hosted commentary',
  'draft',
  null
);

insert into public.annotation_targets (
  annotation_id, target_type, start_ms, end_ms
) values (
  'f4100000-0000-4000-8000-000000000001', 'time_range', 1000, 10000
);

insert into public.annotation_media (
  id,
  annotation_id,
  media_type,
  processing_status,
  processed_storage_path,
  processed_mime_type,
  duration_ms,
  width,
  height,
  byte_size,
  checksum_sha256,
  processed_at,
  raw_deleted_at
) values (
  'f4300000-0000-4000-8000-000000000001',
  'f4100000-0000-4000-8000-000000000001',
  'video',
  'ready',
  'f4000000-0000-4000-8000-000000000001/f4100000-0000-4000-8000-000000000001/f4300000-0000-4000-8000-000000000001/excerpt.mp4',
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
  annotation_id, transcript_text, language, segments, provider, model, provider_metadata
) values (
  'f4100000-0000-4000-8000-000000000001',
  'Only this nine-second F4 excerpt that must be purged.',
  'en',
  '[{"start_ms":0,"end_ms":9000,"text":"Only this nine-second F4 excerpt that must be purged."}]'::jsonb,
  'test-provider',
  'test-model',
  '{"confidential":"whisper-text-must-not-remain"}'::jsonb
);

update public.annotations
set status = 'published', published_at = pg_catalog.now()
where id = 'f4100000-0000-4000-8000-000000000001';

insert into public.claims (
  id, annotation_id, claimant_name, claimant_email,
  relationship_to_content, reason, details, status
) values (
  'f4400000-0000-4000-8000-000000000001',
  'f4100000-0000-4000-8000-000000000001',
  'F4 Claimant',
  'f4-claimant@example.test',
  'rights holder',
  'The excerpt is copyrighted.',
  'Private claimant details must never appear in audit output.',
  'submitted'
);

insert into public.annotation_votes (
  annotation_id, user_id, value
) values (
  'f4100000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000003',
  1
);

insert into public.annotation_comments (
  annotation_id, user_id, body, status
) values (
  'f4100000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000004',
  'F4 public comment must remain after media-only withdrawal',
  'public'
);

set local role service_role;
select is( -- 14
  (
    select delivery.processed_storage_path
    from public.get_annotation_media_delivery(
      'f4100000-0000-4000-8000-000000000001'
    ) as delivery
  ),
  'f4000000-0000-4000-8000-000000000001/f4100000-0000-4000-8000-000000000001/f4300000-0000-4000-8000-000000000001/excerpt.mp4',
  'service delivery signs the ready derivative before media-only withdrawal'
);
reset role;

set local role anon;
select is( -- 15
  (
    select media_state.availability
    from public.get_public_annotation_media_state(
      'f4100000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'ready',
  'the public page identifies ready media before withdrawal'
);
select is( -- 16
  (
    select transcript.transcript_text
    from public.get_public_annotation_transcript(
      'f4100000-0000-4000-8000-000000000001'
    ) as transcript
  ),
  'Only this nine-second F4 excerpt that must be purged.',
  'the public transcript is available before withdrawal'
);
reset role;

create temporary table f4_withdrawal as
select * from private.moderate_media_only_withdrawal(
  'f4000000-0000-4000-8000-000000000002',
  'f4100000-0000-4000-8000-000000000001',
  'f4300000-0000-4000-8000-000000000001',
  'copyright',
  'f4400000-0000-4000-8000-000000000001'
);

select ok( -- 17
  (
    select result_code = 'withdrawn'
      and annotation_status = 'published'
      and processing_status = 'removed'
      and transcript_content_cleared
      and claim_id = 'f4400000-0000-4000-8000-000000000001'
      and removed_at is not null
      and audit_id is not null
    from f4_withdrawal
  ),
  'media-only withdrawal keeps the annotation published and marks media removed'
);

select ok( -- 18
  (
    select annotations.status = 'published'
      and media.processing_status = 'removed'
      and media.removed_at is not null
      and media.removal_claim_id = 'f4400000-0000-4000-8000-000000000001'
      and media.processed_storage_path is not null
      and media.duration_ms = 9000
      and media.width = 426
      and media.height = 240
      and media.checksum_sha256 = pg_catalog.repeat('a', 64)
    from public.annotations
    join public.annotation_media as media on media.annotation_id = annotations.id
    where annotations.id = 'f4100000-0000-4000-8000-000000000001'
  ),
  'withdrawal retains processed-path cleanup linkage and audit-safe media metadata'
);

select ok( -- 19
  (
    select transcript.content_cleared_at is not null
      and transcript.transcript_text is null
      and transcript.segments is null
      and transcript.provider_metadata = '{}'::jsonb
      and transcript.language = 'en'
      and transcript.provider = 'test-provider'
      and transcript.model = 'test-model'
    from public.annotation_transcripts as transcript
    where transcript.annotation_id = 'f4100000-0000-4000-8000-000000000001'
  ),
  'transcript excerpt text and segments are purged while audit metadata remains'
);

set local role service_role;
select is( -- 20
  (
    select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      'f4100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'signing fails closed immediately after media-only withdrawal commits'
);
reset role;

set local role anon;
select ok( -- 21
  (
    select media_state.availability = 'removed'
      and media_state.mime_type is null
      and media_state.duration_ms is null
    from public.get_public_annotation_media_state(
      'f4100000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'the published page uses the removed-media presentation after withdrawal'
);
select is( -- 22
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'f4100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'public transcript projection is suppressed after content clear'
);
reset role;

select is( -- 23
  (
    select pg_catalog.count(*)
    from private.moderate_media_only_withdrawal(
      'f4000000-0000-4000-8000-000000000002',
      'f4100000-0000-4000-8000-000000000001',
      'f4300000-0000-4000-8000-000000000001',
      'copyright',
      'f4400000-0000-4000-8000-000000000001'
    ) as duplicate
    where duplicate.result_code = 'already_withdrawn'
      and duplicate.audit_id = (select audit_id from f4_withdrawal)
  ),
  1::bigint,
  'a duplicate media-only call is idempotent and does not write a second audit row'
);

select is( -- 24
  (select pg_catalog.count(*) from private.moderation_audit
    where annotation_id = 'f4100000-0000-4000-8000-000000000001'),
  1::bigint,
  'exactly one append-only audit row is recorded for the withdrawal'
);

select ok( -- 25
  (
    select audit.actor_id = 'f4000000-0000-4000-8000-000000000002'
      and audit.action = 'media_only_withdrawal'
      and audit.reason_code = 'copyright'
      and audit.claim_id = 'f4400000-0000-4000-8000-000000000001'
      and audit.result_code = 'withdrawn'
      and pg_catalog.row_to_json(audit)::text !~ 'f4-claimant@example.test'
      and pg_catalog.row_to_json(audit)::text !~ 'Private claimant details'
      and pg_catalog.row_to_json(audit)::text !~ 'nine-second F4 excerpt'
    from private.moderation_audit as audit
    where audit.id = (select audit_id from f4_withdrawal)
  ),
  'audit stores allow-listed ids and reason codes without claimant or transcript data'
);

select is( -- 26
  (
    select value from public.annotation_votes
    where annotation_id = 'f4100000-0000-4000-8000-000000000001'
      and user_id = 'f4000000-0000-4000-8000-000000000003'
  ),
  1::smallint,
  'existing votes are unused and unchanged by media-only withdrawal'
);

select is( -- 27
  (
    select body from public.annotation_comments
    where annotation_id = 'f4100000-0000-4000-8000-000000000001'
      and user_id = 'f4000000-0000-4000-8000-000000000004'
  ),
  'F4 public comment must remain after media-only withdrawal',
  'comments remain after media-only withdrawal'
);

select is( -- 28
  (select status from public.claims where id = 'f4400000-0000-4000-8000-000000000001'),
  'submitted',
  'claims are not auto-resolved or auto-taken-down by media-only withdrawal'
);

select is( -- 29
  (
    select reconciliation_action
    from private.list_annotation_media_reconciliation_candidates(100)
    where media_id = 'f4300000-0000-4000-8000-000000000001'
  ),
  'removed_cleanup',
  'withdrawn media with a remaining processed path is immediately cleanup-eligible'
);

create temporary table f4_cleanup as
select claimed.*
from private.claim_annotation_media_cleanup_v2(
  'f4300000-0000-4000-8000-000000000001'
) as claimed;

select lives_ok( -- 30
  $$
    select private.confirm_annotation_media_cleanup(
      media_id, raw_storage_path, processed_storage_path, observed_updated_at
    ) from f4_cleanup
  $$,
  'cleanup confirmation after F4 withdrawal succeeds'
);

select ok( -- 31
  (
    select media.processing_status = 'removed'
      and media.processed_storage_path is null
      and media.duration_ms = 9000
      and media.checksum_sha256 = pg_catalog.repeat('a', 64)
      and transcript.content_cleared_at is not null
      and transcript.transcript_text is null
      and transcript.provider = 'test-provider'
    from public.annotation_media as media
    join public.annotation_transcripts as transcript
      on transcript.annotation_id = media.annotation_id
    where media.id = 'f4300000-0000-4000-8000-000000000001'
  ),
  'cleanup confirmation clears Storage references without deleting transcript metadata'
);

select throws_ok( -- 32
  $$
    select * from private.moderate_media_only_withdrawal(
      'f4000000-0000-4000-8000-000000000002',
      (select id from public.annotations
        where commentary_text = 'F4 article commentary remains immediately publishable'),
      'f4300000-0000-4000-8000-000000000001',
      'copyright',
      null
    )
  $$,
  '55000',
  'Media-only withdrawal is not available.',
  'article annotations without matching hosted media cannot be media-withdrawn'
);

select throws_ok( -- 33
  $$
    select * from private.moderate_media_only_withdrawal(
      'f4000000-0000-4000-8000-000000000002',
      'f4100000-0000-4000-8000-000000000001',
      'f4300000-0000-4000-8000-000000000001',
      'vote_score',
      null
    )
  $$,
  '22023',
  'The moderation request is invalid.',
  'vote-derived or unknown reason codes cannot authorize media-only withdrawal'
);

select * from finish();
rollback;
