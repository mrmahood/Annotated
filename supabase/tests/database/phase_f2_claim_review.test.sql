begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- 1-12: contract, grants, PII-capable result shape, vote isolation of source.
select has_function( -- 1
  'private', 'list_claims_for_review',
  array['text', 'boolean', 'integer', 'timestamp with time zone', 'uuid'],
  'the service-only private claim list RPC exists'
);

select has_function( -- 2
  'public', 'list_claims_for_review',
  array['text', 'boolean', 'integer', 'timestamp with time zone', 'uuid'],
  'the trusted-server public list wrapper exists'
);

select has_function( -- 3
  'private', 'get_claim_for_review',
  array['uuid', 'boolean'],
  'the service-only private claim get RPC exists'
);

select has_function( -- 4
  'public', 'get_claim_for_review',
  array['uuid', 'boolean'],
  'the trusted-server public get wrapper exists'
);

select has_function( -- 5
  'private', 'update_claim_review',
  array['uuid', 'uuid', 'text', 'text', 'boolean', 'boolean'],
  'the service-only private claim update RPC exists'
);

select has_function( -- 6
  'public', 'update_claim_review',
  array['uuid', 'uuid', 'text', 'text', 'boolean', 'boolean'],
  'the trusted-server public update wrapper exists'
);

select has_column( -- 7
  'public', 'claims', 'operator_notes',
  'claims may store optional Matt-only operator notes'
);

select ok( -- 8
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'list_claims_for_review'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'get_claim_for_review'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'update_claim_review'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'update_claim_review'
  ),
  'claim review functions are security definers with empty search paths'
);

select ok( -- 9
  not pg_catalog.has_function_privilege(
    'public', 'public.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'public.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'private.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.get_claim_for_review(uuid,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.update_claim_review(uuid,uuid,text,text,boolean,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.update_claim_review(uuid,uuid,text,text,boolean,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'annotated_media_worker', 'public.update_claim_review(uuid,uuid,text,text,boolean,boolean)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.update_claim_review(uuid,uuid,text,text,boolean,boolean)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.get_claim_for_review(uuid,boolean)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.update_claim_review(uuid,uuid,text,text,boolean,boolean)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.update_claim_review(uuid,uuid,text,text,boolean,boolean)', 'execute'
  ),
  'only service_role may execute claim review RPCs; worker and clients cannot'
);

select ok( -- 10
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.claims', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.claims', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'delete')
  and not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'claims'
      and cmd in ('SELECT', 'UPDATE', 'DELETE')
  ),
  'anon and authenticated have no claims SELECT/UPDATE/DELETE grant or policy'
);

select ok( -- 11
  (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.list_claims_for_review(text,boolean,integer,timestamp with time zone,uuid)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits'
  and (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.get_claim_for_review(uuid,boolean)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits'
  and (select pg_catalog.pg_get_functiondef(oid)
    from pg_catalog.pg_proc
    where oid = 'private.update_claim_review(uuid,uuid,text,text,boolean,boolean)'::regprocedure)
    !~ 'annotation_votes|annotation_vote_pair_rate_limits|annotation_vote_user_rate_limits',
  'claim review RPCs do not read or write vote state'
);

select ok( -- 12
  (select consrc from (
      select pg_catalog.pg_get_constraintdef(oid) as consrc
      from pg_catalog.pg_constraint
      where conrelid = 'private.moderation_audit'::regclass
        and conname = 'moderation_audit_action_check'
    ) as constraint_def)
    ~ 'claim_review',
  'moderation audit admits claim_review actions without a second audit table'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('f2000000-0000-4000-8000-000000000001', '{"full_name":"F2 Creator"}'::jsonb),
  ('f2000000-0000-4000-8000-000000000002', '{"full_name":"F2 Operator"}'::jsonb),
  ('f2000000-0000-4000-8000-000000000003', '{"full_name":"F2 Voter"}'::jsonb);

insert into public.sources (
  id, normalized_url, canonical_url, source_type, title
) values (
  'f2200000-0000-4000-8000-000000000001',
  'https://example.test/f2/claim-review',
  'https://example.test/f2/claim-review',
  'article',
  'F2 claim review source'
);

insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status,
  published_at, created_at, updated_at
) values (
  'f2100000-0000-4000-8000-000000000001',
  'f2200000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'article_text',
  'F2 published annotation stays published during claim review',
  'published',
  '2026-09-04 02:00:00+00',
  '2026-09-04 02:00:00+00',
  '2026-09-04 02:00:00+00'
);

insert into public.claims (
  id, annotation_id, claimant_name, claimant_email,
  relationship_to_content, reason, details, status, created_at, updated_at
) values
  (
    'f2400000-0000-4000-8000-000000000001',
    'f2100000-0000-4000-8000-000000000001',
    'F2 Claimant A',
    'f2-claimant-a@example.test',
    'rights holder',
    'Please review excerpt A.',
    'Private details for claimant A must stay suppressed by default.',
    'submitted',
    '2026-09-04 02:01:00+00',
    '2026-09-04 02:01:00+00'
  ),
  (
    'f2400000-0000-4000-8000-000000000002',
    'f2100000-0000-4000-8000-000000000001',
    'F2 Claimant B',
    'f2-claimant-b@example.test',
    'rights holder',
    'Please review excerpt B.',
    'Private details for claimant B.',
    'submitted',
    '2026-09-04 02:02:00+00',
    '2026-09-04 02:02:00+00'
  ),
  (
    'f2400000-0000-4000-8000-000000000003',
    'f2100000-0000-4000-8000-000000000001',
    'F2 Claimant C',
    'f2-claimant-c@example.test',
    'rights holder',
    'Spam claim C.',
    'Private details for claimant C.',
    'submitted',
    '2026-09-04 02:03:00+00',
    '2026-09-04 02:03:00+00'
  ),
  (
    'f2400000-0000-4000-8000-000000000004',
    'f2100000-0000-4000-8000-000000000001',
    'F2 Claimant D',
    'f2-claimant-d@example.test',
    'rights holder',
    'Illegal transition claim D.',
    'Private details for claimant D.',
    'submitted',
    '2026-09-04 02:04:00+00',
    '2026-09-04 02:04:00+00'
  );

insert into public.annotation_votes (
  annotation_id, user_id, value
) values (
  'f2100000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  1
);

set local role authenticated;
select throws_ok( -- 13
  $$
    select * from public.list_claims_for_review(null, false, 50, null, null)
  $$,
  '42501',
  null,
  'authenticated clients cannot execute claim list'
);
reset role;

set local role anon;
select throws_ok( -- 14
  $$
    select * from public.get_claim_for_review(
      'f2400000-0000-4000-8000-000000000001',
      false
    )
  $$,
  '42501',
  null,
  'anonymous clients cannot execute claim get'
);
reset role;

set local role authenticated;
select throws_ok( -- 15
  $$
    select * from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000001',
      'reviewing',
      null,
      false,
      false
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot execute claim update'
);
reset role;

set local role anon;
select throws_ok( -- 16
  $$
    select * from public.claims
  $$,
  '42501',
  null,
  'anonymous clients cannot select claims'
);
reset role;

set local role authenticated;
select throws_ok( -- 17
  $$
    update public.claims
    set status = 'reviewing'
    where id = 'f2400000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated clients cannot update claims'
);
reset role;

set local role anon;
select throws_ok( -- 18
  $$
    insert into public.claims (
      annotation_id, claimant_name, claimant_email,
      relationship_to_content, reason, operator_notes
    ) values (
      'f2100000-0000-4000-8000-000000000001',
      'F2 Public Insert',
      'f2-public@example.test',
      'rights holder',
      'Public insert must not set operator notes.',
      'client-supplied notes'
    )
  $$,
  '42501',
  null,
  'anonymous clients cannot insert operator_notes on a claim'
);
reset role;

set local role anon;
select lives_ok( -- 19
  $$
    insert into public.claims (
      id, annotation_id, claimant_name, claimant_email,
      relationship_to_content, reason
    ) values (
      'f2400000-0000-4000-8000-000000000099',
      'f2100000-0000-4000-8000-000000000001',
      'F2 Public Insert',
      'f2-public@example.test',
      'rights holder',
      'Published-target public insert remains available.'
    )
  $$,
  'anonymous users can still submit a published-target claim without operator notes'
);
reset role;

set local role service_role;
select ok( -- 20
  (
    select pg_catalog.count(*) = 5
      and bool_and(listed.claimant_name is null)
      and bool_and(listed.claimant_email is null)
      and bool_and(listed.details is null)
      and bool_and(listed.claim_id is not null)
    from public.list_claims_for_review(null, false, 50, null, null) as listed
  ),
  'default list returns open claims and suppresses claimant PII'
);

select ok( -- 21
  (
    select listed.claimant_email = 'f2-claimant-a@example.test'
      and listed.claimant_name = 'F2 Claimant A'
      and listed.details is not null
    from public.list_claims_for_review(null, true, 1, null, null) as listed
    where listed.claim_id = 'f2400000-0000-4000-8000-000000000001'
  ),
  'explicit PII flag returns claimant fields for an authorized service caller'
);

select ok( -- 22
  (
    select got.claimant_email is null
      and got.claimant_name is null
      and got.details is null
      and got.status = 'submitted'
      and got.reason = 'Please review excerpt A.'
    from public.get_claim_for_review(
      'f2400000-0000-4000-8000-000000000001',
      false
    ) as got
  ),
  'default get suppresses claimant PII while returning allow-listed review fields'
);

select is( -- 23
  (
    select pg_catalog.string_agg(listed.claim_id::text, ',' order by listed.created_at, listed.claim_id)
    from public.list_claims_for_review('submitted', false, 2, null, null) as listed
  ),
  'f2400000-0000-4000-8000-000000000001,f2400000-0000-4000-8000-000000000002',
  'list pagination is oldest-first and honors limit'
);

select is( -- 24
  (
    select listed.claim_id
    from public.list_claims_for_review(
      'submitted',
      false,
      1,
      '2026-09-04 02:02:00+00',
      'f2400000-0000-4000-8000-000000000002'
    ) as listed
  ),
  'f2400000-0000-4000-8000-000000000003'::uuid,
  'list keyset pagination continues after created_at,id'
);

create temporary table f2_reviewing as
select updated.*
from public.update_claim_review(
  'f2000000-0000-4000-8000-000000000002',
  'f2400000-0000-4000-8000-000000000001',
  'reviewing',
  'Moving A into review.',
  false,
  false
) as updated;

select is( -- 25
  (select status from f2_reviewing),
  'reviewing',
  'submitted to reviewing succeeds'
);

select ok( -- 26
  (
    select reviewing.previous_status = 'submitted'
      and reviewing.result_code = 'reviewing'
      and reviewing.operator_notes = 'Moving A into review.'
      and reviewing.claimant_email is null
      and reviewing.audit_id is not null
    from f2_reviewing as reviewing
  ),
  'reviewing update writes notes and audit id and still suppresses PII by default'
);

select is( -- 27
  (
    select updated.status
    from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000001',
      'resolved',
      null,
      false,
      false
    ) as updated
  ),
  'resolved',
  'reviewing to resolved succeeds'
);

select lives_ok( -- 28
  $$
    select public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000002',
      'reviewing',
      null,
      false,
      false
    )
  $$,
  'claim B can enter reviewing'
);

select is( -- 29
  (
    select updated.status
    from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000002',
      'rejected',
      null,
      false,
      false
    ) as updated
  ),
  'rejected',
  'reviewing to rejected succeeds'
);

select is( -- 30
  (
    select updated.status
    from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000003',
      'rejected',
      null,
      false,
      false
    ) as updated
  ),
  'rejected',
  'submitted to rejected is allowed without a reviewing hop'
);

select throws_ok( -- 31
  $$
    select * from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000004',
      'resolved',
      null,
      false,
      false
    )
  $$,
  '22023',
  'The claim review request is invalid.',
  'submitted to resolved is illegal'
);

select throws_ok( -- 32
  $$
    select * from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000001',
      'reviewing',
      null,
      false,
      false
    )
  $$,
  '22023',
  'The claim review request is invalid.',
  'resolved claims cannot return to reviewing'
);

select throws_ok( -- 33
  $$
    select * from public.update_claim_review(
      'f2000000-0000-4000-8000-000000000002',
      'f2400000-0000-4000-8000-000000000002',
      'submitted',
      null,
      false,
      false
    )
  $$,
  '22023',
  'The claim review request is invalid.',
  'rejected or reviewing cannot move to submitted'
);

select throws_ok( -- 34
  $$
    select * from public.get_claim_for_review(
      'f2400000-0000-4000-8000-0000000000aa',
      false
    )
  $$,
  '55000',
  'Claim review is not available.',
  'get of an unknown claim fails closed'
);
reset role;

select ok( -- 35
  (
    select pg_catalog.count(*) = 2
      and bool_and(audit.action = 'claim_review')
      and bool_and(audit.reason_code = 'claim_review')
      and bool_and(audit.actor_id = 'f2000000-0000-4000-8000-000000000002')
      and bool_and(pg_catalog.row_to_json(audit)::text !~ 'f2-claimant')
      and bool_and(pg_catalog.row_to_json(audit)::text !~ '@example.test')
      and bool_and(pg_catalog.row_to_json(audit)::text !~ 'Private details')
    from private.moderation_audit as audit
    where audit.claim_id = 'f2400000-0000-4000-8000-000000000001'
  ),
  'claim A records two append-only claim_review rows without claimant PII'
);

select is( -- 36
  (
    select value from public.annotation_votes
    where annotation_id = 'f2100000-0000-4000-8000-000000000001'
      and user_id = 'f2000000-0000-4000-8000-000000000003'
  ),
  1::smallint,
  'existing votes are unused and unchanged by claim review'
);

select is( -- 37
  (
    select annotations.status
    from public.annotations as annotations
    where annotations.id = 'f2100000-0000-4000-8000-000000000001'
  ),
  'published',
  'claim review never auto-takedown or hides the annotation'
);

select is( -- 38
  (
    select pg_catalog.count(*)
    from public.list_claims_for_review(null, false, 50, null, null) as listed
  ),
  2::bigint,
  'default list is open claims only after resolve/reject transitions'
);

reset role;

select * from finish();
rollback;
