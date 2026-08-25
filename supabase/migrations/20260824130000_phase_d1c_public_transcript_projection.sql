-- Harden the pre-existing transcript projection so public transcript text is
-- available only for the same exact, path-bound ready derivative accepted by
-- the D1a public media-state and service delivery contracts.
create or replace function public.get_public_annotation_transcript(
  p_annotation_id uuid
)
returns table (
  annotation_id uuid,
  transcript_text text,
  language text,
  segments jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    transcripts.annotation_id,
    transcripts.transcript_text,
    transcripts.language,
    transcripts.segments
  from public.annotation_transcripts as transcripts
  join public.annotations
    on annotations.id = transcripts.annotation_id
  join public.profiles
    on profiles.id = annotations.user_id
  join public.annotation_media as media
    on media.annotation_id = annotations.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published'
    and media.processing_status = 'ready'
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
    and private.is_valid_transcript_segments(transcripts.segments)
    and (
      transcripts.segments is null
      or not exists (
        select 1
        from pg_catalog.jsonb_array_elements(transcripts.segments) as segment(value)
        where (segment.value ->> 'end_ms')::integer > media.duration_ms
      )
    )
$$;

comment on function public.get_public_annotation_transcript(uuid) is
  'Returns only excerpt text, language, and bounded relative segments for the exact published ready derivative; provider and Storage data remain private.';

revoke all on function public.get_public_annotation_transcript(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_transcript(uuid)
  to anon, authenticated, service_role;
