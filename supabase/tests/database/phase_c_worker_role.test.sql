begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(
  exists (select 1 from pg_catalog.pg_roles where rolname = 'annotated_media_worker'),
  'the dedicated media worker role exists'
);

select ok(
  not rolsuper and not rolcreatedb and not rolcreaterole and not rolinherit
    and not rolreplication and not rolbypassrls and rolcanlogin,
  'the worker is a non-privileged no-inherit login'
)
from pg_catalog.pg_roles
where rolname = 'annotated_media_worker';

select ok(
  rolconfig @> array['statement_timeout=120s', 'lock_timeout=5s',
    'idle_in_transaction_session_timeout=30s', 'search_path=""'],
  'the worker role has bounded session defaults and an empty search path'
)
from pg_catalog.pg_roles
where rolname = 'annotated_media_worker';

select ok(
  not pg_catalog.has_table_privilege('annotated_media_worker', 'public.annotations', 'select,insert,update,delete')
    and not pg_catalog.has_table_privilege('annotated_media_worker', 'public.annotation_media', 'select,insert,update,delete')
    and not pg_catalog.has_table_privilege('annotated_media_worker', 'public.annotation_transcripts', 'select,insert,update,delete')
    and not pg_catalog.has_table_privilege('annotated_media_worker', 'storage.objects', 'select,insert,update,delete'),
  'the worker cannot directly read or mutate domain or Storage tables'
);

select ok(
  pg_catalog.bool_and(pg_catalog.has_function_privilege('annotated_media_worker', signature, 'execute')),
  'the worker can execute every exact lifecycle function'
)
from (values
  ('private.claim_annotation_media_processing(uuid,integer)'),
  ('private.stage_annotation_media_derivative(uuid,uuid,text,text,text,integer,integer,integer,bigint,text)'),
  ('private.stage_annotation_media_transcript(uuid,uuid,text,text,jsonb,text,text,jsonb)'),
  ('private.confirm_annotation_media_raw_deleted(uuid,uuid)'),
  ('private.finalize_annotation_media_ready(uuid,uuid)'),
  ('private.release_annotation_media_processing_attempt(uuid,uuid,text,text)'),
  ('private.list_annotation_media_dispatch_candidates(integer)'),
  ('private.list_annotation_media_reconciliation_candidates(integer)'),
  ('private.claim_annotation_media_cleanup(uuid)'),
  ('private.claim_annotation_media_cleanup_v2(uuid)'),
  ('private.confirm_annotation_media_cleanup(uuid,text,text,timestamp with time zone)'),
  ('private.reconcile_annotation_media_processing(uuid)')
) as allowed(signature);

select ok(
  not pg_catalog.has_function_privilege('annotated_media_worker', 'private.mark_annotation_media_uploading(uuid,text,text,bigint,jsonb)', 'execute')
    and not pg_catalog.has_function_privilege('annotated_media_worker', 'private.accept_annotation_media_upload(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('annotated_media_worker', 'private.retry_annotation_media_processing(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('annotated_media_worker', 'private.mark_annotation_media_processing_failed(uuid,uuid,text,text)', 'execute'),
  'the worker cannot execute upload, owner-retry, or obsolete failure functions'
);

select ok(
  pg_catalog.has_schema_privilege('annotated_media_worker', 'private', 'usage'),
  'the worker can resolve the exact private lifecycle functions'
);

select ok(
  not pg_catalog.has_schema_privilege('annotated_media_worker', 'private', 'create')
    and not pg_catalog.has_schema_privilege('annotated_media_worker', 'public', 'create'),
  'the worker cannot create objects in application schemas'
);

select * from finish();

rollback;
