begin;

create extension if not exists pgtap with schema extensions;
select plan(55);

-- Contract shape and least-privilege grants.
select ok( -- 1
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.annotations'::regclass
      and conname = 'annotations_published_slug_check'
      and contype = 'c'
      and convalidated
  ),
  'published annotation slugs are protected by a validated check constraint'
);
select ok( -- 2
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.annotations'::regclass
      and tgname = 'annotations_ensure_public_route'
      and not tgisinternal
      and tgenabled = 'O'
  ),
  'the publication route completion trigger is enabled'
);
select has_function( -- 3
  'private', 'get_annotation_route_integrity_report', array[]::text[],
  'the service-only route integrity report exists'
);
select has_function( -- 4
  'private', 'backfill_published_annotation_routes', array[]::text[],
  'the service-only idempotent route backfill exists'
);
select has_function( -- 5
  'public', 'resolve_public_annotation_route', array['text', 'text'],
  'the bounded handle-and-slug resolver exists'
);
select has_function( -- 6
  'public', 'resolve_public_annotation_uuid', array['uuid'],
  'the bounded UUID compatibility resolver exists'
);
select has_function( -- 7
  'public', 'get_public_annotation_media_state', array['uuid'],
  'the safe public media-state projection exists'
);
select has_function( -- 8
  'public', 'get_annotation_media_delivery', array['uuid'],
  'the service-only processed-media delivery lookup exists'
);
select ok( -- 9
  pg_catalog.has_function_privilege(
    'anon', 'public.resolve_public_annotation_route(text,text)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.resolve_public_annotation_route(text,text)', 'execute'
  ),
  'anonymous and authenticated readers may resolve a public canonical route'
);
select ok( -- 10
  pg_catalog.has_function_privilege(
    'anon', 'public.resolve_public_annotation_uuid(uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.resolve_public_annotation_uuid(uuid)', 'execute'
  ),
  'anonymous and authenticated readers may resolve public UUID compatibility'
);
select ok( -- 11
  pg_catalog.has_function_privilege(
    'anon', 'public.get_public_annotation_media_state(uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.get_public_annotation_media_state(uuid)', 'execute'
  ),
  'public clients may read only the safe media-state projection'
);
select ok( -- 12
  not pg_catalog.has_function_privilege(
    'public', 'public.get_annotation_media_delivery(uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.get_annotation_media_delivery(uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.get_annotation_media_delivery(uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.get_annotation_media_delivery(uuid)', 'execute'
  ),
  'only the service role may derive a processed-media delivery path'
);
select ok( -- 13
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.get_annotation_route_integrity_report()', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'private.backfill_published_annotation_routes()', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.get_annotation_route_integrity_report()', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'private.backfill_published_annotation_routes()', 'execute'
  ),
  'route audit and backfill operations are service-only'
);
select ok( -- 14
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'resolve_public_annotation_route'
  )
  and (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'get_annotation_media_delivery'
  ),
  'public resolver and delivery lookup are security definers with empty search paths'
);
select ok( -- 15
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_media_state(uuid)'::regprocedure
    ),
    'storage_path'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_media_state(uuid)'::regprocedure
    ),
    'checksum'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_public_annotation_media_state(uuid)'::regprocedure
    ),
    'removed_at'
  ) = 0,
  'the public media-state projection omits paths, checksums, and private timestamps'
);
select ok( -- 16
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_annotation_media_delivery(uuid)'::regprocedure
    ),
    'processed_storage_path'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'public.get_annotation_media_delivery(uuid)'::regprocedure
    ),
    'raw_storage_path'
  ) = 0,
  'the service delivery lookup exposes only the processed path, never a raw path'
);

insert into auth.users (id, raw_user_meta_data)
values
  ('d1a00000-0000-4000-8000-000000000001', '{"full_name":"D1A Creator"}'::jsonb),
  ('d1a00000-0000-4000-8000-000000000002', '{"full_name":"D1A Other"}'::jsonb),
  ('d1a00000-0000-4000-8000-000000000003', '{"full_name":"D1A Backfill"}'::jsonb);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd1a00000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select lives_ok( -- 17
  $$
    select public.publish_article_annotation(
      'https://example.test/d1a/article',
      'https://example.test/d1a/article',
      'Canonical Article Route',
      'Article Author',
      'Article Publisher',
      'The D1a selected passage.',
      null,
      null,
      'D1a article commentary'
    )
  $$,
  'article publication remains immediate through the validated RPC'
);
reset role;

select ok( -- 18
  (
    select profiles.username ~ '^d1a-creator-[0-9a-f]{8}$'
    from public.profiles
    where profiles.id = 'd1a00000-0000-4000-8000-000000000001'
  ),
  'immediate article publication creates a deterministic valid creator handle'
);
select ok( -- 19
  (
    select annotations.slug ~ '^canonical-article-route-[0-9a-f]{8,32}$'
    from public.annotations
    where annotations.commentary_text = 'D1a article commentary'
  ),
  'immediate article publication creates an immutable creator-scoped slug'
);
select ok( -- 20
  exists (
    select 1
    from public.annotations
    join public.annotation_targets
      on annotation_targets.annotation_id = annotations.id
    where annotations.commentary_text = 'D1a article commentary'
      and annotations.status = 'published'
      and annotations.published_at is not null
      and annotation_targets.target_type = 'text'
      and annotation_targets.selected_text = 'The D1a selected passage.'
  ),
  'article publication and its selected-text target remain intact'
);
select ok( -- 21
  (
    select published_missing_slug_count = 0
      and published_creator_missing_handle_count = 0
      and current_alias_collision_count = 0
      and published_route_collision_count = 0
    from private.get_annotation_route_integrity_report()
  ),
  'route integrity is clean after immediate article publication'
);
select is( -- 22
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_route(
      (
        select profiles.username
        from public.profiles
        where profiles.id = 'd1a00000-0000-4000-8000-000000000001'
      ),
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    )
  ),
  1::bigint,
  'the current handle and creator-scoped slug resolve one public annotation'
);
select is( -- 23
  (
    select resolved.annotation_id
    from public.resolve_public_annotation_route(
      (
        select profiles.username
        from public.profiles
        where profiles.id = 'd1a00000-0000-4000-8000-000000000001'
      ),
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    ) as resolved
  ),
  (
    select annotations.id
    from public.annotations
    where annotations.commentary_text = 'D1a article commentary'
  ),
  'canonical resolution returns the authoritative annotation UUID'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd1a00000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select lives_ok( -- 24
  $$select public.set_profile_handle('d1a-current')$$,
  'the controlled handle-change RPC remains usable'
);
reset role;

select ok( -- 25
  (
    select resolved.matched_handle_is_alias
      and resolved.current_creator_handle = 'd1a-current'
    from public.resolve_public_annotation_route(
      'd1a-creator-d1a00000',
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    ) as resolved
  ),
  'a reserved old handle resolves only to the current canonical handle'
);
select ok( -- 26
  (
    select not resolved.matched_handle_is_alias
      and resolved.current_creator_handle = 'd1a-current'
    from public.resolve_public_annotation_route(
      'd1a-current',
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    ) as resolved
  ),
  'the current handle resolves without an alias redirect marker'
);
select is( -- 27
  (
    select resolved.current_creator_handle
    from public.resolve_public_annotation_uuid(
      (
        select annotations.id
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    ) as resolved
  ),
  'd1a-current',
  'UUID compatibility resolution returns the current creator handle'
);
select is( -- 28
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_route(
      'D1A-CURRENT',
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    )
  ),
  0::bigint,
  'noncanonical uppercase route parts fail closed'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd1a00000-0000-4000-8000-000000000002', true
);
set local role authenticated;
select lives_ok( -- 29
  $$
    select public.begin_hosted_audio_annotation(
      'https://example.test/d1a/draft-audio',
      'https://example.test/d1a/draft-audio',
      'Private Draft Audio',
      'Host',
      'Publisher',
      'Series',
      1000,
      5000,
      'D1a private draft commentary'
    )
  $$,
  'hosted audio still begins as a private draft with route identity'
);
reset role;

select is( -- 30
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_route(
      (
        select profiles.username
        from public.profiles
        where profiles.id = 'd1a00000-0000-4000-8000-000000000002'
      ),
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a private draft commentary'
      )
    )
  ),
  0::bigint,
  'canonical resolution does not expose a hosted draft'
);
select is( -- 31
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_uuid(
      (
        select annotations.id
        from public.annotations
        where annotations.commentary_text = 'D1a private draft commentary'
      )
    )
  ),
  0::bigint,
  'UUID compatibility resolution does not expose a hosted draft'
);
select is( -- 32
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_route(
      (
        select profiles.username
        from public.profiles
        where profiles.id = 'd1a00000-0000-4000-8000-000000000002'
      ),
      (
        select annotations.slug
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    )
  ),
  0::bigint,
  'a slug cannot resolve outside its creator scope'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd1a00000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select lives_ok( -- 33
  $$
    select public.publish_youtube_annotation(
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      'aqz-KE-bpKQ',
      'Historical Route Video',
      'Historical Channel',
      0,
      120000,
      'D1a historical time-code commentary'
    )
  $$,
  'grandfathered two-minute time-code publication remains available'
);
reset role;

select ok( -- 34
  exists (
    select 1
    from public.annotations
    join public.annotation_targets
      on annotation_targets.annotation_id = annotations.id
    where annotations.commentary_text = 'D1a historical time-code commentary'
      and annotations.status = 'published'
      and annotations.slug is not null
      and annotation_targets.end_ms - annotation_targets.start_ms = 120000
  ),
  'historical ranges over 90 seconds remain readable and receive route identity'
);
set local role anon;
select is( -- 35
  (
    select pg_catalog.count(*)
    from public.annotations
    where commentary_text = 'D1a historical time-code commentary'
  ),
  1::bigint,
  'anonymous historical annotation reads remain compatible'
);
reset role;

update public.annotations
set status = 'hidden'
where commentary_text = 'D1a historical time-code commentary';

select is( -- 36
  (
    select pg_catalog.count(*)
    from public.resolve_public_annotation_uuid(
      (
        select annotations.id
        from public.annotations
        where annotations.commentary_text = 'D1a historical time-code commentary'
      )
    )
  ),
  0::bigint,
  'hidden annotations do not resolve through UUID compatibility'
);

-- Create one authoritative ready hosted video without changing the worker
-- contract, then prove the public and service projections remain separated.
insert into public.sources (
  id, normalized_url, canonical_url, source_type, title, author, publisher, metadata
) values (
  'd1a10000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'youtube',
  'D1A Ready Hosted Video',
  'Google for Developers',
  'YouTube',
  '{"video_id":"M7lc1UVf-VE"}'::jsonb
);
insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values (
  'd1a20000-0000-4000-8000-000000000001',
  'd1a10000-0000-4000-8000-000000000001',
  'd1a00000-0000-4000-8000-000000000001',
  'video_clip',
  'D1a ready hosted commentary',
  'draft',
  null
);
insert into public.annotation_targets (
  annotation_id, target_type, start_ms, end_ms
) values (
  'd1a20000-0000-4000-8000-000000000001', 'time_range', 1000, 10000
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
  'd1a30000-0000-4000-8000-000000000001',
  'd1a20000-0000-4000-8000-000000000001',
  'video',
  'ready',
  'd1a00000-0000-4000-8000-000000000001/d1a20000-0000-4000-8000-000000000001/d1a30000-0000-4000-8000-000000000001/excerpt.mp4',
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
  'd1a20000-0000-4000-8000-000000000001',
  'Only this nine-second D1a excerpt.',
  'en',
  '[{"start_ms":0,"end_ms":9000,"text":"Only this nine-second D1a excerpt."}]'::jsonb,
  'test-provider',
  'test-model',
  '{"confidential":"provider-audit"}'::jsonb
);
update public.annotations
set status = 'published', published_at = pg_catalog.now()
where id = 'd1a20000-0000-4000-8000-000000000001';

set local role anon;
select is( -- 37
  (
    select media_state.availability
    from public.get_public_annotation_media_state(
      'd1a20000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'ready',
  'the public media-state projection identifies authoritative ready media'
);
select ok( -- 38
  (
    select media_state.media_type = 'video'
      and media_state.mime_type = 'video/mp4'
      and media_state.duration_ms = 9000
      and media_state.width = 426
      and media_state.height = 240
      and media_state.byte_size = 400000
    from public.get_public_annotation_media_state(
      'd1a20000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'the public ready projection contains only bounded playback facts'
);
select throws_ok( -- 39
  $$
    select *
    from public.get_annotation_media_delivery(
      'd1a20000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'anonymous callers cannot derive a private processed path'
);
reset role;

set local role service_role;
select is( -- 40
  (
    select delivery.processed_storage_path
    from public.get_annotation_media_delivery(
      'd1a20000-0000-4000-8000-000000000001'
    ) as delivery
  ),
  'd1a00000-0000-4000-8000-000000000001/d1a20000-0000-4000-8000-000000000001/d1a30000-0000-4000-8000-000000000001/excerpt.mp4',
  'the service role derives exactly the authoritative private processed path'
);
reset role;

update public.annotation_media
set processed_storage_path =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/' ||
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc/excerpt.mp4'
where id = 'd1a30000-0000-4000-8000-000000000001';

set local role service_role;
select is(
  (
    select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      'd1a20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'delivery rejects a stored processed path that is not bound to the authoritative owner, annotation, and media IDs'
);
reset role;

update public.annotation_media
set processed_storage_path =
  'd1a00000-0000-4000-8000-000000000001/' ||
  'd1a20000-0000-4000-8000-000000000001/' ||
  'd1a30000-0000-4000-8000-000000000001/excerpt.mp4'
where id = 'd1a30000-0000-4000-8000-000000000001';

update public.annotation_media
set processing_status = 'removed', removed_at = pg_catalog.now()
where id = 'd1a30000-0000-4000-8000-000000000001';

set local role anon;
select ok( -- 41
  (
    select media_state.availability = 'removed'
      and media_state.mime_type is null
      and media_state.duration_ms is null
      and media_state.width is null
      and media_state.height is null
      and media_state.byte_size is null
    from public.get_public_annotation_media_state(
      'd1a20000-0000-4000-8000-000000000001'
    ) as media_state
  ),
  'removed media exposes only a stable removed state and no playback facts'
);
reset role;
set local role service_role;
select is( -- 42
  (
    select pg_catalog.count(*)
    from public.get_annotation_media_delivery(
      'd1a20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'removed media can no longer produce a service delivery path'
);
reset role;

update public.annotations
set status = 'removed'
where id = 'd1a20000-0000-4000-8000-000000000001';

set local role anon;
select is( -- 43
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media_state(
      'd1a20000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'an annotation-level removed state suppresses even the public media-removal projection'
);
reset role;

-- Simulate pre-D1a published data inside this rolled-back test transaction,
-- then exercise the same idempotent backfill used by the migration.
insert into public.sources (
  id, normalized_url, canonical_url, source_type, title
) values (
  'd1a10000-0000-4000-8000-000000000003',
  'https://example.test/d1a/backfill',
  'https://example.test/d1a/backfill',
  'article',
  'Legacy Backfill Article'
);
insert into public.annotations (
  id, source_id, user_id, annotation_type, commentary_text, status, published_at
) values (
  'd1a20000-0000-4000-8000-000000000003',
  'd1a10000-0000-4000-8000-000000000003',
  'd1a00000-0000-4000-8000-000000000003',
  'article_text',
  'D1a simulated legacy commentary',
  'draft',
  null
);
insert into public.annotation_targets (
  annotation_id, target_type, selected_text
) values (
  'd1a20000-0000-4000-8000-000000000003',
  'text',
  'Simulated pre-D1a passage.'
);

alter table public.annotations
  drop constraint annotations_published_slug_check;
alter table public.annotations
  disable trigger annotations_ensure_public_route;
update public.annotations
set status = 'published', published_at = pg_catalog.now()
where id = 'd1a20000-0000-4000-8000-000000000003';
alter table public.annotations
  enable trigger annotations_ensure_public_route;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd1a00000-0000-4000-8000-000000000003', true
);
set local role authenticated;
select throws_ok( -- 44
  $$select * from private.backfill_published_annotation_routes()$$,
  '42501',
  null,
  'authenticated clients cannot invoke the route backfill'
);
reset role;

select ok( -- 45
  (
    select report.published_missing_slug_count = 1
      and report.published_creator_missing_handle_count = 1
      and report.current_alias_collision_count = 0
      and report.published_route_collision_count = 0
    from private.get_annotation_route_integrity_report() as report
  ),
  'the preflight report identifies only the simulated missing route identity'
);
set local role service_role;
select ok( -- 46
  (
    select backfill.creator_handles_created = 1
      and backfill.annotation_slugs_created = 1
    from private.backfill_published_annotation_routes() as backfill
  ),
  'the service-only backfill creates exactly one missing handle and slug'
);
reset role;
select ok( -- 47
  (
    select report.published_missing_slug_count = 0
      and report.published_creator_missing_handle_count = 0
      and report.current_alias_collision_count = 0
      and report.published_route_collision_count = 0
    from private.get_annotation_route_integrity_report() as report
  ),
  'the post-backfill integrity report has no missing or colliding public routes'
);
select is( -- 48
  (
    select resolved.annotation_id
    from public.resolve_public_annotation_route(
      (
        select profiles.username
        from public.profiles
        where profiles.id = 'd1a00000-0000-4000-8000-000000000003'
      ),
      (
        select annotations.slug
        from public.annotations
        where annotations.id = 'd1a20000-0000-4000-8000-000000000003'
      )
    ) as resolved
  ),
  'd1a20000-0000-4000-8000-000000000003'::uuid,
  'a backfilled historical route resolves to its authoritative UUID'
);

alter table public.annotations
  add constraint annotations_published_slug_check check (
    status <> 'published' or slug is not null
  ) not valid;
alter table public.annotations
  validate constraint annotations_published_slug_check;

alter table public.annotations
  disable trigger annotations_ensure_public_route;
select throws_ok( -- 49
  $$
    insert into public.annotations (
      id, source_id, user_id, annotation_type, commentary_text,
      status, published_at, slug
    ) values (
      'd1a20000-0000-4000-8000-000000000004',
      'd1a10000-0000-4000-8000-000000000003',
      'd1a00000-0000-4000-8000-000000000003',
      'article_text',
      'Constraint bypass attempt',
      'published',
      pg_catalog.now(),
      null
    )
  $$,
  '23514',
  null,
  'the validated constraint rejects a published row without a slug even if the trigger is disabled'
);
alter table public.annotations
  enable trigger annotations_ensure_public_route;

set local role service_role;
select ok( -- 50
  (
    select backfill.creator_handles_created = 0
      and backfill.annotation_slugs_created = 0
    from private.backfill_published_annotation_routes() as backfill
  ),
  'the route backfill is idempotent after route completion'
);
reset role;
select is( -- 51
  (
    select report.published_route_collision_count
    from private.get_annotation_route_integrity_report() as report
  ),
  0::bigint,
  'no two published annotations share the same current-handle and slug route'
);
select is( -- 52
  (
    select report.current_alias_collision_count
    from private.get_annotation_route_integrity_report() as report
  ),
  0::bigint,
  'no current creator handle collides with a reserved alias'
);
select is( -- 53
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media_state(
      (
        select annotations.id
        from public.annotations
        where annotations.commentary_text = 'D1a article commentary'
      )
    )
  ),
  0::bigint,
  'article annotations never fabricate a hosted-media state'
);
select is( -- 54
  (
    select pg_catalog.count(*)
    from public.get_public_annotation_media_state(
      (
        select annotations.id
        from public.annotations
        where annotations.commentary_text = 'D1a private draft commentary'
      )
    )
  ),
  0::bigint,
  'private hosted drafts never expose a public media state'
);

select * from finish();
rollback;
