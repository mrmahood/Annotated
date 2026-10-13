begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

select has_column('public', 'annotations', 'note_type', 'annotations.note_type stores the creator classification');
select has_column('public', 'annotations', 'verdict', 'annotations.verdict stores the optional truth label');
select has_table('public', 'annotation_sources', 'source links live beside the annotation');
select has_table('public', 'annotation_source_votes', 'helpful source marks are private rows');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.annotation_sources'::regclass),
  'annotation_sources enables row level security'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.annotation_source_votes'::regclass
  ),
  'helpful marks force row level security'
);

select ok(
  pg_catalog.has_table_privilege('anon', 'public.annotation_sources', 'select')
  and pg_catalog.has_table_privilege('authenticated', 'public.annotation_sources', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_sources', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_sources', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_sources', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_sources', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_sources', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_sources', 'delete')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_source_votes', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_source_votes', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_source_votes', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_source_votes', 'insert'),
  'clients may read source links and cannot read or write helpful marks'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.publish_article_annotation(text,text,text,text,text,text,text,text,text,text)'
  ) is not null,
  'historical article publish signature remains callable'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.publish_article_annotation(text,text,text,text,text,text,text,text,text,text,text,text,text[])'
  ) is not null,
  'extended article publish accepts classification'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.publish_article_annotation(text,text,text,text,text,text,text,text,text,text,text,text,text[])',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.publish_article_annotation(text,text,text,text,text,text,text,text,text,text,text,text,text[])',
    'execute'
  ),
  'only authenticated clients can publish a classified annotation'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('b1000000-0000-4000-8000-000000000001', '{"full_name":"Note Author"}'::jsonb),
  ('b1000000-0000-4000-8000-000000000002', '{"full_name":"Note Reader"}'::jsonb);

select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-historical',
    'https://example.test/note-historical',
    'Historical',
    null, null,
    'Older passage',
    null, null,
    'Historical commentary'
  )$$,
  'callers that omit classification still publish'
);

select is(
  (select note_type from public.annotations where commentary_text = 'Historical commentary'),
  null,
  'omitted classification stays null for historical callers'
);

select throws_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-missing-type',
    'https://example.test/note-missing-type',
    'Missing type',
    null, null, 'Passage', null, null, 'Missing type commentary',
    null, null, null, null
  )$$,
  '22023',
  'An annotation type is required.',
  'the extended publish RPC requires an annotation type'
);

select throws_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-fact-no-verdict',
    'https://example.test/note-fact-no-verdict',
    'Fact',
    null, null, 'Passage', null, null, 'Fact without verdict',
    null, 'fact_check', null, array['https://example.test/evidence']
  )$$,
  '22023',
  'A fact check requires a verdict.',
  'fact check requires a verdict'
);

select throws_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-receipts-no-link',
    'https://example.test/note-receipts-no-link',
    'Receipts',
    null, null, 'Passage', null, null, 'Receipts without links',
    null, 'receipts', null, array[]::text[]
  )$$,
  '22023',
  'Fact check and Receipts require at least one source link.',
  'receipts require a source link'
);

select throws_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-bad-url',
    'https://example.test/note-bad-url',
    'Bad url',
    null, null, 'Passage', null, null, 'Bad source url',
    null, 'context', null, array['javascript:alert(1)']
  )$$,
  '22023',
  'Each source link must be an HTTP or HTTPS URL.',
  'source links must be http(s)'
);

select lives_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-fact',
    'https://example.test/note-fact',
    'Fact page',
    null, null, 'A claim in the passage', null, null, 'This claim is misleading.',
    'Fact headline',
    'fact_check',
    'misleading',
    array['https://example.test/evidence', ' https://example.test/evidence ']
  )$$,
  'fact check publishes with a verdict and one distinct source link'
);

select is(
  (select note_type from public.annotations where commentary_text = 'This claim is misleading.'),
  'fact_check',
  'fact check type is stored'
);

select is(
  (select verdict from public.annotations where commentary_text = 'This claim is misleading.'),
  'misleading',
  'fact check verdict is stored'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_sources
    join public.annotations on annotations.id = annotation_sources.annotation_id
    where annotations.commentary_text = 'This claim is misleading.'
  ),
  1::bigint,
  'duplicate source urls collapse to one row'
);

reset role;
grant update (note_type, verdict) on table public.annotations to authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$update public.annotations
    set note_type = 'hot_take'
    where commentary_text = 'This claim is misleading.'$$,
  '42501',
  'Annotation type and verdict are set when the annotation is published.',
  'the owner cannot rewrite the classification'
);

reset role;
revoke update (note_type, verdict) on table public.annotations from authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.publish_article_annotation(
    'https://example.test/note-context',
    'https://example.test/note-context',
    'Context page',
    null, null, 'Background passage', null, null, 'Added context.',
    null, 'context', null, null
  )$$,
  'context publishes without a verdict or source link'
);

select lives_ok(
  $$select * from public.begin_hosted_youtube_annotation(
    'https://www.youtube.com/watch?v=noteVid1234',
    'https://www.youtube.com/watch?v=noteVid1234',
    'noteVid1234',
    'Clip title',
    'Channel',
    1000,
    8000,
    'Clip commentary',
    null,
    'hot_take',
    'true',
    null
  )$$,
  'hosted YouTube begin stores a hot take on the draft'
);

select is(
  (select note_type from public.annotations where commentary_text = 'Clip commentary'),
  'hot_take',
  'draft classification is hot_take'
);

select is(
  public.get_annotation_consensus(
    (select id from public.annotations where commentary_text = 'Clip commentary')
  ),
  null,
  'unpublished drafts have no public consensus'
);

reset role;

insert into public.annotation_votes (annotation_id, user_id, value)
select annotations.id, 'b1000000-0000-4000-8000-000000000002', 1
from public.annotations
where annotations.commentary_text = 'This claim is misleading.';

insert into public.annotation_sources (annotation_id, url, position)
select annotations.id, 'https://example.test/draft-source', 1
from public.annotations
where annotations.commentary_text = 'Clip commentary';

set local role anon;

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_sources
    where url = 'https://example.test/evidence'
  ),
  1::bigint,
  'anonymous readers can see a published source link'
);

select is_empty(
  $$select id from public.annotation_sources where url = 'https://example.test/draft-source'$$,
  'anonymous readers cannot see a draft source link'
);

select throws_ok(
  $$insert into public.annotation_sources (annotation_id, url, position)
    select id, 'https://example.test/injected', 2
    from public.annotations
    where commentary_text = 'This claim is misleading.'$$,
  '42501',
  'permission denied for table annotation_sources',
  'anonymous clients cannot insert source links'
);

select throws_ok(
  $$insert into public.annotation_source_votes (source_id, user_id, value)
    select id, 'b1000000-0000-4000-8000-000000000002', 1
    from public.annotation_sources
    where url = 'https://example.test/evidence'$$,
  '42501',
  'permission denied for table annotation_source_votes',
  'anonymous clients cannot insert helpful marks'
);

select is(
  (
    public.get_annotation_consensus(
      (select id from public.annotations where commentary_text = 'This claim is misleading.')
    ) ->> 'agree_count'
  )::bigint,
  1::bigint,
  'consensus agree count reuses annotation_votes'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is_empty(
  $$select id from public.annotation_sources where url = 'https://example.test/draft-source'$$,
  'another reader cannot see a draft source link'
);

select is(
  public.rate_annotation_source_helpful(
    (
      select annotation_sources.id
      from public.annotation_sources
      join public.annotations on annotations.id = annotation_sources.annotation_id
      where annotations.commentary_text = 'This claim is misleading.'
    )
  ) ->> 'result_code',
  'CREATED',
  'another reader can mark a source helpful'
);

select throws_ok(
  $$select source_id from public.annotation_source_votes$$,
  '42501',
  'permission denied for table annotation_source_votes',
  'the reader who marked a source helpful still cannot read that row'
);

reset role;
set local role anon;

select throws_ok(
  $$select source_id from public.annotation_source_votes$$,
  '42501',
  'permission denied for table annotation_source_votes',
  'anonymous clients cannot read helpful-mark rows'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_sources
    where url = 'https://example.test/draft-source'
  ),
  1::bigint,
  'the owner can read a source link on their own draft'
);

select is(
  (
    public.get_annotation_consensus(
      (select id from public.annotations where commentary_text = 'This claim is misleading.')
    ) -> 'sources' -> 0 ->> 'helpful_count'
  )::bigint,
  1::bigint,
  'consensus reports the helpful source total'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  public.rate_annotation_source_helpful(
    (
      select annotation_sources.id
      from public.annotation_sources
      join public.annotations on annotations.id = annotation_sources.annotation_id
      where annotations.commentary_text = 'This claim is misleading.'
    )
  ) ->> 'result_code',
  'SELF_RATE_FORBIDDEN',
  'the creator cannot mark their own source helpful'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(
  (
    select result_code from public.cast_annotation_agreement(
      (select id from public.annotations where commentary_text = 'This claim is misleading.'),
      -1::smallint
    )
  ),
  'CHANGED',
  'agree and disagree reuse the annotation vote mutation'
);

select is(
  public.rate_annotation_source_helpful(
    (
      select annotation_sources.id
      from public.annotation_sources
      join public.annotations on annotations.id = annotation_sources.annotation_id
      where annotations.commentary_text = 'This claim is misleading.'
    )
  ) ->> 'result_code',
  'CLEARED',
  'a second helpful mark clears the rating'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    where commentary_text in (
      'Missing type commentary',
      'Fact without verdict',
      'Receipts without links',
      'Bad source url'
    )
  ),
  0::bigint,
  'rejected classifications do not leave annotations behind'
);

select * from finish();
rollback;
