begin;

create extension if not exists pgtap with schema extensions;

select plan(44);

-- 1-9: contract, grants, audit extension, vote isolation, fail-closed search_path.
select has_function( -- 1
  'private', 'moderate_annotation_remove',
  array['uuid', 'uuid', 'text', 'uuid', 'boolean'],
  'the service-only private remove RPC exists'
);

select has_function( -- 2
  'public', 'moderate_annotation_remove',
  array['uuid', 'uuid', 'text', 'uuid', 'boolean'],
  'the trusted-server public remove wrapper exists'
);

select ok( -- 3
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'moderate_annotation_remove'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'moderate_annotation_remove'
  ),
  'remove functions are security definers with empty search paths'
);

select ok( -- 4
  not pg_catalog.has_function_privilege(
    'public', 'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'private.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'private.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)', 'execute'
  ),
  'only service_role may execute remove; worker and clients cannot'
);

select ok( -- 5
  (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_action_check'
    ) as constraint_def)
    ~ 'annotation_remove'
  and (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_result_code_check'
    ) as constraint_def)
    ~ 'already_removed'
  and (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_action_check'
    ) as constraint_def)
    ~ 'annotation_hide',
  'moderation audit admits annotation_remove additively without replacing F3/F4 actions'
);

select ok( -- 6
  (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits',
  'remove does not read or write vote state'
);

select ok( -- 7
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)'::regprocedure
    ),
    'transcript_text'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)'::regprocedure
    ),
    'email'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)'::regprocedure
    ),
    'claimant'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)'::regprocedure
    ),
    'storage_path'
  ) = 0,
  'remove results omit transcript text, claimant fields, emails, and Storage paths'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('f5000000-0000-4000-8000-000000000001', '{"full_name":"F5 Creator"}'::jsonb),
  ('f5000000-0000-4000-8000-000000000002', '{"full_name":"F5 Operator"}'::jsonb),
  ('f5000000-0000-4000-8000-000000000003', '{"full_name":"F5 Voter"}'::jsonb),
  ('f5000000-0000-4000-8000-000000000004', '{"full_name":"F5 Commenter"}'::jsonb);

insert into public.sources (
  id, normalized_url, canonical_url, source_type, title, author, publisher, metadata
) values
  (
    'f5200000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=F5Hosted001',
    'https://www.youtube.com/watch?v=F5Hosted001',
    'youtube',
    'F5 hosted source',
    'F5 Author',
    'YouTube',
    '{"video_id":"F5Hosted001"}'::jsonb
  ),
  (
    'f5200000-0000-4000-8000-000000000002',
    'https://example.test/f5/article',
    'https://example.test/f5/article',
    'article',
    'F5 article source',
    'Article Author',
    'Article Publisher',
    '{}'::jsonb
  );

insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values
  (
    'f5100000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001',
    'video_clip',
    'F5 ready hosted commentary that must leave discovery',
    'draft',
    null
  ),
  (
    'f5100000-0000-4000-8000-000000000002',
    'f5200000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    'article_text',
    'F5 article published then removed without resolving its claim',
    'published',
    pg_catalog.now()
  ),
  (
    'f5100000-0000-4000-8000-000000000003',
    'f5200000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    'article_text',
    'F5 draft must not remove',
    'draft',
    null
  ),
  (
    'f5100000-0000-4000-8000-000000000004',
    'f5200000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    'article_text',
    'F5 article hide then remove',
    'published',
    pg_catalog.now()
  ),
  (
    'f5100000-0000-4000-8000-000000000005',
    'f5200000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001',
    'video_clip',
    'F5 hosted after media-only withdrawal then full remove',
    'draft',
    null
  ),
  (
    'f5100000-0000-4000-8000-000000000006',
    'f5200000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    'article_text',
    'F5 submitted claim cannot auto-resolve',
    'published',
    pg_catalog.now()
  );

insert into public.annotation_targets (
  annotation_id, target_type, selected_text, start_ms, end_ms
) values
  ('f5100000-0000-4000-8000-000000000001', 'time_range', null, 1000, 10000),
  ('f5100000-0000-4000-8000-000000000002', 'text', 'The F5 selected article passage.', null, null),
  ('f5100000-0000-4000-8000-000000000004', 'text', 'The F5 hide-then-remove passage.', null, null),
  ('f5100000-0000-4000-8000-000000000005', 'time_range', null, 1000, 9000),
  ('f5100000-0000-4000-8000-000000000006', 'text', 'The F5 submitted-claim passage.', null, null);

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
) values
  (
    'f5300000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000001',
    'video',
    'ready',
    'f5000000-0000-4000-8000-000000000001/f5100000-0000-4000-8000-000000000001/f5300000-0000-4000-8000-000000000001/excerpt.mp4',
    'video/mp4',
    9000,
    426,
    240,
    400000,
    pg_catalog.repeat('c', 64),
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    'f5300000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000005',
    'video',
    'ready',
    'f5000000-0000-4000-8000-000000000001/f5100000-0000-4000-8000-000000000005/f5300000-0000-4000-8000-000000000002/excerpt.mp4',
    'video/mp4',
    8000,
    426,
    240,
    350000,
    pg_catalog.repeat('d', 64),
    pg_catalog.now(),
    pg_catalog.now()
  );

insert into public.annotation_transcripts (
  annotation_id, transcript_text, language, segments, provider, model, provider_metadata
) values
  (
    'f5100000-0000-4000-8000-000000000001',
    'Only this nine-second F5 excerpt that must not stay public after remove.',
    'en',
    '[{"start_ms":0,"end_ms":9000,"text":"Only this nine-second F5 excerpt that must not stay public after remove."}]'::jsonb,
    'test-provider',
    'test-model',
    '{}'::jsonb
  ),
  (
    'f5100000-0000-4000-8000-000000000005',
    'F5 second excerpt cleared by F4 before full remove.',
    'en',
    '[{"start_ms":0,"end_ms":8000,"text":"F5 second excerpt cleared by F4 before full remove."}]'::jsonb,
    'test-provider',
    'test-model',
    '{}'::jsonb
  );

update public.annotations
set status = 'published', published_at = pg_catalog.now()
where id in (
  'f5100000-0000-4000-8000-000000000001',
  'f5100000-0000-4000-8000-000000000005'
);

insert into public.claims (
  id, annotation_id, claimant_name, claimant_email,
  relationship_to_content, reason, details, status
) values
  (
    'f5400000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000001',
    'F5 Claimant Hosted',
    'f5-claimant-hosted@example.test',
    'rights holder',
    'Commentary itself is the problem.',
    'Private claimant details must never appear in remove output.',
    'submitted'
  ),
  (
    'f5400000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000002',
    'F5 Claimant Article',
    'f5-claimant-article@example.test',
    'rights holder',
    'Commentary concern.',
    'Private article claimant details.',
    'submitted'
  ),
  (
    'f5400000-0000-4000-8000-000000000003',
    'f5100000-0000-4000-8000-000000000006',
    'F5 Claimant Submitted',
    'f5-claimant-submitted@example.test',
    'rights holder',
    'Must stay submitted when resolve is illegal.',
    'Private submitted claimant details.',
    'submitted'
  );

insert into public.annotation_votes (
  annotation_id, user_id, value
) values
  (
    'f5100000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000003',
    1
  ),
  (
    'f5100000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000003',
    -1
  );

insert into public.annotation_comments (
  annotation_id, user_id, body, status
) values
  (
    'f5100000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000004',
    'F5 hosted comment follows remove visibility',
    'public'
  ),
  (
    'f5100000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000004',
    'F5 article comment follows remove visibility',
    'public'
  );

set local role authenticated;
select throws_ok( -- 8
  $$
    select * from public.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000002',
      'operator_request',
      null,
      false
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot execute remove'
);
reset role;

set local role anon;
select throws_ok( -- 9
  $$
    select * from public.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000002',
      'operator_request',
      null,
      false
    )
  $$,
  '42501',
  null,
  'anonymous clients cannot execute remove'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f5000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select throws_ok( -- 10
  $$
    update public.annotations
    set status = 'removed'
    where id = 'f5100000-0000-4000-8000-000000000002'
  $$,
  '42501',
  null,
  'owners cannot remove their own published annotations through table update'
);
reset role;

-- Article published → removed without resolving the linked claim.
create temporary table f5_article_remove as
select * from private.moderate_annotation_remove(
  'f5000000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000002',
  'commentary',
  'f5400000-0000-4000-8000-000000000002',
  false
);

select ok( -- 11
  (
    select result_code = 'removed'
      and annotation_status = 'removed'
      and previous_status = 'published'
      and reason_code = 'commentary'
      and claim_id = 'f5400000-0000-4000-8000-000000000002'
      and media_id is null
      and audit_id is not null
      and transcript_content_cleared
      and claim_status = 'submitted'
      and not claim_resolved
    from f5_article_remove
  ),
  'remove moves a published article to removed, links the claim, and does not auto-resolve'
);

select is( -- 12
  (select annotations.status from public.annotations
    where annotations.id = 'f5100000-0000-4000-8000-000000000002'),
  'removed',
  'the article row is removed after the remove RPC'
);

set local role anon;
select is( -- 13
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_uuid(
      'f5100000-0000-4000-8000-000000000002'
    )
  ),
  0::bigint,
  'removed articles do not resolve through UUID compatibility'
);
select is( -- 14
  (
    select pg_catalog.count(*)
    from public.annotations
    where id = 'f5100000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'anonymous table reads omit removed annotations'
);
select is( -- 15
  (
    select pg_catalog.count(*)
    from public.annotation_comments
    where annotation_id = 'f5100000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'removed annotation comments are not publicly readable'
);
select is( -- 16
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_comment_counts(
      array['f5100000-0000-4000-8000-000000000002'::uuid]
    )
  ),
  0::bigint,
  'comment counts omit removed annotations'
);
select is( -- 17
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_vote_totals(
      array['f5100000-0000-4000-8000-000000000002'::uuid]
    )
  ),
  0::bigint,
  'vote totals omit removed annotations'
);
select throws_ok( -- 18
  $$
    insert into public.claims (
      annotation_id, claimant_name, claimant_email,
      relationship_to_content, reason
    ) values (
      'f5100000-0000-4000-8000-000000000002',
      'F5 Late Claimant',
      'f5-late@example.test',
      'rights holder',
      'Removed targets must be rejected.'
    )
  $$,
  '42501',
  null,
  'anonymous users cannot submit a claim against a removed annotation'
);
reset role;

select is( -- 19
  (
    select pg_catalog.count(*)
    from private.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000002',
      'commentary',
      'f5400000-0000-4000-8000-000000000002',
      true
    ) as duplicate
    where duplicate.result_code = 'already_removed'
      and duplicate.audit_id = (select audit_id from f5_article_remove)
      and not duplicate.claim_resolved
  ),
  1::bigint,
  'a duplicate remove is idempotent, does not write a second audit, and does not resolve a claim'
);

select is( -- 20
  (select pg_catalog.count(*) from private.moderation_audit
    where annotation_id = 'f5100000-0000-4000-8000-000000000002'),
  1::bigint,
  'exactly one remove audit exists for the article'
);

select is( -- 21
  (select value from public.annotation_votes
    where annotation_id = 'f5100000-0000-4000-8000-000000000002'
      and user_id = 'f5000000-0000-4000-8000-000000000003'),
  (-1)::smallint,
  'existing votes are unused and unchanged by remove'
);

select is( -- 22
  (select status from public.claims where id = 'f5400000-0000-4000-8000-000000000002'),
  'submitted',
  'claims are not auto-resolved by remove unless resolve_claim is a legal reviewing transition'
);

-- Hide then remove (from-state hidden).
create temporary table f5_hidden_then_remove as
select * from private.moderate_annotation_hide(
  'f5000000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000004',
  'commentary',
  null
);

create temporary table f5_remove_from_hidden as
select * from private.moderate_annotation_remove(
  'f5000000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000004',
  'operator_request',
  null,
  false
);

select ok( -- 23
  (
    select result_code = 'removed'
      and annotation_status = 'removed'
      and previous_status = 'hidden'
      and claim_id is null
      and not claim_resolved
    from f5_remove_from_hidden
  ),
  'remove accepts hidden as a from-state after F3 hide'
);

select throws_ok( -- 24
  $$
    select * from private.moderate_annotation_unhide(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000004',
      'operator_request',
      null
    )
  $$,
  '55000',
  'Annotation unhide is not available.',
  'removed annotations cannot be unhidden; F5 remove is final'
);

-- Hosted published ready → remove revokes media and optionally resolves a reviewing claim.
create temporary table f5_claim_reviewing as
select * from private.update_claim_review(
  'f5000000-0000-4000-8000-000000000002',
  'f5400000-0000-4000-8000-000000000001',
  'reviewing',
  null,
  false,
  false
);

create temporary table f5_hosted_remove as
select * from private.moderate_annotation_remove(
  'f5000000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000001',
  'commentary',
  'f5400000-0000-4000-8000-000000000001',
  true
);

select ok( -- 25
  (
    select remove.result_code = 'removed'
      and remove.annotation_status = 'removed'
      and remove.previous_status = 'published'
      and remove.processing_status = 'removed'
      and remove.media_id = 'f5300000-0000-4000-8000-000000000001'
      and remove.transcript_content_cleared
      and remove.claim_status = 'resolved'
      and remove.claim_resolved
      and media.processing_status = 'removed'
      and media.removed_at is not null
      and media.processed_storage_path is not null
      and media.removal_claim_id = 'f5400000-0000-4000-8000-000000000001'
      and transcript.transcript_text is null
      and transcript.content_cleared_at is not null
      and transcript.provider = 'test-provider'
    from f5_hosted_remove as remove
    join public.annotation_media as media on media.id = remove.media_id
    join public.annotation_transcripts as transcript
      on transcript.annotation_id = remove.annotation_id
  ),
  'remove revokes still-playable hosted media, clears transcript content, and resolves a reviewing claim via F2'
);

select is( -- 26
  (select status from public.claims where id = 'f5400000-0000-4000-8000-000000000001'),
  'resolved',
  'the linked reviewing claim is resolved in the same remove transaction'
);

set local role anon;
select is( -- 27
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media_state(
      'f5100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'removed hosted annotations have no public media projection'
);
select is( -- 28
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_transcript(
      'f5100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'removed hosted annotations have no public transcript'
);
select is( -- 29
  (
    select pg_catalog.count(*)
    from public.annotations
    where id = 'f5100000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'anonymous feed/profile table reads omit removed hosted annotations'
);
reset role;

set local role service_role;
select is( -- 30
  (
    select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      'f5100000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'signing fails closed for a removed hosted annotation'
);
reset role;

select is( -- 31
  (
    select reconciliation_action
    from private.list_annotation_media_reconciliation_candidates(100)
    where media_id = 'f5300000-0000-4000-8000-000000000001'
  ),
  'removed_cleanup',
  'F5-revoked media with a remaining processed path is immediately cleanup-eligible'
);

select ok( -- 32
  (
    select audit.actor_id = 'f5000000-0000-4000-8000-000000000002'
      and audit.action = 'annotation_remove'
      and pg_catalog.row_to_json(audit)::text !~ 'f5-claimant-hosted@example.test'
      and pg_catalog.row_to_json(audit)::text !~ 'Private claimant details'
      and pg_catalog.row_to_json(audit)::text !~ 'nine-second F5 excerpt'
    from private.moderation_audit as audit
    where audit.annotation_id = 'f5100000-0000-4000-8000-000000000001'
      and audit.action = 'annotation_remove'
  )
  and (
    select pg_catalog.count(*) = 2
      and bool_and(pg_catalog.row_to_json(audit)::text !~ 'f5-claimant-hosted@example.test')
    from private.moderation_audit as audit
    where audit.annotation_id = 'f5100000-0000-4000-8000-000000000001'
  ),
  'remove and F2 claim_review audits store allow-listed ids without claimant or transcript data'
);

select is( -- 33
  (select value from public.annotation_votes
    where annotation_id = 'f5100000-0000-4000-8000-000000000001'
      and user_id = 'f5000000-0000-4000-8000-000000000003'),
  1::smallint,
  'hosted votes remain unused and unchanged after full remove'
);

-- F4 media-only then F5 full remove: media stays removed, annotation leaves discovery.
create temporary table f5_withdraw as
select * from private.moderate_media_only_withdrawal(
  'f5000000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000005',
  'f5300000-0000-4000-8000-000000000002',
  'copyright',
  null
);

create temporary table f5_remove_after_f4 as
select * from private.moderate_annotation_remove(
  'f5000000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000005',
  'copyright',
  null,
  false
);

select ok( -- 34
  (
    select remove.result_code = 'removed'
      and remove.annotation_status = 'removed'
      and remove.previous_status = 'published'
      and remove.processing_status = 'removed'
      and remove.transcript_content_cleared
      and media.processing_status = 'removed'
      and media.removed_at is not null
      and transcript.transcript_text is null
    from f5_remove_after_f4 as remove
    join public.annotation_media as media on media.id = remove.media_id
    join public.annotation_transcripts as transcript
      on transcript.annotation_id = remove.annotation_id
  ),
  'full remove after F4 media-only withdrawal leaves media removed and does not restore transcript content'
);

set local role anon;
select is( -- 35
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media_state(
      'f5100000-0000-4000-8000-000000000005'
    )
  ),
  0::bigint,
  'F4 withdrawn then F5 removed hosted media is not a public removed-media page'
);
reset role;

-- Illegal transitions and fail-closed claim resolve.
select throws_ok( -- 36
  $$
    select * from private.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000003',
      'operator_request',
      null,
      false
    )
  $$,
  '55000',
  'Annotation remove is not available.',
  'draft annotations cannot be removed'
);

select throws_ok( -- 37
  $$
    select * from private.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000006',
      'commentary',
      'f5400000-0000-4000-8000-000000000002',
      false
    )
  $$,
  '55000',
  'Annotation remove is not available.',
  'a claim linked to a different annotation cannot authorize remove'
);

select throws_ok( -- 38
  $$
    select * from private.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000006',
      'vote_score',
      null,
      false
    )
  $$,
  '22023',
  'The moderation request is invalid.',
  'vote-derived or unknown reason codes cannot authorize remove'
);

select throws_ok( -- 39
  $$
    select * from private.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000006',
      'commentary',
      null,
      true
    )
  $$,
  '22023',
  'The moderation request is invalid.',
  'resolve_claim without a claim_id is rejected'
);

select throws_ok( -- 40
  $$
    select * from private.moderate_annotation_remove(
      'f5000000-0000-4000-8000-000000000002',
      'f5100000-0000-4000-8000-000000000006',
      'commentary',
      'f5400000-0000-4000-8000-000000000003',
      true
    )
  $$,
  '22023',
  'The moderation request is invalid.',
  'a submitted claim cannot skip F2 reviewing before resolve'
);

select is( -- 41
  (select annotations.status from public.annotations
    where annotations.id = 'f5100000-0000-4000-8000-000000000006'),
  'published',
  'illegal resolve_claim fails closed without removing the annotation'
);

select is( -- 42
  (select status from public.claims where id = 'f5400000-0000-4000-8000-000000000003'),
  'submitted',
  'illegal resolve_claim leaves the submitted claim unchanged'
);

select is( -- 43
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_proc.proname = 'moderate_annotation_remove'
      and pg_namespace.nspname in ('public', 'private')
  ),
  2::bigint,
  'remove exists only as the private implementation and public service wrapper'
);

select ok( -- 44
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.moderate_annotation_remove(uuid,uuid,text,uuid,boolean)'::regprocedure
    ),
    'update_claim_review'
  ) > 0,
  'remove reuses F2 update_claim_review rather than duplicating claim UPDATE logic'
);

select * from finish();
rollback;
