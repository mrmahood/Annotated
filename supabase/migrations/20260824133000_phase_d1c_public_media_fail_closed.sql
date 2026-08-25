-- Distinguish a true historical time-code annotation (no media row) from a
-- malformed published hosted row. The public loader rejects `unavailable`
-- without receiving any private lifecycle, path, or failure details.
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
  with candidate as (
    select
      annotations.id as annotation_id,
      media.id as media_id,
      media.media_type,
      media.processed_mime_type,
      media.duration_ms,
      media.width,
      media.height,
      media.byte_size,
      media.processing_status,
      media.removed_at,
      (
        media.processing_status = 'ready'
        and media.removed_at is null
        and media.processed_storage_path =
          profiles.id::text || '/' ||
          annotations.id::text || '/' ||
          media.id::text ||
          case
            when media.media_type = 'video' then '/excerpt.mp4'
            else '/excerpt.m4a'
          end
        and media.processed_mime_type = case
          when media.media_type = 'video' then 'video/mp4'
          else 'audio/mp4'
        end
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
      ) as is_ready
    from public.annotations
    join public.profiles on profiles.id = annotations.user_id
    join public.annotation_media as media on media.annotation_id = annotations.id
    where annotations.id = p_annotation_id
      and annotations.status = 'published'
  )
  select
    candidate.annotation_id,
    candidate.media_id,
    candidate.media_type,
    case
      when candidate.is_ready then 'ready'
      when candidate.processing_status = 'removed'
        and candidate.removed_at is not null then 'removed'
      else 'unavailable'
    end,
    case when candidate.is_ready then candidate.processed_mime_type end,
    case when candidate.is_ready then candidate.duration_ms end,
    case when candidate.is_ready then candidate.width end,
    case when candidate.is_ready then candidate.height end,
    case when candidate.is_ready then candidate.byte_size end
  from candidate
$$;

comment on function public.get_public_annotation_media_state(uuid) is
  'Path-free public ready/removed projection; malformed published hosted rows return only unavailable so they cannot masquerade as historical records.';

revoke all on function public.get_public_annotation_media_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_media_state(uuid)
  to anon, authenticated, service_role;
