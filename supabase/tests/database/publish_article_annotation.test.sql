begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, raw_user_meta_data)
values (
  '41000000-0000-0000-0000-000000000001',
  '{"full_name":"Article Publisher"}'::jsonb
);

set local role anon;

select throws_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/article',
      'https://example.test/article',
      'Example article',
      'Example Author',
      'Example Publisher',
      'Selected text',
      'Before',
      'After',
      'Commentary'
    )
  $sql$,
  '42501',
  null,
  'anonymous invocation is rejected'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '41000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/publishing',
      'https://example.test/articles/publishing?ref=canonical',
      'Publishing annotations',
      'Ada Author',
      'Daily Example',
      'A passage worth discussing.',
      'Before the passage',
      'After the passage',
      'This is why the passage matters.'
    )
  $sql$,
  'authenticated publishing succeeds'
);

select lives_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/publishing',
      'https://example.test/articles/publishing?ref=second',
      'Publishing annotations again',
      null,
      null,
      'A second selected passage.',
      null,
      null,
      'A second annotation on the shared source.'
    )
  $sql$,
  'a second annotation can reuse the source'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.sources
    where normalized_url = 'https://example.test/articles/publishing'
  ),
  1::bigint,
  'the same normalized URL reuses one source row'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    where user_id = '41000000-0000-0000-0000-000000000001'
      and status = 'published'
      and annotation_type = 'article_text'
  ),
  2::bigint,
  'published annotations are owned by auth.uid()'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotation_targets targets
    join public.annotations annotations on annotations.id = targets.annotation_id
    where annotations.user_id = '41000000-0000-0000-0000-000000000001'
      and targets.target_type = 'text'
      and targets.selected_text is not null
  ),
  2::bigint,
  'each published annotation receives a text target'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '41000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/long-selection',
      'https://example.test/articles/long-selection',
      'Long selection', null, null, pg_catalog.repeat('x', 2001), null, null, 'Commentary'
    )
  $sql$,
  '22023',
  'Selected text cannot exceed 2,000 characters.',
  'selected text length is enforced'
);

select throws_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/long-commentary',
      'https://example.test/articles/long-commentary',
      'Long commentary', null, null, 'Selected text', null, null, pg_catalog.repeat('x', 2001)
    )
  $sql$,
  '22023',
  'Commentary text cannot exceed 2,000 characters.',
  'commentary length is enforced'
);

select throws_ok(
  $sql$
    select public.publish_article_annotation(
      'javascript:alert(1)',
      'https://example.test/articles/invalid-url',
      'Invalid URL', null, null, 'Selected text', null, null, 'Commentary'
    )
  $sql$,
  '22023',
  'The normalized URL must be a valid HTTP or HTTPS URL.',
  'invalid URLs are rejected'
);

reset role;

select * from finish();
rollback;
