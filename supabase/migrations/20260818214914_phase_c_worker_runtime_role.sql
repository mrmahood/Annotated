-- Phase C C6: dedicated database login with execution rights limited to the
-- worker lifecycle boundary. The migration deliberately sets no password;
-- Staging bootstrap supplies a generated password directly to the role and
-- Secret Manager without writing it to migration history or logs.

do $$
declare
  existing pg_catalog.pg_roles%rowtype;
begin
  select * into existing from pg_catalog.pg_roles where rolname = 'annotated_media_worker';
  if not found then
    create role annotated_media_worker
      login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  elsif existing.rolsuper or existing.rolcreatedb or existing.rolcreaterole or existing.rolinherit
    or existing.rolreplication or existing.rolbypassrls or not existing.rolcanlogin
  then
    raise exception using errcode = '55000',
      message = 'The existing annotated_media_worker role does not match the least-privilege contract.';
  end if;
end;
$$;

alter role annotated_media_worker set statement_timeout = '120s';
alter role annotated_media_worker set lock_timeout = '5s';
alter role annotated_media_worker set idle_in_transaction_session_timeout = '30s';
alter role annotated_media_worker set search_path = '';

revoke all on all tables in schema public from annotated_media_worker;
revoke all on all sequences in schema public from annotated_media_worker;
revoke all on schema public from annotated_media_worker;
revoke all on schema private from annotated_media_worker;
grant usage on schema private to annotated_media_worker;

grant execute on function private.claim_annotation_media_processing(uuid, integer)
  to annotated_media_worker;
grant execute on function private.stage_annotation_media_derivative(
  uuid, uuid, text, text, text, integer, integer, integer, bigint, text
) to annotated_media_worker;
grant execute on function private.stage_annotation_media_transcript(
  uuid, uuid, text, text, jsonb, text, text, jsonb
) to annotated_media_worker;
grant execute on function private.confirm_annotation_media_raw_deleted(uuid, uuid)
  to annotated_media_worker;
grant execute on function private.finalize_annotation_media_ready(uuid, uuid)
  to annotated_media_worker;
grant execute on function private.release_annotation_media_processing_attempt(uuid, uuid, text, text)
  to annotated_media_worker;
grant execute on function private.list_annotation_media_dispatch_candidates(integer)
  to annotated_media_worker;
grant execute on function private.list_annotation_media_reconciliation_candidates(integer)
  to annotated_media_worker;
grant execute on function private.claim_annotation_media_cleanup(uuid)
  to annotated_media_worker;
grant execute on function private.confirm_annotation_media_cleanup(uuid, text, text, timestamptz)
  to annotated_media_worker;
grant execute on function private.reconcile_annotation_media_processing(uuid)
  to annotated_media_worker;

comment on role annotated_media_worker is
  'Phase C private media worker login. Password is provisioned outside migration history; only exact security-definer lifecycle functions are granted.';
