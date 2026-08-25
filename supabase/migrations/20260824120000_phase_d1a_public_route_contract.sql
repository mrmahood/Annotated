-- Phase D1a: complete creator-scoped public route identity and add bounded
-- route/media projections. This migration does not add a page, redirect, signed
-- URL, public Storage policy, or vote behavior.

create function private.get_annotation_route_integrity_report()
returns table (
  published_annotation_count bigint,
  published_missing_slug_count bigint,
  published_creator_missing_handle_count bigint,
  current_alias_collision_count bigint,
  published_route_collision_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with published as (
    select annotations.id, annotations.user_id, annotations.slug, profiles.username
    from public.annotations
    join public.profiles on profiles.id = annotations.user_id
    where annotations.status = 'published'
  ),
  current_alias_collisions as (
    select profiles.id
    from public.profiles
    join public.profile_handle_aliases
      on profile_handle_aliases.handle = pg_catalog.lower(profiles.username)
  ),
  published_route_collisions as (
    select pg_catalog.lower(published.username), published.slug
    from published
    where published.username is not null
      and published.slug is not null
    group by pg_catalog.lower(published.username), published.slug
    having pg_catalog.count(*) > 1
  )
  select
    (select pg_catalog.count(*) from published),
    (select pg_catalog.count(*) from published where published.slug is null),
    (
      select pg_catalog.count(distinct published.user_id)
      from published
      where published.username is null
    ),
    (select pg_catalog.count(*) from current_alias_collisions),
    (select pg_catalog.count(*) from published_route_collisions)
$$;

comment on function private.get_annotation_route_integrity_report() is
  'Service-only bounded counts for missing or colliding public annotation route identity; returns no handles, slugs, URLs, or private row data.';
revoke all on function private.get_annotation_route_integrity_report()
  from public, anon, authenticated, service_role;
grant execute on function private.get_annotation_route_integrity_report()
  to service_role;

create function private.backfill_published_annotation_routes()
returns table (
  creator_handles_created bigint,
  annotation_slugs_created bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  creator_record record;
  annotation_record record;
  route_seed text;
  route_fallback text;
begin
  creator_handles_created := 0;
  annotation_slugs_created := 0;

  -- Match the existing handle RPC lock order, then prevent publication/route
  -- writes from racing the finite completion scan.
  perform pg_catalog.pg_advisory_xact_lock(19020301);
  lock table public.profiles in share row exclusive mode;
  lock table public.profile_handle_aliases in share row exclusive mode;
  lock table public.annotations in share row exclusive mode;

  for creator_record in
    select distinct annotations.user_id
    from public.annotations
    join public.profiles on profiles.id = annotations.user_id
    where annotations.status = 'published'
      and profiles.username is null
    order by annotations.user_id
  loop
    perform private.ensure_profile_handle(creator_record.user_id);
    creator_handles_created := creator_handles_created + 1;
  end loop;

  for annotation_record in
    select
      annotations.id,
      annotations.user_id,
      annotations.annotation_type,
      sources.title,
      sources.author,
      sources.publisher,
      sources.canonical_url,
      sources.metadata
    from public.annotations
    join public.sources on sources.id = annotations.source_id
    where annotations.status = 'published'
      and annotations.slug is null
    order by annotations.id
  loop
    route_seed := coalesce(
      nullif(pg_catalog.btrim(annotation_record.title), ''),
      nullif(pg_catalog.btrim(annotation_record.metadata ->> 'show_name'), ''),
      nullif(
        (pg_catalog.regexp_match(
          annotation_record.canonical_url,
          '^https?://([^/?#]+)'
        ))[1],
        ''
      ),
      nullif(pg_catalog.btrim(annotation_record.publisher), ''),
      nullif(pg_catalog.btrim(annotation_record.author), '')
    );
    route_fallback := case annotation_record.annotation_type
      when 'article_text' then 'article'
      when 'video_clip' then 'youtube-clip'
      when 'audio_clip' then 'audio-clip'
      else 'annotation'
    end;

    update public.annotations
    set slug = private.generate_annotation_slug(
      annotation_record.user_id,
      annotation_record.id,
      route_seed,
      route_fallback
    )
    where id = annotation_record.id
      and slug is null;

    if found then
      annotation_slugs_created := annotation_slugs_created + 1;
    end if;
  end loop;

  return next;
end;
$$;

comment on function private.backfill_published_annotation_routes() is
  'Service-only idempotent completion of deterministic handles and immutable creator-scoped slugs for published annotations.';
revoke all on function private.backfill_published_annotation_routes()
  from public, anon, authenticated, service_role;
grant execute on function private.backfill_published_annotation_routes()
  to service_role;

-- Acquire the same lock boundary used by the backfill before recording the
-- migration preflight. Notices contain counts only and are safe for migration
-- evidence; collision or incomplete-route counts abort the transaction.
do $$
declare
  before_report record;
  backfill_result record;
  after_report record;
begin
  perform pg_catalog.pg_advisory_xact_lock(19020301);
  lock table public.profiles in share row exclusive mode;
  lock table public.profile_handle_aliases in share row exclusive mode;
  lock table public.annotations in share row exclusive mode;

  select * into before_report
  from private.get_annotation_route_integrity_report();

  raise notice 'Phase D1a route preflight: published=%, missing_slugs=%, missing_creator_handles=%, current_alias_collisions=%, route_collisions=%',
    before_report.published_annotation_count,
    before_report.published_missing_slug_count,
    before_report.published_creator_missing_handle_count,
    before_report.current_alias_collision_count,
    before_report.published_route_collision_count;

  if before_report.current_alias_collision_count <> 0
    or before_report.published_route_collision_count <> 0
  then
    raise exception using
      errcode = '23505',
      message = 'Published route identity contains a handle or slug collision.';
  end if;

  select * into backfill_result
  from private.backfill_published_annotation_routes();

  select * into after_report
  from private.get_annotation_route_integrity_report();

  if after_report.published_missing_slug_count <> 0
    or after_report.published_creator_missing_handle_count <> 0
    or after_report.current_alias_collision_count <> 0
    or after_report.published_route_collision_count <> 0
  then
    raise exception using
      errcode = '23514',
      message = 'Published route identity completion did not reach a safe state.';
  end if;

  raise notice 'Phase D1a route completion: creator_handles_created=%, annotation_slugs_created=%, published=%, missing_slugs=%, missing_creator_handles=%, current_alias_collisions=%, route_collisions=%',
    backfill_result.creator_handles_created,
    backfill_result.annotation_slugs_created,
    after_report.published_annotation_count,
    after_report.published_missing_slug_count,
    after_report.published_creator_missing_handle_count,
    after_report.current_alias_collision_count,
    after_report.published_route_collision_count;
end;
$$;

create function private.ensure_annotation_public_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record record;
  route_seed text;
  route_fallback text;
  creator_handle text;
begin
  if new.status <> 'published' then
    return new;
  end if;

  creator_handle := private.ensure_profile_handle(new.user_id);
  if creator_handle is null then
    raise exception using
      errcode = '23514',
      message = 'A published annotation requires a creator handle.';
  end if;

  if new.slug is null then
    select
      sources.title,
      sources.author,
      sources.publisher,
      sources.canonical_url,
      sources.metadata
    into source_record
    from public.sources
    where sources.id = new.source_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'A published annotation requires an existing source.';
    end if;

    route_seed := coalesce(
      nullif(pg_catalog.btrim(source_record.title), ''),
      nullif(pg_catalog.btrim(source_record.metadata ->> 'show_name'), ''),
      nullif(
        (pg_catalog.regexp_match(
          source_record.canonical_url,
          '^https?://([^/?#]+)'
        ))[1],
        ''
      ),
      nullif(pg_catalog.btrim(source_record.publisher), ''),
      nullif(pg_catalog.btrim(source_record.author), '')
    );
    route_fallback := case new.annotation_type
      when 'article_text' then 'article'
      when 'video_clip' then 'youtube-clip'
      when 'audio_clip' then 'audio-clip'
      else 'annotation'
    end;
    new.slug := private.generate_annotation_slug(
      new.user_id,
      new.id,
      route_seed,
      route_fallback
    );
  end if;

  if new.slug is null then
    raise exception using
      errcode = '23514',
      message = 'A published annotation requires a canonical slug.';
  end if;

  return new;
end;
$$;

comment on function private.ensure_annotation_public_route() is
  'Trigger-only route guard that deterministically completes a creator handle and immutable creator-scoped slug before publication.';
revoke all on function private.ensure_annotation_public_route()
  from public, anon, authenticated, service_role;

create trigger annotations_ensure_public_route
before insert or update of status on public.annotations
for each row execute function private.ensure_annotation_public_route();

alter table public.annotations
  add constraint annotations_published_slug_check check (
    status <> 'published' or slug is not null
  ) not valid;
alter table public.annotations
  validate constraint annotations_published_slug_check;

comment on constraint annotations_published_slug_check on public.annotations is
  'Every published annotation has immutable creator-scoped route identity; private historical drafts may remain unrouted.';

create function public.resolve_public_annotation_route(
  p_creator_handle text,
  p_annotation_slug text
)
returns table (
  annotation_id uuid,
  current_creator_handle text,
  annotation_slug text,
  matched_handle_is_alias boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_profile as (
    select
      profiles.id as profile_id,
      profiles.username as current_handle,
      false as matched_alias
    from public.profiles
    where profiles.username = p_creator_handle
      and p_creator_handle = pg_catalog.lower(pg_catalog.btrim(p_creator_handle))
      and p_creator_handle ~ '^[a-z0-9_-]{3,30}$'

    union all

    select
      profiles.id,
      profiles.username,
      true
    from public.profile_handle_aliases
    join public.profiles on profiles.id = profile_handle_aliases.profile_id
    where profile_handle_aliases.handle = p_creator_handle
      and profiles.username is not null
      and p_creator_handle = pg_catalog.lower(pg_catalog.btrim(p_creator_handle))
      and p_creator_handle ~ '^[a-z0-9_-]{3,30}$'
  ),
  selected_profile as (
    select
      requested_profile.profile_id,
      requested_profile.current_handle,
      requested_profile.matched_alias
    from requested_profile
    order by requested_profile.matched_alias
    limit 1
  )
  select
    annotations.id,
    selected_profile.current_handle,
    annotations.slug,
    selected_profile.matched_alias
  from selected_profile
  join public.annotations on annotations.user_id = selected_profile.profile_id
  where p_annotation_slug = pg_catalog.lower(pg_catalog.btrim(p_annotation_slug))
    and p_annotation_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and pg_catalog.char_length(p_annotation_slug) between 3 and 100
    and annotations.slug = p_annotation_slug
    and annotations.status = 'published'
$$;

comment on function public.resolve_public_annotation_route(text, text) is
  'Resolves one current or reserved creator handle plus creator-scoped slug only when the annotation is public; returns no private state.';
revoke all on function public.resolve_public_annotation_route(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_public_annotation_route(text, text)
  to anon, authenticated, service_role;

create function public.resolve_public_annotation_uuid(p_annotation_id uuid)
returns table (
  annotation_id uuid,
  current_creator_handle text,
  annotation_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select annotations.id, profiles.username, annotations.slug
  from public.annotations
  join public.profiles on profiles.id = annotations.user_id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and annotations.slug is not null
    and profiles.username is not null
$$;

comment on function public.resolve_public_annotation_uuid(uuid) is
  'Returns only the current canonical route identity for one published UUID compatibility request.';
revoke all on function public.resolve_public_annotation_uuid(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_public_annotation_uuid(uuid)
  to anon, authenticated, service_role;

create function public.get_public_annotation_media_state(p_annotation_id uuid)
returns table (
  annotation_id uuid,
  media_id uuid,
  media_type text,
  availability text,
  mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  byte_size bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    annotations.id,
    media.id,
    media.media_type,
    case
      when media.processing_status = 'ready' then 'ready'
      else 'removed'
    end,
    case when media.processing_status = 'ready' then media.processed_mime_type end,
    case when media.processing_status = 'ready' then media.duration_ms end,
    case when media.processing_status = 'ready' then media.width end,
    case when media.processing_status = 'ready' then media.height end,
    case when media.processing_status = 'ready' then media.byte_size end
  from public.annotations
  join public.annotation_media as media on media.annotation_id = annotations.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and (
      (
        media.processing_status = 'ready'
        and media.removed_at is null
        and media.processed_storage_path is not null
        and media.processed_mime_type is not null
        and media.duration_ms between 1000 and 90000
        and media.byte_size is not null
        and media.checksum_sha256 is not null
        and media.raw_storage_path is null
        and media.raw_deleted_at is not null
        and media.processed_at is not null
        and (
          media.media_type = 'audio'
          or (media.width is not null and media.height is not null)
        )
        and exists (
          select 1
          from public.annotation_transcripts
          where annotation_transcripts.annotation_id = annotations.id
        )
      )
      or (
        media.processing_status = 'removed'
        and media.removed_at is not null
      )
    )
$$;

comment on function public.get_public_annotation_media_state(uuid) is
  'Path-free public ready/removed projection for a published hosted annotation; operational and provider fields remain private.';
revoke all on function public.get_public_annotation_media_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_media_state(uuid)
  to anon, authenticated, service_role;

create function public.get_annotation_media_delivery(p_annotation_id uuid)
returns table (
  annotation_id uuid,
  media_id uuid,
  processed_storage_path text,
  mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  byte_size bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    annotations.id,
    media.id,
    media.processed_storage_path,
    media.processed_mime_type,
    media.duration_ms,
    media.width,
    media.height,
    media.byte_size
  from public.annotations
  join public.annotation_media as media on media.annotation_id = annotations.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and media.processing_status = 'ready'
    and media.removed_at is null
    and media.processed_storage_path is not null
    and media.processed_mime_type is not null
    and media.duration_ms between 1000 and 90000
    and media.byte_size is not null
    and media.checksum_sha256 is not null
    and media.raw_storage_path is null
    and media.raw_deleted_at is not null
    and media.processed_at is not null
    and (
      media.media_type = 'audio'
      or (media.width is not null and media.height is not null)
    )
    and exists (
      select 1
      from public.annotation_transcripts
      where annotation_transcripts.annotation_id = annotations.id
    )
$$;

comment on function public.get_annotation_media_delivery(uuid) is
  'Service-only derivation of the exact processed private path after a fresh published/ready/raw-deleted/transcript validation.';
revoke all on function public.get_annotation_media_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_annotation_media_delivery(uuid)
  to service_role;
