-- Phase F4: Matt-only media-only withdrawal, append-only moderation audit, and
-- transcript content-clear with non-sensitive metadata retention.
--
-- Locked owner policy encoded here:
-- - Operator identity is never client-supplied; this RPC is service-only.
-- - Default excerpt/copyright action is media-only; the annotation may stay published.
-- - Delete transcript TEXT/SEGMENTS; retain audit-safe metadata on the same row.
-- - No claimant/creator emails in audit rows or function results.
-- - Media withdrawal is forward-only: this RPC does not restore derivatives.
-- - Claims never auto-takedown; this function does not read or write votes.
-- - Empty search_path, schema-qualified names, no anon/authenticated/worker execute.

-- ---------------------------------------------------------------------------
-- Transcript content-clear contract (succeeds the historical hard DELETE)
-- ---------------------------------------------------------------------------

alter table public.annotation_transcripts
  add column content_cleared_at timestamptz;

comment on column public.annotation_transcripts.content_cleared_at is
  'Set when excerpt text and segments are purged for media-only withdrawal or cleanup. Provider/model/language metadata may remain; excerpt text must not.';

alter table public.annotation_transcripts
  alter column transcript_text drop not null;

alter table public.annotation_transcripts
  drop constraint annotation_transcripts_text_check;

alter table public.annotation_transcripts
  add constraint annotation_transcripts_content_state_check check (
    (
      content_cleared_at is null
      and transcript_text is not null
      and pg_catalog.btrim(transcript_text) <> ''
      and pg_catalog.char_length(transcript_text) <= 20000
    )
    or (
      content_cleared_at is not null
      and transcript_text is null
      and segments is null
      and provider_metadata = '{}'::jsonb
    )
  );

create function private.annotation_transcript_content_present(p_annotation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.annotation_transcripts as transcript
    where transcript.annotation_id = p_annotation_id
      and transcript.content_cleared_at is null
  );
$$;

comment on function private.annotation_transcript_content_present(uuid) is
  'True only when excerpt transcript content has not been purged. Used by cleanup eligibility and fail-closed public/signing checks.';

revoke all on function private.annotation_transcript_content_present(uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.annotation_transcript_content_present(uuid)
  to service_role;

create function private.clear_annotation_transcript_content(p_annotation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Phase F locked policy: purge excerpt text/segments and any provider payload
  -- that may contain transcript text. Keep language, provider, and model labels.
  update public.annotation_transcripts
  set
    transcript_text = null,
    segments = null,
    provider_metadata = '{}'::jsonb,
    content_cleared_at = coalesce(
      public.annotation_transcripts.content_cleared_at,
      pg_catalog.now()
    )
  where annotation_id = p_annotation_id
    and content_cleared_at is null;
  return found;
end;
$$;

comment on function private.clear_annotation_transcript_content(uuid) is
  'Clears excerpt transcript text and segments while retaining the row and audit-safe provider/model/language metadata. Does not restore content.';

revoke all on function private.clear_annotation_transcript_content(uuid)
  from public, anon, authenticated, annotated_media_worker;

-- ---------------------------------------------------------------------------
-- Append-only F4-minimal moderation audit (F3 may extend with more actions)
-- ---------------------------------------------------------------------------

create table private.moderation_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_id uuid not null references public.profiles (id),
  action text not null,
  reason_code text not null,
  annotation_id uuid not null references public.annotations (id),
  media_id uuid references public.annotation_media (id),
  claim_id uuid references public.claims (id),
  result_code text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint moderation_audit_action_check check (
    action in ('media_only_withdrawal')
  ),
  constraint moderation_audit_reason_code_check check (
    reason_code in ('copyright', 'excerpt_claim', 'operator_request')
  ),
  constraint moderation_audit_result_code_check check (
    result_code in ('withdrawn', 'already_withdrawn')
  )
);

create index moderation_audit_annotation_created_idx
  on private.moderation_audit (annotation_id, created_at desc);

create index moderation_audit_media_created_idx
  on private.moderation_audit (media_id, created_at desc)
  where media_id is not null;

comment on table private.moderation_audit is
  'Append-only operator audit. F4 writes media-only withdrawal rows. Never store claimant/creator emails, transcript text, signed URLs, or Storage paths.';

alter table private.moderation_audit enable row level security;
alter table private.moderation_audit force row level security;

revoke all privileges on table private.moderation_audit
  from public, anon, authenticated, service_role, annotated_media_worker;

create function private.reject_moderation_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Moderation audit rows are append-only.';
end;
$$;

revoke all on function private.reject_moderation_audit_mutation()
  from public, anon, authenticated, annotated_media_worker;

create trigger moderation_audit_reject_update
before update on private.moderation_audit
for each row execute function private.reject_moderation_audit_mutation();

create trigger moderation_audit_reject_delete
before delete on private.moderation_audit
for each row execute function private.reject_moderation_audit_mutation();

-- ---------------------------------------------------------------------------
-- Cleanup successor: eligibility uses uncleared content, confirmation clears
-- content instead of deleting the transcript row, and media hashes/duration/
-- dimensions remain as audit-safe metadata after Storage path removal.
-- ---------------------------------------------------------------------------

create or replace function private.list_annotation_media_reconciliation_candidates(
  p_limit integer default 100
)
returns table (media_id uuid, reconciliation_action text, attempt_count smallint, eligible_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Candidate limit must be between 1 and 500.';
  end if;
  return query
    select media.id,
      case
        when media.processing_status = 'processing' and (media.capture_metadata ->> 'version') is distinct from '2'
          then 'recapture_required'
        when media.processing_status = 'processing' and media.created_at <= pg_catalog.now() - interval '72 hours'
          then 'processing_deadline_exceeded'
        when media.processing_status = 'processing' and media.attempt_count >= 3
          then 'attempts_exhausted'
        when media.processing_status = 'processing' and media.lease_expires_at <= pg_catalog.now()
          then 'lease_expired'
        when media.processing_status = 'removed'
          then 'removed_cleanup'
        when media.processing_status in ('capture_pending', 'uploading')
          then 'abandoned_cleanup'
        when media.processing_status = 'failed'
          then 'terminal_raw_cleanup'
      end,
      media.attempt_count,
      case
        when media.processing_status = 'removed' then media.updated_at
        when media.processing_status in ('capture_pending', 'uploading') then media.updated_at + interval '24 hours'
        when media.processing_status = 'failed' then media.updated_at + interval '72 hours'
        else coalesce(media.lease_expires_at, media.created_at + interval '72 hours')
      end
    from public.annotation_media as media
    where (media.processing_status = 'processing' and (
        (media.capture_metadata ->> 'version') is distinct from '2'
        or media.created_at <= pg_catalog.now() - interval '72 hours'
        or media.attempt_count >= 3
        or media.lease_expires_at <= pg_catalog.now()
      ))
      or (media.processing_status in ('capture_pending', 'uploading')
        and media.updated_at <= pg_catalog.now() - interval '24 hours')
      or (media.processing_status = 'failed'
        and media.updated_at <= pg_catalog.now() - interval '72 hours'
        and (
          media.raw_storage_path is not null
          or media.processed_storage_path is not null
          or private.annotation_transcript_content_present(media.annotation_id)
        ))
      or (media.processing_status = 'removed' and (
        media.raw_storage_path is not null
        or media.processed_storage_path is not null
        or private.annotation_transcript_content_present(media.annotation_id)
      ))
    order by 4, media.id
    limit p_limit;
end;
$$;

revoke all on function private.list_annotation_media_reconciliation_candidates(integer)
  from public, anon, authenticated;
grant execute on function private.list_annotation_media_reconciliation_candidates(integer)
  to service_role, annotated_media_worker;

create or replace function private.claim_annotation_media_cleanup_v2(p_media_id uuid)
returns table (
  media_id uuid,
  cleanup_reason text,
  raw_storage_path text,
  processed_storage_path text,
  expected_processed_storage_path text,
  observed_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select media.id,
    case
      when media.processing_status = 'removed' then 'removed_cleanup'
      when media.processing_status in ('capture_pending', 'uploading') then 'abandoned_cleanup'
      else 'terminal_raw_cleanup'
    end,
    media.raw_storage_path,
    media.processed_storage_path,
    annotations.user_id::text || '/' || media.annotation_id::text || '/' || media.id::text ||
      case when media.media_type = 'video' then '/excerpt.mp4' else '/excerpt.m4a' end,
    media.updated_at
  from public.annotation_media as media
  join public.annotations as annotations on annotations.id = media.annotation_id
  where media.id = p_media_id
    and (
      (media.processing_status in ('capture_pending', 'uploading')
        and media.updated_at <= pg_catalog.now() - interval '24 hours')
      or (media.processing_status = 'failed'
        and media.updated_at <= pg_catalog.now() - interval '72 hours'
        and (
          media.raw_storage_path is not null
          or media.processed_storage_path is not null
          or private.annotation_transcript_content_present(media.annotation_id)
        ))
      or (media.processing_status = 'removed' and (
        media.raw_storage_path is not null
        or media.processed_storage_path is not null
        or private.annotation_transcript_content_present(media.annotation_id)
      ))
    )
  for update of media;
end;
$$;

revoke all on function private.claim_annotation_media_cleanup_v2(uuid)
  from public, anon, authenticated;
grant execute on function private.claim_annotation_media_cleanup_v2(uuid)
  to service_role, annotated_media_worker;

create or replace function private.confirm_annotation_media_cleanup(
  p_media_id uuid,
  p_expected_raw_storage_path text,
  p_expected_processed_storage_path text,
  p_observed_updated_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_row public.annotation_media%rowtype;
begin
  select * into media_row
  from public.annotation_media
  where id = p_media_id
  for update;
  if not found
    or media_row.updated_at is distinct from p_observed_updated_at
    or media_row.raw_storage_path is distinct from p_expected_raw_storage_path
    or media_row.processed_storage_path is distinct from p_expected_processed_storage_path
    or not (
      (media_row.processing_status in ('capture_pending', 'uploading')
        and media_row.updated_at <= pg_catalog.now() - interval '24 hours')
      or (media_row.processing_status = 'failed'
        and media_row.updated_at <= pg_catalog.now() - interval '72 hours'
        and (
          media_row.raw_storage_path is not null
          or media_row.processed_storage_path is not null
          or private.annotation_transcript_content_present(media_row.annotation_id)
        ))
      or (media_row.processing_status = 'removed' and (
        media_row.raw_storage_path is not null
        or media_row.processed_storage_path is not null
        or private.annotation_transcript_content_present(media_row.annotation_id)
      ))
    )
  then
    raise exception using errcode = '55000', message = 'The cleanup claim is stale or unavailable.';
  end if;

  perform private.clear_annotation_transcript_content(media_row.annotation_id);
  update public.annotation_media
  set processing_status = 'removed', processing_stage = null,
    raw_storage_path = null, raw_mime_type = null, raw_byte_size = null,
    raw_checksum_sha256 = null,
    processed_storage_path = null, processed_mime_type = null,
    raw_deleted_at = case when media_row.raw_storage_path is not null
      then pg_catalog.now() else media_row.raw_deleted_at end,
    removed_at = coalesce(media_row.removed_at, pg_catalog.now()),
    next_attempt_at = null, lease_token = null, lease_expires_at = null
  where id = p_media_id;
  return 'removed';
end;
$$;

comment on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz) is
  'Stale-guarded cleanup confirmation that clears private Storage references and transcript content while retaining transcript and media audit metadata.';

revoke all on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  to service_role, annotated_media_worker;

-- Worker finalize must not publish after transcript content is purged.
create or replace function private.finalize_annotation_media_ready(
  p_media_id uuid,
  p_lease_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_annotation_id uuid;
begin
  update public.annotation_media as media
  set
    processing_status = 'ready',
    processing_stage = null,
    next_attempt_at = null,
    failure_stage = null,
    failure_code = null,
    lease_token = null,
    lease_expires_at = null
  where media.id = p_media_id
    and media.processing_status = 'processing'
    and media.processing_stage = 'finalizing'
    and media.lease_token = p_lease_token
    and media.raw_storage_path is null
    and media.raw_deleted_at is not null
    and media.processed_storage_path is not null
    and media.processed_mime_type is not null
    and media.duration_ms between 1000 and 90000
    and media.byte_size is not null
    and media.checksum_sha256 is not null
    and media.processed_at is not null
    and private.annotation_transcript_content_present(media.annotation_id)
  returning media.annotation_id into v_annotation_id;

  if v_annotation_id is null then
    raise exception using errcode = '55000', message = 'Hosted media is not ready for atomic publication.';
  end if;

  update public.annotations
  set
    status = 'published',
    published_at = pg_catalog.now()
  where id = v_annotation_id
    and status = 'draft';

  if not found then
    raise exception using errcode = '55000', message = 'The hosted annotation is not a publishable draft.';
  end if;

  return v_annotation_id;
end;
$$;

revoke all on function private.finalize_annotation_media_ready(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.finalize_annotation_media_ready(uuid, uuid)
  to service_role, annotated_media_worker;

-- ---------------------------------------------------------------------------
-- Fail-closed public/signing surfaces: ready requires uncleared transcript
-- content. Removal still fails closed via processing_status/removed_at.
-- ---------------------------------------------------------------------------

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
        and private.annotation_transcript_content_present(annotations.id)
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
  'Path-free public ready/removed projection; ready requires uncleared transcript content, and malformed published hosted rows return only unavailable.';

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
    and private.annotation_transcript_content_present(annotations.id)
$$;

comment on function public.get_annotation_media_delivery(uuid) is
  'Service-only exact-path derivation after fresh published/ready/raw-deleted/uncleared-transcript validation. Removed media cannot mint a path.';

revoke all on function public.get_annotation_media_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_annotation_media_delivery(uuid)
  to service_role;

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
    and transcripts.content_cleared_at is null
    and transcripts.transcript_text is not null
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
  'Returns only excerpt text, language, and bounded relative segments for the exact published ready derivative; purged transcript content is never returned.';

revoke all on function public.get_public_annotation_transcript(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_annotation_transcript(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service-only media-only withdrawal
-- ---------------------------------------------------------------------------

create function private.moderate_media_only_withdrawal(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_media_id uuid,
  p_reason_code text,
  p_claim_id uuid default null
)
returns table (
  annotation_id uuid,
  media_id uuid,
  claim_id uuid,
  reason_code text,
  result_code text,
  removed_at timestamptz,
  audit_id uuid,
  annotation_status text,
  processing_status text,
  transcript_content_cleared boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
declare
  annotation_row public.annotations%rowtype;
  media_row public.annotation_media%rowtype;
  claim_row public.claims%rowtype;
  existing_audit private.moderation_audit%rowtype;
  inserted_audit private.moderation_audit%rowtype;
  content_was_present boolean;
  linked_claim_id uuid;
  result text;
begin
  -- Votes, follows, and comments are intentionally unread. Claims never
  -- auto-takedown; a claim_id is an optional confidential link only.
  if p_actor_id is null
    or p_annotation_id is null
    or p_media_id is null
    or p_reason_code is null
    or p_reason_code not in ('copyright', 'excerpt_claim', 'operator_request')
  then
    raise exception using
      errcode = '22023',
      message = 'The moderation request is invalid.';
  end if;

  if not exists (
    select 1 from public.profiles as profiles where profiles.id = p_actor_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'The moderation request is invalid.';
  end if;

  -- RETURNS TABLE columns become PL/pgSQL variables. Always alias tables and
  -- qualify columns so names like annotation_id/media_id/removed_at cannot
  -- collide with annotation_media, claims, or moderation_audit.
  select annotations.* into annotation_row
  from public.annotations as annotations
  where annotations.id = p_annotation_id
  for update;
  if not found or annotation_row.status is distinct from 'published' then
    raise exception using
      errcode = '55000',
      message = 'Media-only withdrawal is not available.';
  end if;

  select media.* into media_row
  from public.annotation_media as media
  where media.id = p_media_id
    and media.annotation_id = p_annotation_id
  for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Media-only withdrawal is not available.';
  end if;

  if p_claim_id is not null then
    select claims.* into claim_row
    from public.claims as claims
    where claims.id = p_claim_id
    for update;
    if not found or claim_row.annotation_id is distinct from p_annotation_id then
      raise exception using
        errcode = '55000',
        message = 'Media-only withdrawal is not available.';
    end if;
  end if;

  perform 1
  from public.annotation_transcripts as transcripts
  where transcripts.annotation_id = p_annotation_id
  for update;

  content_was_present := private.annotation_transcript_content_present(p_annotation_id);

  if media_row.processing_status = 'ready' and media_row.removed_at is null then
    result := 'withdrawn';
  elsif media_row.processing_status = 'removed' and media_row.removed_at is not null then
    if content_was_present then
      result := 'withdrawn';
    else
      result := 'already_withdrawn';
    end if;
  else
    raise exception using
      errcode = '55000',
      message = 'Media-only withdrawal is not available.';
  end if;

  if result = 'already_withdrawn' then
    select audit.* into existing_audit
    from private.moderation_audit as audit
    where audit.media_id = p_media_id
      and audit.action = 'media_only_withdrawal'
    order by audit.created_at desc
    limit 1;

    annotation_id := annotation_row.id;
    media_id := media_row.id;
    claim_id := media_row.removal_claim_id;
    reason_code := p_reason_code;
    result_code := 'already_withdrawn';
    removed_at := media_row.removed_at;
    audit_id := existing_audit.id;
    annotation_status := annotation_row.status;
    processing_status := media_row.processing_status;
    transcript_content_cleared := not private.annotation_transcript_content_present(p_annotation_id);
    return next;
    return;
  end if;

  linked_claim_id := coalesce(media_row.removal_claim_id, p_claim_id);

  update public.annotation_media as media
  set
    processing_status = 'removed',
    processing_stage = null,
    removed_at = coalesce(media.removed_at, pg_catalog.now()),
    removal_claim_id = linked_claim_id,
    next_attempt_at = null,
    lease_token = null,
    lease_expires_at = null
  where media.id = p_media_id
  returning media.* into media_row;

  perform private.clear_annotation_transcript_content(p_annotation_id);

  insert into private.moderation_audit as audit (
    actor_id, action, reason_code, annotation_id, media_id, claim_id, result_code
  ) values (
    p_actor_id,
    'media_only_withdrawal',
    p_reason_code,
    annotation_row.id,
    media_row.id,
    linked_claim_id,
    'withdrawn'
  )
  returning audit.* into inserted_audit;

  annotation_id := annotation_row.id;
  media_id := media_row.id;
  claim_id := linked_claim_id;
  reason_code := p_reason_code;
  result_code := 'withdrawn';
  removed_at := media_row.removed_at;
  audit_id := inserted_audit.id;
  annotation_status := annotation_row.status;
  processing_status := media_row.processing_status;
  transcript_content_cleared := not private.annotation_transcript_content_present(p_annotation_id);
  return next;
end;
$$;

comment on function private.moderate_media_only_withdrawal(uuid, uuid, uuid, text, uuid) is
  'Service-only media-only withdrawal. Locks published annotation/media/(optional) claim, sets media removed, clears transcript content, writes append-only audit, and leaves the annotation published. Does not restore derivatives, send email, or read votes.';

revoke all on function private.moderate_media_only_withdrawal(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.moderate_media_only_withdrawal(uuid, uuid, uuid, text, uuid)
  to service_role;

create function public.moderate_media_only_withdrawal(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_media_id uuid,
  p_reason_code text,
  p_claim_id uuid default null
)
returns table (
  annotation_id uuid,
  media_id uuid,
  claim_id uuid,
  reason_code text,
  result_code text,
  removed_at timestamptz,
  audit_id uuid,
  annotation_status text,
  processing_status text,
  transcript_content_cleared boolean
)
language sql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
  select *
  from private.moderate_media_only_withdrawal(
    p_actor_id,
    p_annotation_id,
    p_media_id,
    p_reason_code,
    p_claim_id
  );
$$;

comment on function public.moderate_media_only_withdrawal(uuid, uuid, uuid, text, uuid) is
  'Trusted-server wrapper for private.moderate_media_only_withdrawal. Execute is service_role only; PostgREST does not expose the private schema.';

revoke all on function public.moderate_media_only_withdrawal(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.moderate_media_only_withdrawal(uuid, uuid, uuid, text, uuid)
  to service_role;
