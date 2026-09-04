-- Phase F2: Matt-only claim review. Service-only list/get/update RPCs,
-- append-only claim_review audit rows, and no client SELECT/UPDATE/DELETE.
--
-- Locked owner policy encoded here:
-- - Operator identity is never client-supplied; these RPCs are service-only.
-- - Clients never SELECT/UPDATE/DELETE public.claims.
-- - Default review output suppresses claimant name/email/details unless the
--   trusted caller explicitly requests them.
-- - Claims never auto-takedown; these functions do not change annotation or
--   media state and do not perform hide/remove/media-only withdrawal.
-- - Votes never moderate: these functions do not read or write vote totals,
--   vote rows, or vote rate-limit state.
-- - No claimant/creator email workflows.
-- - Empty search_path, schema-qualified names, no anon/authenticated/worker
--   execute.
--
-- Allowed status transitions:
--   submitted -> reviewing
--   submitted -> rejected   (documented extra: plan §5 reject without a
--                            reviewing hop, e.g. obvious invalid/spam)
--   reviewing -> resolved
--   reviewing -> rejected
-- Illegal examples (rejected): submitted -> resolved; any transition out of
-- resolved/rejected; reviewing -> submitted; resolve/reject without a current
-- reviewing row except the submitted -> rejected spam path above.

-- ---------------------------------------------------------------------------
-- Additive operator-notes column. Public insert must not set it.
-- ---------------------------------------------------------------------------

alter table public.claims
  add column operator_notes text;

alter table public.claims
  add constraint claims_operator_notes_length check (
    operator_notes is null
    or (
      pg_catalog.btrim(operator_notes) <> ''
      and pg_catalog.char_length(operator_notes) <= 4000
    )
  );

comment on column public.claims.operator_notes is
  'Optional Matt-only review notes. Never publicly readable. Public claim insert must leave this null.';

create index claims_review_queue_idx
  on public.claims (status, created_at, id);

drop policy if exists claims_public_submit on public.claims;

create policy claims_public_submit
on public.claims
for insert
to anon, authenticated
with check (
  status = 'submitted'
  and operator_notes is null
  and exists (
    select 1
    from public.annotations as annotations
    where annotations.id = annotation_id
      and annotations.status = 'published'
  )
);

comment on policy claims_public_submit on public.claims is
  'Public clients may insert claims only as submitted, with no operator notes, and only when the target annotation is currently published. No client SELECT, UPDATE, or DELETE grant or policy exists; review remains service-role only.';

comment on table public.claims is
  'Copyright/fair-use claims are write-only to public clients. Review uses service-only RPCs. Claimant name/email/details are confidential; operator_notes are Matt-only.';

-- ---------------------------------------------------------------------------
-- Extend append-only F4 audit for claim-review actions. Same table; new values.
-- ---------------------------------------------------------------------------

alter table private.moderation_audit
  drop constraint moderation_audit_action_check;

alter table private.moderation_audit
  add constraint moderation_audit_action_check check (
    action in ('media_only_withdrawal', 'claim_review')
  );

alter table private.moderation_audit
  drop constraint moderation_audit_reason_code_check;

alter table private.moderation_audit
  add constraint moderation_audit_reason_code_check check (
    reason_code in ('copyright', 'excerpt_claim', 'operator_request', 'claim_review')
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
      'rejected'
    )
  );

create index moderation_audit_claim_created_idx
  on private.moderation_audit (claim_id, created_at desc)
  where claim_id is not null;

comment on table private.moderation_audit is
  'Append-only operator audit. F4 writes media-only withdrawal rows. F2 writes claim_review rows. Never store claimant/creator emails, transcript text, signed URLs, or Storage paths.';

-- ---------------------------------------------------------------------------
-- Service-only list
-- ---------------------------------------------------------------------------

create function private.list_claims_for_review(
  p_status text default null,
  p_include_claimant_pii boolean default false,
  p_limit integer default 50,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  claim_id uuid,
  annotation_id uuid,
  status text,
  relationship_to_content text,
  reason text,
  operator_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  claimant_name text,
  claimant_email text,
  details text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  include_pii boolean := coalesce(p_include_claimant_pii, false);
begin
  -- Votes, follows, comments, annotation/media state, and takedown RPCs are
  -- intentionally unread. This is a review-queue read path only.
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  if p_status is not null
    and p_status not in ('submitted', 'reviewing', 'resolved', 'rejected')
  then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  return query
  select
    claims.id,
    claims.annotation_id,
    claims.status,
    claims.relationship_to_content,
    claims.reason,
    claims.operator_notes,
    claims.created_at,
    claims.updated_at,
    case when include_pii then claims.claimant_name end,
    case when include_pii then claims.claimant_email end,
    case when include_pii then claims.details end
  from public.claims as claims
  where (
      (p_status is null and claims.status in ('submitted', 'reviewing'))
      or (p_status is not null and claims.status = p_status)
    )
    and (
      p_after_created_at is null
      or (claims.created_at, claims.id) > (p_after_created_at, p_after_id)
    )
  order by claims.created_at asc, claims.id asc
  limit p_limit;
end;
$$;

comment on function private.list_claims_for_review(text, boolean, integer, timestamptz, uuid) is
  'Service-only claim review queue. Default filter is open claims (submitted, reviewing), oldest first. Claimant name/email/details are null unless p_include_claimant_pii is true. Does not read votes or change annotation/media state.';

revoke all on function private.list_claims_for_review(text, boolean, integer, timestamptz, uuid)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.list_claims_for_review(text, boolean, integer, timestamptz, uuid)
  to service_role;

create function public.list_claims_for_review(
  p_status text default null,
  p_include_claimant_pii boolean default false,
  p_limit integer default 50,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  claim_id uuid,
  annotation_id uuid,
  status text,
  relationship_to_content text,
  reason text,
  operator_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  claimant_name text,
  claimant_email text,
  details text
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select *
  from private.list_claims_for_review(
    p_status,
    p_include_claimant_pii,
    p_limit,
    p_after_created_at,
    p_after_id
  );
$$;

comment on function public.list_claims_for_review(text, boolean, integer, timestamptz, uuid) is
  'Trusted-server wrapper for private.list_claims_for_review. Execute is service_role only; PostgREST does not expose the private schema.';

revoke all on function public.list_claims_for_review(text, boolean, integer, timestamptz, uuid)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.list_claims_for_review(text, boolean, integer, timestamptz, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Service-only get
-- ---------------------------------------------------------------------------

create function private.get_claim_for_review(
  p_claim_id uuid,
  p_include_claimant_pii boolean default false
)
returns table (
  claim_id uuid,
  annotation_id uuid,
  status text,
  relationship_to_content text,
  reason text,
  operator_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  claimant_name text,
  claimant_email text,
  details text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  include_pii boolean := coalesce(p_include_claimant_pii, false);
begin
  if p_claim_id is null then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  return query
  select
    claims.id,
    claims.annotation_id,
    claims.status,
    claims.relationship_to_content,
    claims.reason,
    claims.operator_notes,
    claims.created_at,
    claims.updated_at,
    case when include_pii then claims.claimant_name end,
    case when include_pii then claims.claimant_email end,
    case when include_pii then claims.details end
  from public.claims as claims
  where claims.id = p_claim_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Claim review is not available.';
  end if;
end;
$$;

comment on function private.get_claim_for_review(uuid, boolean) is
  'Service-only single-claim review read. Claimant name/email/details are null unless p_include_claimant_pii is true. Does not read votes or change annotation/media state.';

revoke all on function private.get_claim_for_review(uuid, boolean)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.get_claim_for_review(uuid, boolean)
  to service_role;

create function public.get_claim_for_review(
  p_claim_id uuid,
  p_include_claimant_pii boolean default false
)
returns table (
  claim_id uuid,
  annotation_id uuid,
  status text,
  relationship_to_content text,
  reason text,
  operator_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  claimant_name text,
  claimant_email text,
  details text
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select *
  from private.get_claim_for_review(
    p_claim_id,
    p_include_claimant_pii
  );
$$;

comment on function public.get_claim_for_review(uuid, boolean) is
  'Trusted-server wrapper for private.get_claim_for_review. Execute is service_role only; PostgREST does not expose the private schema.';

revoke all on function public.get_claim_for_review(uuid, boolean)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.get_claim_for_review(uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Service-only status transition
-- ---------------------------------------------------------------------------

create function private.update_claim_review(
  p_actor_id uuid,
  p_claim_id uuid,
  p_to_status text,
  p_operator_notes text default null,
  p_clear_operator_notes boolean default false,
  p_include_claimant_pii boolean default false
)
returns table (
  claim_id uuid,
  annotation_id uuid,
  status text,
  previous_status text,
  relationship_to_content text,
  reason text,
  operator_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  claimant_name text,
  claimant_email text,
  details text,
  audit_id uuid,
  result_code text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
declare
  claim_row public.claims%rowtype;
  inserted_audit private.moderation_audit%rowtype;
  include_pii boolean := coalesce(p_include_claimant_pii, false);
  clear_notes boolean := coalesce(p_clear_operator_notes, false);
  next_notes text;
  from_status text;
begin
  -- Votes, follows, comments, and media/annotation takedown paths are
  -- intentionally unread and unwritten. Claims never auto-takedown.
  if p_actor_id is null
    or p_claim_id is null
    or p_to_status is null
    or p_to_status not in ('reviewing', 'resolved', 'rejected')
    or (clear_notes and p_operator_notes is not null)
  then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  if not exists (
    select 1 from public.profiles as profiles where profiles.id = p_actor_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  select claims.* into claim_row
  from public.claims as claims
  where claims.id = p_claim_id
  for update of claims;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Claim review is not available.';
  end if;

  from_status := claim_row.status;

  if not (
    (from_status = 'submitted' and p_to_status = 'reviewing')
    or (from_status = 'submitted' and p_to_status = 'rejected')
    or (from_status = 'reviewing' and p_to_status in ('resolved', 'rejected'))
  ) then
    raise exception using
      errcode = '22023',
      message = 'The claim review request is invalid.';
  end if;

  if clear_notes then
    next_notes := null;
  elsif p_operator_notes is not null then
    next_notes := p_operator_notes;
  else
    next_notes := claim_row.operator_notes;
  end if;

  update public.claims as claims
  set
    status = p_to_status,
    operator_notes = next_notes
  where claims.id = p_claim_id
  returning claims.* into claim_row;

  insert into private.moderation_audit as audit (
    actor_id, action, reason_code, annotation_id, media_id, claim_id, result_code
  ) values (
    p_actor_id,
    'claim_review',
    'claim_review',
    claim_row.annotation_id,
    null,
    claim_row.id,
    p_to_status
  )
  returning audit.* into inserted_audit;

  claim_id := claim_row.id;
  annotation_id := claim_row.annotation_id;
  status := claim_row.status;
  previous_status := from_status;
  relationship_to_content := claim_row.relationship_to_content;
  reason := claim_row.reason;
  operator_notes := claim_row.operator_notes;
  created_at := claim_row.created_at;
  updated_at := claim_row.updated_at;
  claimant_name := case when include_pii then claim_row.claimant_name end;
  claimant_email := case when include_pii then claim_row.claimant_email end;
  details := case when include_pii then claim_row.details end;
  audit_id := inserted_audit.id;
  result_code := p_to_status;
  return next;
end;
$$;

comment on function private.update_claim_review(uuid, uuid, text, text, boolean, boolean) is
  'Service-only claim status transition with row lock and append-only claim_review audit. Allowed: submitted→reviewing, submitted→rejected, reviewing→resolved, reviewing→rejected. Does not hide/remove media or read votes. Actor is the trusted caller''s session user id, never a client-supplied operator identity.';

revoke all on function private.update_claim_review(uuid, uuid, text, text, boolean, boolean)
  from public, anon, authenticated, annotated_media_worker;
grant execute on function private.update_claim_review(uuid, uuid, text, text, boolean, boolean)
  to service_role;

create function public.update_claim_review(
  p_actor_id uuid,
  p_claim_id uuid,
  p_to_status text,
  p_operator_notes text default null,
  p_clear_operator_notes boolean default false,
  p_include_claimant_pii boolean default false
)
returns table (
  claim_id uuid,
  annotation_id uuid,
  status text,
  previous_status text,
  relationship_to_content text,
  reason text,
  operator_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  claimant_name text,
  claimant_email text,
  details text,
  audit_id uuid,
  result_code text
)
language sql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
  select *
  from private.update_claim_review(
    p_actor_id,
    p_claim_id,
    p_to_status,
    p_operator_notes,
    p_clear_operator_notes,
    p_include_claimant_pii
  );
$$;

comment on function public.update_claim_review(uuid, uuid, text, text, boolean, boolean) is
  'Trusted-server wrapper for private.update_claim_review. Execute is service_role only; PostgREST does not expose the private schema.';

revoke all on function public.update_claim_review(uuid, uuid, text, text, boolean, boolean)
  from public, anon, authenticated, annotated_media_worker, service_role;
grant execute on function public.update_claim_review(uuid, uuid, text, text, boolean, boolean)
  to service_role;
