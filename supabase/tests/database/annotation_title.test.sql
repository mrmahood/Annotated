begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_column(
  'public',
  'annotations',
  'title',
  'annotations.title exists for optional creator-entered headlines'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.publish_article_annotation(text,text,text,text,text,text,text,text,text,text)'
  ) is not null,
  'article publish accepts optional p_title'
);

select ok(
  has_function_privilege('authenticated', 'private.normalize_annotation_title(text)', 'execute'),
  'authenticated can execute title normalize from invoker article publish'
);

select ok(
  not has_function_privilege('anon', 'private.normalize_annotation_title(text)', 'execute'),
  'anonymous clients cannot execute title normalize'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.begin_hosted_youtube_annotation(text,text,text,text,text,integer,integer,text,text)'
  ) is not null,
  'hosted YouTube begin accepts optional p_title'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.begin_hosted_audio_annotation(text,text,text,text,text,text,integer,integer,text,text)'
  ) is not null,
  'hosted audio begin accepts optional p_title'
);

insert into auth.users (id, raw_user_meta_data)
values (
  'a1000000-0000-4000-8000-000000000001',
  '{"full_name":"Title Publisher"}'::jsonb
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/titled',
      'https://example.test/articles/titled',
      'Source article',
      null,
      null,
      'A selected passage.',
      null,
      null,
      'Typed commentary stays required.',
      '  Quiet headline  '
    )
  $sql$,
  'article publish stores a trimmed creator title'
);

select is(
  (
    select annotations.title
    from public.annotations
    where commentary_text = 'Typed commentary stays required.'
  ),
  'Quiet headline',
  'published article title is trimmed and stored'
);

select lives_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/untitled',
      'https://example.test/articles/untitled',
      'Untitled source',
      null,
      null,
      'Another passage.',
      null,
      null,
      'Commentary without a title.',
      '   '
    )
  $sql$,
  'whitespace-only title is accepted and stored as null'
);

select is(
  (
    select annotations.title
    from public.annotations
    where commentary_text = 'Commentary without a title.'
  ),
  null,
  'blank title does not invent a headline'
);

select throws_ok(
  $sql$
    select public.publish_article_annotation(
      'https://example.test/articles/long-title',
      'https://example.test/articles/long-title',
      'Long title source',
      null,
      null,
      'Passage.',
      null,
      null,
      'Commentary.',
      repeat('A', 121)
    )
  $sql$,
  '22023',
  'Annotation title cannot exceed 120 characters.',
  'titles longer than 120 characters are rejected'
);

select lives_ok(
  $sql$
    select * from public.begin_hosted_youtube_annotation(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
      'Source video title',
      'Channel',
      1000,
      8000,
      '',
      'Voice-only take'
    )
  $sql$,
  'hosted YouTube begin stores a title beside empty typed commentary'
);

select is(
  (
    select annotations.title
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where sources.normalized_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      and annotations.user_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'Voice-only take',
  'hosted draft title is distinct from the YouTube source title'
);

select is(
  (
    select sources.title
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.title = 'Voice-only take'
  ),
  'Source video title',
  'source nest title remains the episode or video title'
);

select lives_ok(
  $sql$
    select * from public.begin_hosted_audio_annotation(
      'https://example.test/podcast/episode',
      'https://example.test/podcast/episode',
      'Episode title',
      null,
      null,
      'Show name',
      1000,
      8000,
      'Audio commentary',
      'Audio card headline'
    )
  $sql$,
  'hosted audio begin accepts a creator title'
);

select is(
  (
    select annotations.title
    from public.annotations
    where commentary_text = 'Audio commentary'
  ),
  'Audio card headline',
  'hosted audio title is stored on the annotation'
);

select is(
  (
    select annotations.status
    from public.annotations
    where annotations.title = 'Voice-only take'
  ),
  'draft',
  'a title does not publish a hosted annotation or replace typed or voice commentary'
);

select is(
  (
    select pg_catalog.count(*)
    from public.annotations
    where title is not null
      and pg_catalog.char_length(title) > 120
  ),
  0::bigint,
  'no stored annotation title exceeds the 120-character one-liner limit'
);

select * from finish();
rollback;
