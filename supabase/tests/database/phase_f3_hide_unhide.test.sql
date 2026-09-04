begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- 1-12: contract, grants, audit extension, vote isolation, fail-closed search_path.
select has_function( -- 1
  'private', 'moderate_annotation_hide',
  array['uuid', 'uuid', 'text', 'uuid'],
  'the service-only private hide RPC exists'
);

select has_function( -- 2
  'public', 'moderate_annotation_hide',
  array['uuid', 'uuid', 'text', 'uuid'],
  'the trusted-server public hide wrapper exists'
);

select has_function( -- 3
  'private', 'moderate_annotation_unhide',
  array['uuid', 'uuid', 'text', 'uuid'],
  'the service-only private unhide RPC exists'
);

select has_function( -- 4
  'public', 'moderate_annotation_unhide',
  array['uuid', 'uuid', 'text', 'uuid'],
  'the trusted-server public unhide wrapper exists'
);

select ok( -- 5
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'moderate_annotation_hide'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'moderate_annotation_unhide'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'moderate_annotation_unhide'
  ),
  'hide and unhide functions are security definers with empty search paths'
);

select ok( -- 6
  not pg_catalog.has_function_privilege(
    'public', 'public.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'public.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'private.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.moderate_annotation_unhide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'public.moderate_annotation_unhide(uuid,uuid,text,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.moderate_annotation_unhide(uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.moderate_annotation_hide(uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.moderate_annotation_unhide(uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.moderate_annotation_unhide(uuid,uuid,text,uuid)', 'execute'
  ),
  'only service_role may execute hide/unhide; worker and clients cannot'
);

select ok( -- 7
  (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_action_check'
    ) as constraint_def)
    ~ 'annotation_hide'
  and (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_action_check'
    ) as constraint_def)
    ~ 'annotation_unhide'
  and (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_reason_code_check'
    ) as constraint_def)
    ~ 'commentary'
  and (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_result_code_check'
    ) as constraint_def)
    ~ 'already_hidden',
  'moderation audit admits hide/unhide actions without a second audit table'
);

select ok( -- 8
  (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.moderate_annotation_hide(uuid,uuid,text,uuid)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits'
  and (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.moderate_annotation_unhide(uuid,uuid,text,uuid)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits',
  'hide and unhide do not read or write vote state'
);

select ok( -- 9
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_hide(uuid,uuid,text,uuid)'::regprocedure
    ),
    'transcript_text'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_unhide(uuid,uuid,text,uuid)'::regprocedure
    ),
    'email'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_unhide(uuid,uuid,text,uuid)'::regprocedure
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
  'hide/unhide results and audit storage omit transcript text, emails, and Storage paths'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('f3000000-0000-4000-8000-000000000001', '{"full_name":"F3 Creator"}'::jsonb),
  ('f3000000-0000-4000-8000-000000000002', '{"full_name":"F3 Operator"}'::jsonb),
  ('f3000000-0000-4000-8000-000000000003', '{"full_name":"F3 Voter"}'::jsonb),
  ('f3000000-0000-4000-8000-000000000004', '{"full_name":"F3 Commenter"}'::jsonb);

insert into public.sources (
  id, normalized_url, canonical_url, source_type, title, author, publisher, metadata
) values
  (
    'f3200000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=F3Hosted001',
    'https://www.youtube.com/watch?v=F3Hosted001',
    'youtube',
    'F3 hosted source',
    'F3 Author',
    'YouTube',
    '{"video_id":"F3Hosted001"}'::jsonb
  ),
  (
    'f3200000-0000-4000-8000-000000000002',
    'https://example.test/f3/article',
    'https://example.test/f3/article',
    'article',
    'F3 article source',
    'Article Author',
    'Article Publisher',
    '{}'::jsonb
  );

insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values
  (
    'f3100000-0000-4000-8000-000000000001',
    'f3200000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001',
    'video_clip',
    'F3 ready hosted commentary',
    'draft',
    null
  ),
  (
    'f3100000-0000-4000-8000-000000000002',
    'f3200000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000001',
    'article_text',
    'F3 article commentary remains immediately publishable',
    'published',
    pg_catalog.now()
  ),
  (
    'f3100000-0000-4000-8000-000000000003',
    'f3200000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000001',
    'article_text',
    'F3 draft must not hide',
    'draft',
    null
  ),
  (
    'f3100000-0000-4000-8000-000000000004',
    'f3200000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000001',
    'article_text',
    'F3 already-removed annotation is not unhideable here',
    'published',
    pg_catalog.now()
  );

insert into public.annotation_targets (
  annotation_id, target_type, selected_text, start_ms, end_ms
) values
  ('f3100000-0000-4000-8000-000000000001', 'time_range', null, 1000, 10000),
  ('f3100000-0000-4000-8000-000000000002', 'text', 'The F3 selected article passage.', null, null);

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
  'f3300000-0000-4000-8000-000000000001',
  'f3100000-0000-4000-8000-000000000001',
  'video',
  'ready',
  'f3000000-0000-4000-8000-000000000001/f3100000-0000-4000-8000-000000000001/f3300000-0000-4000-8000-000000000001/excerpt.mp4',
  'video/mp4',
  9000,
  426,
  240,
  400000,
  pg_catalog.repeat('b', 64),
  pg_catalog.now(),
  pg_catalog.now()
);

insert into public.annotation_transcripts (
  annotation_id, transcript_text, language, segments, provider, model, provider_metadata
) values (
  'f3100000-0000-4000-8000-000000000001',
  'Only this nine-second F3 excerpt that must stay until F4 withdrawal.',
  'en',
  '[{"start_ms":0,"end_ms":9000,"text":"Only this nine-second F3 excerpt that must stay until F4 withdrawal."}]'::jsonb,
  'test-provider',
  'test-model',
  '{}'::jsonb
);

update public.annotations
set status = 'published', published_at = pg_catalog.now()
where id = 'f3100000-0000-4000-8000-000000000001';

update public.annotations
set status = 'removed'
where id = 'f3100000-0000-4000-8000-000000000004';

insert into public.claims (
  id, annotation_id, claimant_name, claimant_email,
  relationship_to_content, reason, details, status
) values
  (
    'f3400000-0000-4000-8000-000000000001',
    'f3100000-0000-4000-8000-000000000001',
    'F3 Claimant Hosted',
    'f3-claimant-hosted@example.test',
    'rights holder',
    'The excerpt is copyrighted.',
    'Private claimant details must never appear in audit output.',
    'submitted'
  ),
  (
    'f3400000-0000-4000-8000-000000000002',
    'f3100000-0000-4000-8000-000000000002',
    'F3 Claimant Article',
    'f3-claimant-article@example.test',
    'rights holder',
    'Commentary concern.',
    'Private article claimant details.',
    'submitted'
  );

insert into public.annotation_votes (
  annotation_id, user_id, value
) values
  (
    'f3100000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000003',
    1
  ),
  (
    'f3100000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000003',
    -1
  );

insert into public.annotation_comments (
  annotation_id, user_id, body, status
) values
  (
    'f3100000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000004',
    'F3 hosted comment follows hide visibility',
    'public'
  ),
  (
    'f3100000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000004',
    'F3 article comment follows hide visibility',
    'public'
  );

set local role authenticated;
select throws_ok( -- 10
  $$
    select * from public.moderate_annotation_hide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000002',
      'operator_request',
      null
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot execute hide'
);
reset role;

set local role anon;
select throws_ok( -- 11
  $$
    select * from public.moderate_annotation_unhide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000002',
      'operator_request',
      null
    )
  $$,
  '42501',
  null,
  'anonymous clients cannot execute unhide'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select throws_ok( -- 12
  $$
    update public.annotations
    set status = 'hidden'
    where id = 'f3100000-0000-4000-8000-000000000002'
  $$,
  '42501',
  null,
  'owners cannot hide their own published annotations through table update'
);
reset role;

-- Article hide/unhide and public fail-closed.
create temporary table f3_article_hide as
select * from private.moderate_annotation_hide(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000002',
  'commentary',
  'f3400000-0000-4000-8000-000000000002'
);

select ok( -- 13
  (
    select result_code = 'hidden'
      and annotation_status = 'hidden'
      and previous_status = 'published'
      and reason_code = 'commentary'
      and claim_id = 'f3400000-0000-4000-8000-000000000002'
      and media_id is null
      and audit_id is not null
    from f3_article_hide
  ),
  'hide moves a published article to hidden and writes an audit row'
);

select is( -- 14
  (select annotations.status from public.annotations
    where annotations.id = 'f3100000-0000-4000-8000-000000000002'),
  'hidden',
  'the article row is hidden after the hide RPC'
);

set local role anon;
select is( -- 15
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_uuid(
      'f3100000-0000-4000-8000-000000000002'
    )
  ),
  0::bigint,
  'hidden articles do not resolve through UUID compatibility'
);
select is( -- 16
  (
    select pg_catalog.count(*)
    from public.annotations
    where id = 'f3100000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'anonymous table reads omit hidden annotations'
);
select is( -- 17
  (
    select pg_catalog.count(*)
    from public.annotation_comments
    where annotation_id = 'f3100000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'hidden annotation comments are not publicly readable'
);
select is( -- 18
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_comment_counts(
      array['f3100000-0000-4000-8000-000000000002'::uuid]
    )
  ),
  0::bigint,
  'comment counts omit hidden annotations'
);
select is( -- 19
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_vote_totals(
      array['f3100000-0000-4000-8000-000000000002'::uuid]
    )
  ),
  0::bigint,
  'vote totals omit hidden annotations'
);
reset role;

select is( -- 20
  (
    select pg_catalog.count(*)
    from private.moderate_annotation_hide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000002',
      'commentary',
      'f3400000-0000-4000-8000-000000000002'
    ) as duplicate
    where duplicate.result_code = 'already_hidden'
      and duplicate.audit_id = (select audit_id from f3_article_hide)
  ),
  1::bigint,
  'a duplicate hide is idempotent and does not write a second audit row'
);

create temporary table f3_article_unhide as
select * from private.moderate_annotation_unhide(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000002',
  'operator_request',
  null
);

select ok( -- 21
  (
    select result_code = 'unhidden'
      and annotation_status = 'published'
      and previous_status = 'hidden'
      and transcript_content_restored = false
      and audit_id is not null
      and audit_id is distinct from (select audit_id from f3_article_hide)
    from f3_article_unhide
  ),
  'unhide writes a new audit entry and returns the annotation to published'
);

set local role anon;
select is( -- 22
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_uuid(
      'f3100000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'unhidden articles resolve through UUID compatibility again'
);
select is( -- 23
  (
    select pg_catalog.count(*)
    from public.annotation_comments
    where annotation_id = 'f3100000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'comments follow annotation visibility and return after unhide'
);
reset role;

select is( -- 24
  (
    select pg_catalog.count(*)
    from private.moderate_annotation_unhide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000002',
      'operator_request',
      null
    ) as duplicate
    where duplicate.result_code = 'already_published'
      and duplicate.audit_id = (select audit_id from f3_article_unhide)
      and not duplicate.transcript_content_restored
  ),
  1::bigint,
  'a duplicate unhide is idempotent and does not write a second audit row'
);

select is( -- 25
  (select pg_catalog.count(*) from private.moderation_audit
    where annotation_id = 'f3100000-0000-4000-8000-000000000002'),
  2::bigint,
  'exactly one hide audit and one unhide audit exist for the article'
);

select is( -- 26
  (select value from public.annotation_votes
    where annotation_id = 'f3100000-0000-4000-8000-000000000002'
      and user_id = 'f3000000-0000-4000-8000-000000000003'),
  (-1)::smallint,
  'existing votes are unused and unchanged by hide/unhide'
);

select is( -- 27
  (select status from public.claims where id = 'f3400000-0000-4000-8000-000000000002'),
  'submitted',
  'claims are not auto-resolved by hide or unhide'
);

-- Hosted hide keeps ready media and transcript; public surfaces fail closed.
create temporary table f3_hosted_hide as
select * from private.moderate_annotation_hide(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000001',
  'excerpt_claim',
  'f3400000-0000-4000-8000-000000000001'
);

select ok( -- 28
  (
    select hide.result_code = 'hidden'
      and hide.annotation_status = 'hidden'
      and hide.processing_status = 'ready'
      and hide.media_id = 'f3300000-0000-4000-8000-000000000001'
      and media.processing_status = 'ready'
      and media.removed_at is null
      and transcript.transcript_text = 'Only this nine-second F3 excerpt that must stay until F4 withdrawal.'
    from f3_hosted_hide as hide
    join public.annotation_media as media on media.id = hide.media_id
    join public.annotation_transcripts as transcript
      on transcript.annotation_id = hide.annotation_id
  ),
  'hide does not withdraw media or clear transcript content'
);

set local role anon;
select is( -- 29
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media_state(
      'f3100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'hidden hosted annotations have no public media projection'
);
select is( -- 30
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'f3100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'hidden hosted annotations have no public transcript'
);
reset role;

set local role service_role;
select is( -- 31
  (
    select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      'f3100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'signing fails closed for a hidden hosted annotation'
);
reset role;

create temporary table f3_hosted_unhide as
select * from private.moderate_annotation_unhide(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000001',
  'operator_request',
  null
);

select ok( -- 32
  (
    select unhide.result_code = 'unhidden'
      and unhide.annotation_status = 'published'
      and unhide.processing_status = 'ready'
      and not unhide.transcript_content_restored
      and transcript.transcript_text = 'Only this nine-second F3 excerpt that must stay until F4 withdrawal.'
    from f3_hosted_unhide as unhide
    join public.annotation_transcripts as transcript
      on transcript.annotation_id = unhide.annotation_id
  ),
  'unhide of ready hosted media returns the published page without rewriting the transcript'
);

set local role anon;
select is( -- 33
  (
    select media_state.availability
    from public.get_public_annotation_media_state(
      'f3100000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'ready',
  'unhidden ready media is publicly projectable again'
);
reset role;

-- F4-removed media stays removed across hide/unhide.
create temporary table f3_withdraw as
select * from private.moderate_media_only_withdrawal(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000001',
  'f3300000-0000-4000-8000-000000000001',
  'copyright',
  'f3400000-0000-4000-8000-000000000001'
);

create temporary table f3_hide_after_withdraw as
select * from private.moderate_annotation_hide(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000001',
  'copyright',
  'f3400000-0000-4000-8000-000000000001'
);

create temporary table f3_removed_unhide as
select * from private.moderate_annotation_unhide(
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000001',
  'operator_request',
  null
);

select ok( -- 34
  (
    select unhide.result_code = 'unhidden'
      and unhide.annotation_status = 'published'
      and unhide.processing_status = 'removed'
      and not unhide.transcript_content_restored
      and media.processing_status = 'removed'
      and media.removed_at is not null
      and transcript.transcript_text is null
      and transcript.content_cleared_at is not null
    from f3_removed_unhide as unhide
    join public.annotation_media as media on media.id = unhide.media_id
    join public.annotation_transcripts as transcript
      on transcript.annotation_id = unhide.annotation_id
  ),
  'unhide after media-only withdrawal leaves media removed and transcript content cleared'
);

set local role anon;
select ok( -- 35
  (
    select media_state.availability = 'removed'
      and media_state.mime_type is null
    from public.get_public_annotation_media_state(
      'f3100000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'unhidden F4-removed media uses the accepted unavailable-excerpt presentation'
);
select is( -- 36
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'f3100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'unhide does not restore a public transcript after F4 content-clear'
);
reset role;

select ok( -- 37
  (
    select audit.actor_id = 'f3000000-0000-4000-8000-000000000002'
      and audit.action = 'annotation_hide'
      and pg_catalog.row_to_json(audit)::text !~ 'f3-claimant-hosted@example.test'
      and pg_catalog.row_to_json(audit)::text !~ 'Private claimant details'
      and pg_catalog.row_to_json(audit)::text !~ 'nine-second F3 excerpt'
    from private.moderation_audit as audit
    where audit.annotation_id = 'f3100000-0000-4000-8000-000000000001'
      and audit.action = 'annotation_hide'
    order by audit.created_at
    limit 1
  ),
  'hide audit stores allow-listed ids and reason codes without claimant or transcript data'
);

-- Illegal transitions and vote-derived reasons.
select throws_ok( -- 38
  $$
    select * from private.moderate_annotation_hide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000003',
      'operator_request',
      null
    )
  $$,
  '55000',
  'Annotation hide is not available.',
  'draft annotations cannot be hidden'
);

select throws_ok( -- 39
  $$
    select * from private.moderate_annotation_hide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000004',
      'operator_request',
      null
    )
  $$,
  '55000',
  'Annotation hide is not available.',
  'removed annotations cannot be hidden in F3'
);

select throws_ok( -- 40
  $$
    select * from private.moderate_annotation_unhide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000004',
      'operator_request',
      null
    )
  $$,
  '55000',
  'Annotation unhide is not available.',
  'removed annotations cannot be unhidden'
);

select throws_ok( -- 41
  $$
    select * from private.moderate_annotation_hide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000002',
      'vote_score',
      null
    )
  $$,
  '22023',
  'The moderation request is invalid.',
  'vote-derived or unknown reason codes cannot authorize hide'
);

select throws_ok( -- 42
  $$
    select * from private.moderate_annotation_hide(
      'f3000000-0000-4000-8000-000000000002',
      'f3100000-0000-4000-8000-000000000001',
      'copyright',
      'f3400000-0000-4000-8000-000000000002'
    )
  $$,
  '55000',
  'Annotation hide is not available.',
  'a claim linked to a different annotation cannot authorize hide'
);

select * from finish();
rollback;
