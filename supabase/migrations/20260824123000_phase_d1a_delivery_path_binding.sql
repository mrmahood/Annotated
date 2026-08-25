-- Phase D1a forward correction: fail closed unless a ready derivative's stored
-- path is exactly bound to the authoritative owner, annotation, media, and type.
-- Migration 20260824120000 is already applied to Local and remains immutable.

create or replace function public.get_public_annotation_media_state(
  p_annotation_id uuid
)
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
        and media.processed_storage_path =
          annotations.user_id::text || '/' ||
          annotations.id::text || '/' ||
          media.id::text ||
          case
            when media.media_type = 'video' then '/excerpt.mp4'
            else '/excerpt.m4a'
          end
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
  'Path-free public ready/removed projection; ready additionally requires exact deterministic processed-path binding and complete public readiness facts.';
revoke all on function public.get_public_annotation_media_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_media_state(uuid)
  to anon, authenticated, service_role;

create or replace function public.get_annotation_media_delivery(
  p_annotation_id uuid
)
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
    and media.processed_storage_path =
      annotations.user_id::text || '/' ||
      annotations.id::text || '/' ||
      media.id::text ||
      case
        when media.media_type = 'video' then '/excerpt.mp4'
        else '/excerpt.m4a'
      end
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
  'Service-only exact-path derivation after fresh published/ready/raw-deleted/transcript validation and deterministic owner/annotation/media path binding.';
revoke all on function public.get_annotation_media_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_annotation_media_delivery(uuid)
  to service_role;
