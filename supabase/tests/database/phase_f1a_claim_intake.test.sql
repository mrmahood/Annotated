begin;

create extension if not exists pgtap with schema extensions;

select plan(11);


select lives_ok(
  $sql$
    insert into auth.users (id, raw_user_meta_data) values
      (
        'f1a00000-0000-4000-8000-000000000001',
        '{"full_name":"F1a Creator"}'::jsonb
      );

    insert into public.sources (
      id,
      normalized_url,
      canonical_url,
      source_type,
      title
    ) values (
      'f1a20000-0000-4000-8000-000000000001',
      'https://example.test/f1a/claim-intake',
      'https://example.test/f1a/claim-intake',
      'article',
      'F1a claim intake source'
    );
  $sql$,
  'f1a user and source fixtures install'
);

select lives_ok(
  $sql$
    insert into public.annotations (
      id,
      source_id,
      user_id,
      annotation_type,
      commentary_text,
      status,
      published_at,
      created_at,
      updated_at
    ) values
      (
        'f1a10000-0000-4000-8000-000000000001',
        'f1a20000-0000-4000-8000-000000000001',
        'f1a00000-0000-4000-8000-000000000001',
        'article_text',
        'F1a published annotation',
        'published',
        '2026-09-03 01:00:00+00',
        '2026-09-03 01:00:00+00',
        '2026-09-03 01:00:00+00'
      ),
      (
        'f1a10000-0000-4000-8000-000000000002',
        'f1a20000-0000-4000-8000-000000000001',
        'f1a00000-0000-4000-8000-000000000001',
        'article_text',
        'F1a draft annotation',
        'draft',
        null,
        '2026-09-03 01:01:00+00',
        '2026-09-03 01:01:00+00'
      ),
      (
        'f1a10000-0000-4000-8000-000000000003',
        'f1a20000-0000-4000-8000-000000000001',
        'f1a00000-0000-4000-8000-000000000001',
        'article_text',
        'F1a hidden annotation',
        'hidden',
        '2026-09-03 01:02:00+00',
        '2026-09-03 01:02:00+00',
        '2026-09-03 01:02:00+00'
      ),
      (
        'f1a10000-0000-4000-8000-000000000004',
        'f1a20000-0000-4000-8000-000000000001',
        'f1a00000-0000-4000-8000-000000000001',
        'article_text',
        'F1a removed annotation',
        'removed',
        '2026-09-03 01:03:00+00',
        '2026-09-03 01:03:00+00',
        '2026-09-03 01:03:00+00'
      );
  $sql$,
  'f1a annotation fixtures install'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.claims', 'select'),
  'claim privacy: anon and authenticated cannot select claims'
);

select ok(
  pg_catalog.has_table_privilege('anon', 'public.claims', 'insert')
  and pg_catalog.has_table_privilege('authenticated', 'public.claims', 'insert'),
  'claim submit grant remains for anon and authenticated'
);

set local role anon;

select lives_ok(
  $sql$
    insert into public.claims (
      annotation_id,
      claimant_name,
      claimant_email,
      relationship_to_content,
      reason,
      details
    ) values (
      'f1a10000-0000-4000-8000-000000000001',
      'F1a Rights Holder',
      'f1a-rights@example.test',
      'Copyright owner',
      'Please review this published excerpt.',
      'F1a published-target positive path.'
    )
  $sql$,
  'anonymous users can submit a claim against a published annotation'
);

select throws_ok(
  $sql$
    insert into public.claims (
      annotation_id,
      claimant_name,
      claimant_email,
      relationship_to_content,
      reason
    ) values (
      'f1a10000-0000-4000-8000-000000000002',
      'F1a Rights Holder',
      'f1a-rights@example.test',
      'Copyright owner',
      'Draft targets must be rejected.'
    )
  $sql$,
  '42501',
  null,
  'anonymous users cannot submit a claim against a draft annotation'
);

select throws_ok(
  $sql$
    insert into public.claims (
      annotation_id,
      claimant_name,
      claimant_email,
      relationship_to_content,
      reason
    ) values (
      'f1a10000-0000-4000-8000-000000000003',
      'F1a Rights Holder',
      'f1a-rights@example.test',
      'Copyright owner',
      'Hidden targets must be rejected.'
    )
  $sql$,
  '42501',
  null,
  'anonymous users cannot submit a claim against a hidden annotation'
);

select throws_ok(
  $sql$
    insert into public.claims (
      annotation_id,
      claimant_name,
      claimant_email,
      relationship_to_content,
      reason
    ) values (
      'f1a10000-0000-4000-8000-000000000004',
      'F1a Rights Holder',
      'f1a-rights@example.test',
      'Copyright owner',
      'Removed targets must be rejected.'
    )
  $sql$,
  '42501',
  null,
  'anonymous users cannot submit a claim against a removed annotation'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'f1a00000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $sql$
    insert into public.claims (
      annotation_id,
      claimant_name,
      claimant_email,
      relationship_to_content,
      reason
    ) values (
      'f1a10000-0000-4000-8000-000000000001',
      'F1a Authenticated Claimant',
      'f1a-auth@example.test',
      'Author or creator',
      'Authenticated submit against published remains allowed.'
    )
  $sql$,
  'authenticated users can submit a claim against a published annotation'
);

select throws_ok(
  $sql$
    insert into public.claims (
      annotation_id,
      claimant_name,
      claimant_email,
      relationship_to_content,
      reason
    ) values (
      'f1a10000-0000-4000-8000-000000000002',
      'F1a Authenticated Claimant',
      'f1a-auth@example.test',
      'Author or creator',
      'Authenticated draft submit must fail.'
    )
  $sql$,
  '42501',
  null,
  'authenticated users cannot submit a claim against a draft annotation'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.claims
    where annotation_id = 'f1a10000-0000-4000-8000-000000000001'
      and status = 'submitted'
  ),
  2::bigint,
  'only the two published-target claims were persisted'
);

select * from finish();
rollback;
