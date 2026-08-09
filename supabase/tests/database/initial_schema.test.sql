begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'sources', 'sources table exists');
select has_table('public', 'annotations', 'annotations table exists');
select has_table('public', 'annotation_targets', 'annotation_targets table exists');
select has_table('public', 'claims', 'claims table exists');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.sources'::regclass),
  'sources has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotations'::regclass),
  'annotations has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_targets'::regclass),
  'annotation_targets has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.claims'::regclass),
  'claims has RLS enabled'
);

insert into auth.users (id, raw_user_meta_data)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '{"full_name":"Annotation Owner"}'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '{"name":"Other User"}'::jsonb
  );

insert into public.sources (
  id,
  normalized_url,
  canonical_url,
  source_type,
  title
)
values (
  '20000000-0000-0000-0000-000000000001',
  'https://example.test/articles/schema-foundation',
  'https://example.test/articles/schema-foundation',
  'article',
  'Schema Foundation'
);

insert into public.annotations (
  id,
  source_id,
  user_id,
  annotation_type,
  commentary_text,
  status,
  published_at
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'article_text',
    'Private draft',
    'draft',
    null
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'article_text',
    'Public annotation',
    'published',
    pg_catalog.now()
  );

select throws_ok(
  $sql$
    insert into public.sources (normalized_url, canonical_url, source_type)
    values ('https://example.test/invalid-type', 'https://example.test/invalid-type', 'book')
  $sql$,
  '23514',
  null,
  'invalid source types are rejected'
);

select throws_ok(
  $sql$
    insert into public.annotation_targets (annotation_id, target_type, selected_text)
    values (
      '30000000-0000-0000-0000-000000000001',
      'text',
      repeat('x', 2001)
    )
  $sql$,
  '23514',
  null,
  'article selections over 2,000 characters are rejected'
);

select throws_ok(
  $sql$
    insert into public.annotation_targets (annotation_id, target_type, start_ms, end_ms)
    values (
      '30000000-0000-0000-0000-000000000001',
      'time_range',
      0,
      300001
    )
  $sql$,
  '23514',
  null,
  'time ranges over 5 minutes are rejected'
);

set local role anon;

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'anonymous users cannot read drafts'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    where id = '30000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'anonymous users can read published annotations'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000002',
  true
);
set local role authenticated;

update public.annotations
set commentary_text = 'Unauthorized change'
where id = '30000000-0000-0000-0000-000000000001';

reset role;

select is(
  (
    select commentary_text
    from public.annotations
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  'Private draft',
  'users cannot update another user''s annotation'
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
    )
    values (
      '30000000-0000-0000-0000-000000000002',
      'Rights Holder',
      'rights-holder@example.test',
      'Copyright owner',
      'Please review this excerpt.',
      'Submitted anonymously for the database policy test.'
    )
  $sql$,
  'anonymous users can submit a claim'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.claims', 'select'),
  'anonymous users cannot read claims'
);

reset role;

select * from finish();
rollback;
