-- Phase F3: Matt-only annotation hide/unhide with append-only audit.
--
-- Locked owner policy encoded here:
-- - Operator identity is never client-supplied; these RPCs are service-only.
-- - Hide: published → hidden. Unhide: hidden → published with a NEW audit row.
-- - No public appeals. Media-only withdrawal remains forward-only: unhide does
--   not rebuild deleted derivatives or restore cleared transcript content.
-- - If media is already removed, unhide still leaves media removed (the accepted
--   published page with unavailable excerpt).
-- - Claims never auto-takedown; optional claim_id is a confidential audit link.
-- - Votes never moderate: these functions do not read or write vote rows,
--   totals, or rate-limit state.
-- - No claimant/creator email workflows.
-- - F5 full-record remove is out of scope. F4 media-only withdrawal is not
--   reimplemented.
-- - Empty search_path, schema-qualified names, no anon/authenticated/worker
--   execute.
--
-- Reason codes (closed set, consistent with F4/F2 plus hide escalation):
--   operator_request  — Matt-initiated hide/unhide without a claim
--   copyright         — copyright concern requiring hide (not media-only)
--   excerpt_claim     — excerpt/copyright claim escalated to hide
--   commentary        — commentary itself is the problem (plan §2 decision 6)
--   claim_review      — retained from F2; not used by hide/unhide
--
-- Result codes:
--   hidden / already_hidden     — hide (idempotent retry mirrors F4)
--   unhidden / already_published — unhide (idempotent retry; new audit only
--                                  on an actual hidden → published write)
--
-- Illegal transitions raise 55000 (hide from draft/removed/claim_pending;
-- unhide from draft/removed/claim_pending). Invalid inputs raise 22023.

-- ---------------------------------------------------------------------------
-- Extend append-only F4/F2 audit for hide/unhide. Same table; new values.
-- ---------------------------------------------------------------------------

alter table private.moderation_audit
  drop constraint moderation_audit_action_check;

alter table private.moderation_audit
  add constraint moderation_audit_action_check check (
    action in (
      'media_only_withdrawal',
      'claim_review',
      'annotation_hide',
      'annotation_unhide'
    )
  );

alter table private.moderation_audit
  drop constraint moderation_audit_reason_code_check;

alter table private.moderation_audit
  add constraint moderation_audit_reason_code_check check (
    reason_code in (
      'copyright',
      'excerpt_claim',
      'operator_request',
      'claim_review',
      'commentary'
    )
  );

alter table private.moderation_audit
  drop constraint moderation_audit_result_code_check;

alter table private.moderation_audit
  add constraint moderation_audit_result_code_check check (
    result_code in (
      'withdrawn',
      'already_withdrawn',
      'reviewing',
      'resolved',
      'rejected',
      'hidden',
      'already_hidden',
      'unhidden',
      'already_published'
    )
  );

comment on table private.moderation_audit is
  'Append-only operator audit. F4 writes media-only withdrawal rows. F2 writes claim_review rows. F3 writes annotation_hide and annotation_unhide rows. Never store claimant/creator emails, transcript text, signed URLs, or Storage paths.';

-- ---------------------------------------------------------------------------
-- Clients cannot hide, unhide, or edit hidden/removed rows.
-- Service-role RPCs bypass RLS. Existing owner draft/published updates remain.
-- ---------------------------------------------------------------------------

drop policy if exists annotations_owner_update on public.annotations;

create policy annotations_owner_update
on public.annotations
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and status not in ('hidden', 'removed')
)
with check (
  (select auth.uid()) = user_id
  and status not in ('hidden', 'removed')
);

comment on policy annotations_owner_update on public.annotations is
  'Only the owner may update an annotation they still control. Hidden and removed records are operator-only; clients cannot hide, unhide, remove, or edit those rows. The owner cannot transfer ownership by changing user_id.';

-- ---------------------------------------------------------------------------
-- Unhide media policy: ready (unchanged) or F4-removed. Never restore content.
-- ---------------------------------------------------------------------------

create function private.hosted_media_allows_published_return(p_annotation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1
      from public.annotation_media as media
      where media.annotation_id = p_annotation_id
    )
    or exists (
      select 1
      from public.annotation_media as media
      where media.annotation_id = p_annotation_id
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
          from public.annotation_transcripts as transcripts
          where transcripts.annotation_id = p_annotation_id
        )
    )
    or exists (
      select 1
      from public.annotation_media as media
      where media.annotation_id = p_annotation_id
        and media.processing_status = 'removed'
        and media.removed_at is not null
    );
$$;

comment on function private.hosted_media_allows_published_return(uuid) is
  'True when a previously published hosted annotation may return to published: no media row (grandfathered time-code), ready media with a transcript row, or F4-removed media. Does not restore derivatives or transcript content.';

revoke all on function private.hosted_media_allows_published_return(uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.hosted_media_allows_published_return(uuid)
  to service_role;

-- Allow hidden → published when media is ready or already removed. First
-- publication (draft → published) still requires ready media and a transcript.
create or replace function private.guard_hosted_annotation_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hosted_media_id uuid;
begin
  if new.annotation_type not in ('video_clip', 'audio_clip')
    or new.status <> 'published'
    or (tg_op = 'UPDATE' and old.status = 'published')
  then
    return new;
  end if;

  select annotation_media.id
  into hosted_media_id
  from public.annotation_media
  where annotation_media.annotation_id = new.id;

  -- A media annotation without an annotation_media row is the grandfathered
  -- time-code-only workflow. Hosted rows are always draft-first and guarded.
  if hosted_media_id is null then
    return new;
  end if;

  if new.commentary_text is null
    or pg_catalog.btrim(new.commentary_text) = ''
    or pg_catalog.char_length(new.commentary_text) > 2000
  then
    raise exception using
      errcode = '23514',
      message = 'Required commentary must be present before hosted publication.';
  end if;

  -- F3 unhide: hidden → published may keep F4-removed media. Do not rebuild
  -- derivatives or restore cleared transcript content.
  if tg_op = 'UPDATE' and old.status = 'hidden' then
    if not private.hosted_media_allows_published_return(new.id) then
      raise exception using
        errcode = '23514',
        message = 'Hosted media must be ready or already removed before an annotation can return to published.';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.annotation_media
    where annotation_media.id = hosted_media_id
      and annotation_media.processing_status = 'ready'
      and annotation_media.processed_storage_path is not null
      and annotation_media.processed_mime_type is not null
      and annotation_media.duration_ms between 1000 and 90000
      and annotation_media.byte_size is not null
      and annotation_media.checksum_sha256 is not null
      and annotation_media.raw_storage_path is null
      and annotation_media.raw_deleted_at is not null
      and annotation_media.processed_at is not null
      and annotation_media.removed_at is null
      and (
        annotation_media.media_type = 'audio'
        or (
          annotation_media.media_type = 'video'
          and annotation_media.width is not null
          and annotation_media.height is not null
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Hosted media must be ready with valid final metadata and confirmed raw deletion before publication.';
  end if;

  if not exists (
    select 1
    from public.annotation_transcripts
    where annotation_transcripts.annotation_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A hosted media transcript is required before publication.';
  end if;

  return new;
end;
$$;

comment on function private.guard_hosted_annotation_publication() is
  'First hosted publication still requires ready media, valid final metadata, confirmed raw deletion, and a transcript row. Hidden → published (F3 unhide) also admits F4-removed media and never restores derivatives or transcript content.';

-- ---------------------------------------------------------------------------
-- Service-only hide
-- ---------------------------------------------------------------------------

create function private.moderate_annotation_hide(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_reason_code text,
  p_claim_id uuid default null
)
returns table (
  annotation_id uuid,
  media_id uuid,
  claim_id uuid,
  reason_code text,
  result_code text,
  audit_id uuid,
  annotation_status text,
  previous_status text,
  processing_status text
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
  from_status text;
  linked_claim_id uuid;
begin
  -- Votes, follows, and comments are intentionally unread. Claims never
  -- auto-takedown; a claim_id is an optional confidential link only.
  if p_actor_id is null
    or p_annotation_id is null
    or p_reason_code is null
    or p_reason_code not in (
      'copyright',
      'excerpt_claim',
      'operator_request',
      'commentary'
    )
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
  -- qualify columns so names like annotation_id/media_id cannot collide.
  select annotations.* into annotation_row
  from public.annotations as annotations
  where annotations.id = p_annotation_id
  for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Annotation hide is not available.';
  end if;

  from_status := annotation_row.status;

  if from_status not in ('published', 'hidden') then
    raise exception using
      errcode = '55000',
      message = 'Annotation hide is not available.';
  end if;

  select media.* into media_row
  from public.annotation_media as media
  where media.annotation_id = p_annotation_id
  for update;

  if p_claim_id is not null then
    select claims.* into claim_row
    from public.claims as claims
    where claims.id = p_claim_id
    for update;
    if not found or claim_row.annotation_id is distinct from p_annotation_id then
      raise exception using
        errcode = '55000',
        message = 'Annotation hide is not available.';
    end if;
  end if;

  if from_status = 'hidden' then
    select audit.* into existing_audit
    from private.moderation_audit as audit
    where audit.annotation_id = p_annotation_id
      and audit.action = 'annotation_hide'
    order by audit.created_at desc
    limit 1;

    annotation_id := annotation_row.id;
    media_id := media_row.id;
    claim_id := coalesce(existing_audit.claim_id, p_claim_id);
    reason_code := p_reason_code;
    result_code := 'already_hidden';
    audit_id := existing_audit.id;
    annotation_status := annotation_row.status;
    previous_status := from_status;
    processing_status := media_row.processing_status;
    return next;
    return;
  end if;

  linked_claim_id := p_claim_id;

  update public.annotations as annotations
  set status = 'hidden'
  where annotations.id = p_annotation_id
  returning annotations.* into annotation_row;

  insert into private.moderation_audit as audit (
    actor_id, action, reason_code, annotation_id, media_id, claim_id, result_code
  ) values (
    p_actor_id,
    'annotation_hide',
    p_reason_code,
    annotation_row.id,
    media_row.id,
    linked_claim_id,
    'hidden'
  )
  returning audit.* into inserted_audit;

  annotation_id := annotation_row.id;
  media_id := media_row.id;
  claim_id := linked_claim_id;
  reason_code := p_reason_code;
  result_code := 'hidden';
  audit_id := inserted_audit.id;
  annotation_status := annotation_row.status;
  previous_status := from_status;
  processing_status := media_row.processing_status;
  return next;
end;
$$;

comment on function private.moderate_annotation_hide(uuid, uuid, text, uuid) is
  'Service-only hide: lock a published annotation, set status=hidden, and write an append-only annotation_hide audit row. Already-hidden is idempotent (already_hidden, no second audit). Does not change media, claims, votes, or transcripts. Actor is the trusted caller session user id.';

revoke all on function private.moderate_annotation_hide(uuid, uuid, text, uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.moderate_annotation_hide(uuid, uuid, text, uuid)
  to service_role;

create function public.moderate_annotation_hide(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_reason_code text,
  p_claim_id uuid default null
)
returns table (
  annotation_id uuid,
  media_id uuid,
  claim_id uuid,
  reason_code text,
  result_code text,
  audit_id uuid,
  annotation_status text,
  previous_status text,
  processing_status text
)
language sql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
  select *
  from private.moderate_annotation_hide(
    p_actor_id,
    p_annotation_id,
    p_reason_code,
    p_claim_id
  );
$$;

comment on function public.moderate_annotation_hide(uuid, uuid, text, uuid) is
  'Trusted-server wrapper for private.moderate_annotation_hide. Execute is service_role only; PostgREST does not expose the private schema.';

revoke all on function public.moderate_annotation_hide(uuid, uuid, text, uuid)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.moderate_annotation_hide(uuid, uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Service-only unhide
-- ---------------------------------------------------------------------------

create function private.moderate_annotation_unhide(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_reason_code text,
  p_claim_id uuid default null
)
returns table (
  annotation_id uuid,
  media_id uuid,
  claim_id uuid,
  reason_code text,
  result_code text,
  audit_id uuid,
  annotation_status text,
  previous_status text,
  processing_status text,
  transcript_content_restored boolean
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
  from_status text;
  linked_claim_id uuid;
begin
  -- Votes, follows, and comments are intentionally unread. Unhide is
  -- status-only: it never rebuilds derivatives or restores transcript text.
  if p_actor_id is null
    or p_annotation_id is null
    or p_reason_code is null
    or p_reason_code not in (
      'copyright',
      'excerpt_claim',
      'operator_request',
      'commentary'
    )
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

  select annotations.* into annotation_row
  from public.annotations as annotations
  where annotations.id = p_annotation_id
  for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Annotation unhide is not available.';
  end if;

  from_status := annotation_row.status;

  if from_status not in ('hidden', 'published') then
    raise exception using
      errcode = '55000',
      message = 'Annotation unhide is not available.';
  end if;

  select media.* into media_row
  from public.annotation_media as media
  where media.annotation_id = p_annotation_id
  for update;

  if p_claim_id is not null then
    select claims.* into claim_row
    from public.claims as claims
    where claims.id = p_claim_id
    for update;
    if not found or claim_row.annotation_id is distinct from p_annotation_id then
      raise exception using
        errcode = '55000',
        message = 'Annotation unhide is not available.';
    end if;
  end if;

  if annotation_row.annotation_type in ('video_clip', 'audio_clip')
    and not private.hosted_media_allows_published_return(p_annotation_id)
  then
    raise exception using
      errcode = '55000',
      message = 'Annotation unhide is not available.';
  end if;

  if from_status = 'published' then
    select audit.* into existing_audit
    from private.moderation_audit as audit
    where audit.annotation_id = p_annotation_id
      and audit.action = 'annotation_unhide'
    order by audit.created_at desc
    limit 1;

    annotation_id := annotation_row.id;
    media_id := media_row.id;
    claim_id := coalesce(existing_audit.claim_id, p_claim_id);
    reason_code := p_reason_code;
    result_code := 'already_published';
    audit_id := existing_audit.id;
    annotation_status := annotation_row.status;
    previous_status := from_status;
    processing_status := media_row.processing_status;
    transcript_content_restored := false;
    return next;
    return;
  end if;

  linked_claim_id := p_claim_id;

  update public.annotations as annotations
  set status = 'published'
  where annotations.id = p_annotation_id
  returning annotations.* into annotation_row;

  insert into private.moderation_audit as audit (
    actor_id, action, reason_code, annotation_id, media_id, claim_id, result_code
  ) values (
    p_actor_id,
    'annotation_unhide',
    p_reason_code,
    annotation_row.id,
    media_row.id,
    linked_claim_id,
    'unhidden'
  )
  returning audit.* into inserted_audit;

  annotation_id := annotation_row.id;
  media_id := media_row.id;
  claim_id := linked_claim_id;
  reason_code := p_reason_code;
  result_code := 'unhidden';
  audit_id := inserted_audit.id;
  annotation_status := annotation_row.status;
  previous_status := from_status;
  processing_status := media_row.processing_status;
  transcript_content_restored := false;
  return next;
end;
$$;

comment on function private.moderate_annotation_unhide(uuid, uuid, text, uuid) is
  'Service-only unhide: lock a hidden annotation, validate media may return to published (ready or already removed), set status=published, and write a NEW annotation_unhide audit row. Never restores F4-cleared transcript content or derivatives. Already-published is idempotent. Actor is the trusted caller session user id.';

revoke all on function private.moderate_annotation_unhide(uuid, uuid, text, uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.moderate_annotation_unhide(uuid, uuid, text, uuid)
  to service_role;

create function public.moderate_annotation_unhide(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_reason_code text,
  p_claim_id uuid default null
)
returns table (
  annotation_id uuid,
  media_id uuid,
  claim_id uuid,
  reason_code text,
  result_code text,
  audit_id uuid,
  annotation_status text,
  previous_status text,
  processing_status text,
  transcript_content_restored boolean
)
language sql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
  select *
  from private.moderate_annotation_unhide(
    p_actor_id,
    p_annotation_id,
    p_reason_code,
    p_claim_id
  );
$$;

comment on function public.moderate_annotation_unhide(uuid, uuid, text, uuid) is
  'Trusted-server wrapper for private.moderate_annotation_unhide. Execute is service_role only; PostgREST does not expose the private schema.';

revoke all on function public.moderate_annotation_unhide(uuid, uuid, text, uuid)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.moderate_annotation_unhide(uuid, uuid, text, uuid)
  to service_role;
