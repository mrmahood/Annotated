-- Phase F5: Matt-only full-record remove with discovery isolation and optional
-- claim resolution linkage.
--
-- Locked owner policy encoded here:
-- - Operator identity is never client-supplied; these RPCs are service-only.
-- - Allowed from-states: published → removed, hidden → removed.
--   already-removed is idempotent (already_removed, no second audit).
--   draft / claim_pending are illegal (55000).
-- - Hide remains F3 (reversible). Remove is final; F3 unhide does not apply.
-- - Plan §5 Full remove has no prior-hide precondition. The operator decision
--   tree still prefers media-only (F4) → hide (F3) → remove (F5); the RPC
--   admits published so a record that must leave discovery can do so in one
--   audited step.
-- - If hosted media is still playable (or not yet fully removed), apply F4
--   media-removed semantics in this transaction: processing_status=removed,
--   removed_at, optional removal_claim_id, clear transcript content, leave
--   Storage paths for reconciler cleanup. Do not write a separate
--   media_only_withdrawal audit; annotation_remove is the operator action.
-- - Transcript excerpt text/segments are cleared (same F4 helper) so content
--   is non-public everywhere. Audit-safe metadata is retained. Remove does
--   not rebuild derivatives.
-- - Optional claim_id is a confidential audit link. Claims that do not belong
--   to the annotation are rejected. Claimant fields are never returned.
-- - Optional p_resolve_claim uses private.update_claim_review (F2) for
--   reviewing → resolved in the same transaction. submitted / rejected claims
--   fail closed before mutation. already_removed does not resolve a claim.
-- - Claims never auto-takedown when resolve is not requested.
-- - Votes never moderate: these functions do not read or write vote rows,
--   totals, or rate-limit state.
-- - No claimant/creator email workflows. No public appeals.
-- - Empty search_path, schema-qualified names, no anon/authenticated/worker
--   execute.
--
-- Reason codes (closed set, consistent with F3/F4):
--   operator_request  — Matt-initiated remove without a claim
--   copyright         — copyright concern requiring full-record remove
--   excerpt_claim     — excerpt claim escalated beyond media-only / hide
--   commentary        — commentary itself is the problem (plan §2 decision 6)
--
-- Result codes:
--   removed / already_removed — remove (idempotent retry mirrors F3/F4)

-- ---------------------------------------------------------------------------
-- Extend append-only F4/F3/F2 audit for full-record remove. Same table.
-- ---------------------------------------------------------------------------

alter table private.moderation_audit
  drop constraint moderation_audit_action_check;

alter table private.moderation_audit
  add constraint moderation_audit_action_check check (
    action in (
      'media_only_withdrawal',
      'claim_review',
      'annotation_hide',
      'annotation_unhide',
      'annotation_remove'
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
      'already_published',
      'removed',
      'already_removed'
    )
  );

comment on table private.moderation_audit is
  'Append-only operator audit. F4 writes media-only withdrawal rows. F2 writes claim_review rows. F3 writes annotation_hide and annotation_unhide rows. F5 writes annotation_remove rows. Never store claimant/creator emails, transcript text, signed URLs, or Storage paths.';

-- ---------------------------------------------------------------------------
-- Service-only full-record remove
-- ---------------------------------------------------------------------------

create function private.moderate_annotation_remove(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_reason_code text,
  p_claim_id uuid default null,
  p_resolve_claim boolean default false
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
  transcript_content_cleared boolean,
  claim_status text,
  claim_resolved boolean
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
  resolve_claim boolean := coalesce(p_resolve_claim, false);
  did_resolve_claim boolean := false;
begin
  -- Votes, follows, and comments are intentionally unread. Claims never
  -- auto-takedown; resolve_claim must be an explicit operator flag.
  if p_actor_id is null
    or p_annotation_id is null
    or p_reason_code is null
    or p_reason_code not in (
      'copyright',
      'excerpt_claim',
      'operator_request',
      'commentary'
    )
    or (resolve_claim and p_claim_id is null)
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
  -- qualify columns so names like annotation_id/media_id/claim_id cannot collide.
  select annotations.* into annotation_row
  from public.annotations as annotations
  where annotations.id = p_annotation_id
  for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Annotation remove is not available.';
  end if;

  from_status := annotation_row.status;

  if from_status not in ('published', 'hidden', 'removed') then
    raise exception using
      errcode = '55000',
      message = 'Annotation remove is not available.';
  end if;

  select media.* into media_row
  from public.annotation_media as media
  where media.annotation_id = p_annotation_id
  for update;

  perform 1
  from public.annotation_transcripts as transcripts
  where transcripts.annotation_id = p_annotation_id
  for update;

  if p_claim_id is not null then
    select claims.* into claim_row
    from public.claims as claims
    where claims.id = p_claim_id
    for update;
    if not found or claim_row.annotation_id is distinct from p_annotation_id then
      raise exception using
        errcode = '55000',
        message = 'Annotation remove is not available.';
    end if;
  end if;

  if from_status = 'removed' then
    select audit.* into existing_audit
    from private.moderation_audit as audit
    where audit.annotation_id = p_annotation_id
      and audit.action = 'annotation_remove'
    order by audit.created_at desc
    limit 1;

    annotation_id := annotation_row.id;
    media_id := media_row.id;
    claim_id := coalesce(existing_audit.claim_id, p_claim_id);
    reason_code := p_reason_code;
    result_code := 'already_removed';
    audit_id := existing_audit.id;
    annotation_status := annotation_row.status;
    previous_status := from_status;
    processing_status := media_row.processing_status;
    transcript_content_cleared := not private.annotation_transcript_content_present(p_annotation_id);
    claim_status := claim_row.status;
    claim_resolved := false;
    return next;
    return;
  end if;

  -- Fail closed before mutation: F2 allows reviewing → resolved only.
  -- submitted must be moved to reviewing first. rejected cannot resolve.
  -- already_removed retries skip this and do not resolve.
  if resolve_claim then
    if claim_row.status not in ('reviewing', 'resolved') then
      raise exception using
        errcode = '22023',
        message = 'The moderation request is invalid.';
    end if;
  end if;

  linked_claim_id := p_claim_id;

  update public.annotations as annotations
  set status = 'removed'
  where annotations.id = p_annotation_id
  returning annotations.* into annotation_row;

  -- Coordinate with F4: revoke any still-playable (or not-fully-removed) hosted
  -- media so public playback and worker finalize fail closed, and so the
  -- reconciler's removed_cleanup path becomes eligible. Paths stay until
  -- confirm_annotation_media_cleanup.
  if media_row.id is not null
    and (
      media_row.processing_status is distinct from 'removed'
      or media_row.removed_at is null
    )
  then
    update public.annotation_media as media
    set
      processing_status = 'removed',
      processing_stage = null,
      removed_at = coalesce(media.removed_at, pg_catalog.now()),
      removal_claim_id = coalesce(media.removal_claim_id, linked_claim_id),
      next_attempt_at = null,
      lease_token = null,
      lease_expires_at = null
    where media.id = media_row.id
    returning media.* into media_row;
  end if;

  perform private.clear_annotation_transcript_content(p_annotation_id);

  insert into private.moderation_audit as audit (
    actor_id, action, reason_code, annotation_id, media_id, claim_id, result_code
  ) values (
    p_actor_id,
    'annotation_remove',
    p_reason_code,
    annotation_row.id,
    media_row.id,
    linked_claim_id,
    'removed'
  )
  returning audit.* into inserted_audit;

  if resolve_claim and claim_row.status = 'reviewing' then
    -- Reuse F2's transition helper rather than duplicating claim UPDATE logic.
    -- include_claimant_pii stays false; F5 never returns claimant fields.
    perform 1
    from private.update_claim_review(
      p_actor_id,
      p_claim_id,
      'resolved',
      null,
      false,
      false
    );
    select claims.* into claim_row
    from public.claims as claims
    where claims.id = p_claim_id;
    did_resolve_claim := claim_row.status = 'resolved';
  elsif resolve_claim and claim_row.status = 'resolved' then
    did_resolve_claim := true;
  end if;

  annotation_id := annotation_row.id;
  media_id := media_row.id;
  claim_id := linked_claim_id;
  reason_code := p_reason_code;
  result_code := 'removed';
  audit_id := inserted_audit.id;
  annotation_status := annotation_row.status;
  previous_status := from_status;
  processing_status := media_row.processing_status;
  transcript_content_cleared := not private.annotation_transcript_content_present(p_annotation_id);
  claim_status := claim_row.status;
  claim_resolved := did_resolve_claim;
  return next;
end;
$$;

comment on function private.moderate_annotation_remove(uuid, uuid, text, uuid, boolean) is
  'Service-only full-record remove: lock a published or hidden annotation, set status=removed, revoke still-playable hosted media with F4 semantics, clear transcript content, and write an append-only annotation_remove audit row. Optional claim_id is a confidential link; p_resolve_claim calls private.update_claim_review for reviewing→resolved. Already-removed is idempotent and does not resolve a claim. Actor is the trusted caller session user id.';

revoke all on function private.moderate_annotation_remove(uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.moderate_annotation_remove(uuid, uuid, text, uuid, boolean)
  to service_role;

create function public.moderate_annotation_remove(
  p_actor_id uuid,
  p_annotation_id uuid,
  p_reason_code text,
  p_claim_id uuid default null,
  p_resolve_claim boolean default false
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
  transcript_content_cleared boolean,
  claim_status text,
  claim_resolved boolean
)
language sql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
  select *
  from private.moderate_annotation_remove(
    p_actor_id,
    p_annotation_id,
    p_reason_code,
    p_claim_id,
    p_resolve_claim
  );
$$;

comment on function public.moderate_annotation_remove(uuid, uuid, text, uuid, boolean) is
  'Trusted-server wrapper for private.moderate_annotation_remove. Execute is service_role only; PostgREST does not expose the private schema. Results never include claimant name, email, or details.';

revoke all on function public.moderate_annotation_remove(uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.moderate_annotation_remove(uuid, uuid, text, uuid, boolean)
  to service_role;
