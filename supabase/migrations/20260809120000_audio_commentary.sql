-- Optional audio commentary for otherwise unchanged article-text annotations.
-- The binary is uploaded first; this migration owns only public metadata and
-- the narrow transactional attachment path.

create table public.annotation_audio (
  annotation_id uuid primary key
    references public.annotations (id) on delete cascade,
  storage_path text not null unique,
  duration_ms integer not null,
  mime_type text not null,
  byte_size integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_audio_duration_check check (
    duration_ms between 1000 and 300000
  ),
  constraint annotation_audio_mime_type_check check (
    mime_type = 'audio/webm'
  ),
  constraint annotation_audio_byte_size_check check (
    byte_size between 1 and 6291456
  )
);

alter table public.annotation_audio enable row level security;

revoke all privileges on table public.annotation_audio
  from public, anon, authenticated, service_role;
grant select on table public.annotation_audio to anon, authenticated;
grant select, insert, update, delete on table public.annotation_audio to service_role;

create policy annotation_audio_published_read
on public.annotation_audio
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_audio.annotation_id
      and annotations.status = 'published'
  )
);

comment on table public.annotation_audio is
  'Immutable metadata for one optional WebM audio commentary attachment. Public visibility derives only from the published parent annotation.';
comment on policy annotation_audio_published_read on public.annotation_audio is
  'Audio metadata is public only while its parent annotation is published.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'annotation-audio',
  'annotation-audio',
  true,
  6291456,
  array['audio/webm']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy annotation_audio_objects_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'annotation-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy annotation_audio_objects_owner_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'annotation-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy annotation_audio_objects_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'annotation-audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

comment on policy annotation_audio_objects_owner_insert on storage.objects is
  'Authenticated users may upload only new annotation audio objects below their UUID folder; no UPDATE policy permits upsert.';
comment on policy annotation_audio_objects_owner_select on storage.objects is
  'Authenticated users may inspect only their own annotation audio objects, as required by the upload response and publishing verification.';
comment on policy annotation_audio_objects_owner_delete on storage.objects is
  'Authenticated users may remove only their own annotation audio objects, including compensating cleanup after a failed publish.';

-- This schema is intentionally absent from the Data API exposed-schema list.
-- Its helper can therefore perform the one privileged metadata insert without
-- granting browser clients direct INSERT access to annotation_audio.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.attach_annotation_audio(
  p_annotation_id uuid,
  p_storage_path text,
  p_duration_ms integer,
  p_mime_type text,
  p_byte_size integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  object_owner_id text;
  object_mime_type text;
  object_byte_size bigint;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to publish audio commentary.';
  end if;

  if not exists (
    select 1
    from public.annotations
    where annotations.id = p_annotation_id
      and annotations.user_id = caller_id
      and annotations.status = 'published'
  ) then
    raise exception using
      errcode = '42501',
      message = 'The annotation is not owned by the authenticated user.';
  end if;

  if p_storage_path is null
    or p_storage_path !~ (
      '^' || caller_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webm$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'The audio storage path must belong to the authenticated user.';
  end if;

  select
    objects.owner_id,
    pg_catalog.lower(pg_catalog.split_part(objects.metadata ->> 'mimetype', ';', 1)),
    case
      when (objects.metadata ->> 'size') ~ '^[0-9]+$'
        then (objects.metadata ->> 'size')::bigint
      else null
    end
  into object_owner_id, object_mime_type, object_byte_size
  from storage.objects
  where objects.bucket_id = 'annotation-audio'
    and objects.name = p_storage_path;

  if object_owner_id is null
    or object_owner_id <> caller_id::text
    or object_mime_type <> 'audio/webm'
    or object_byte_size is null
    or object_byte_size <> p_byte_size
    or object_byte_size > 6291456
  then
    raise exception using
      errcode = '22023',
      message = 'The uploaded audio object is unavailable or invalid.';
  end if;

  insert into public.annotation_audio (
    annotation_id,
    storage_path,
    duration_ms,
    mime_type,
    byte_size
  )
  values (
    p_annotation_id,
    p_storage_path,
    p_duration_ms,
    p_mime_type,
    p_byte_size
  );
end;
$$;

revoke all on function private.attach_annotation_audio(uuid, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function private.attach_annotation_audio(uuid, text, integer, text, integer)
  to authenticated;

create function public.publish_article_annotation_with_audio(
  p_normalized_url text,
  p_canonical_url text,
  p_page_title text,
  p_author text,
  p_publisher text,
  p_selected_text text,
  p_text_prefix text,
  p_text_suffix text,
  p_commentary_text text,
  p_storage_path text,
  p_audio_duration_ms integer,
  p_audio_mime_type text,
  p_audio_byte_size integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  annotation_id uuid;
  object_owner_id text;
  object_mime_type text;
  object_byte_size bigint;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to publish audio commentary.';
  end if;

  if p_storage_path is null
    or p_storage_path !~ (
      '^' || caller_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webm$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'The audio storage path must belong to the authenticated user.';
  end if;

  if p_audio_duration_ms is null or p_audio_duration_ms not between 1000 and 300000 then
    raise exception using
      errcode = '22023',
      message = 'Audio duration must be between 1 and 300 seconds.';
  end if;

  if p_audio_mime_type is distinct from 'audio/webm' then
    raise exception using
      errcode = '22023',
      message = 'Audio must use the audio/webm MIME type.';
  end if;

  if p_audio_byte_size is null or p_audio_byte_size not between 1 and 6291456 then
    raise exception using
      errcode = '22023',
      message = 'Audio size must be between 1 byte and 6 MiB.';
  end if;

  select
    objects.owner_id,
    pg_catalog.lower(pg_catalog.split_part(objects.metadata ->> 'mimetype', ';', 1)),
    case
      when (objects.metadata ->> 'size') ~ '^[0-9]+$'
        then (objects.metadata ->> 'size')::bigint
      else null
    end
  into object_owner_id, object_mime_type, object_byte_size
  from storage.objects
  where objects.bucket_id = 'annotation-audio'
    and objects.name = p_storage_path;

  if object_owner_id is null or object_owner_id <> caller_id::text then
    raise exception using
      errcode = '42501',
      message = 'The uploaded audio object is not owned by the authenticated user.';
  end if;

  if object_mime_type <> 'audio/webm'
    or object_byte_size is null
    or object_byte_size <> p_audio_byte_size
    or object_byte_size > 6291456
  then
    raise exception using
      errcode = '22023',
      message = 'The uploaded audio object metadata is invalid.';
  end if;

  annotation_id := public.publish_article_annotation(
    p_normalized_url,
    p_canonical_url,
    p_page_title,
    p_author,
    p_publisher,
    p_selected_text,
    p_text_prefix,
    p_text_suffix,
    p_commentary_text
  );

  perform private.attach_annotation_audio(
    annotation_id,
    p_storage_path,
    p_audio_duration_ms,
    p_audio_mime_type,
    p_audio_byte_size
  );

  return annotation_id;
end;
$$;

comment on function public.publish_article_annotation_with_audio(
  text, text, text, text, text, text, text, text, text,
  text, integer, text, integer
) is
  'Publishes the existing required article-text annotation and atomically attaches verified metadata for one already-uploaded owned WebM object. SECURITY INVOKER preserves existing annotation RLS.';

revoke all on function public.publish_article_annotation_with_audio(
  text, text, text, text, text, text, text, text, text,
  text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.publish_article_annotation_with_audio(
  text, text, text, text, text, text, text, text, text,
  text, integer, text, integer
) to authenticated;
