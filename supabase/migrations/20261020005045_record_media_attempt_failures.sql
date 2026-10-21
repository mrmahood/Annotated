create table public.annotation_media_attempt_failures (
  id bigint generated always as identity primary key,
  media_id uuid not null references public.annotation_media (id),
  attempt_count smallint not null,
  failure_stage text not null,
  failure_code text not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  constraint annotation_media_attempt_failures_stage_check
    check (failure_stage ~ '^[a-z0-9_]{1,50}$'),
  constraint annotation_media_attempt_failures_code_check
    check (failure_code ~ '^[a-z0-9_]{1,100}$')
);

comment on table public.annotation_media_attempt_failures is
  'One row per released processing attempt. Claim clears the live failure columns and leaves this record.';

create index annotation_media_attempt_failures_media_id_idx
  on public.annotation_media_attempt_failures (media_id, recorded_at);

alter table public.annotation_media_attempt_failures enable row level security;

revoke all on table public.annotation_media_attempt_failures
  from public, anon, authenticated;
grant select on table public.annotation_media_attempt_failures to service_role;

create function private.record_annotation_media_attempt_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lease_token is not null
    and new.lease_token is null
    and new.failure_stage is not null
    and new.failure_code is not null
  then
    insert into public.annotation_media_attempt_failures (
      media_id, attempt_count, failure_stage, failure_code
    ) values (
      new.id, new.attempt_count, new.failure_stage, new.failure_code
    );
  end if;
  return new;
end;
$$;

comment on function private.record_annotation_media_attempt_failure() is
  'Appends the failure from a lease release. A later claim does not delete it.';

revoke all on function private.record_annotation_media_attempt_failure()
  from public, anon, authenticated;

create trigger annotation_media_attempt_failure_record
  after update on public.annotation_media
  for each row
  execute function private.record_annotation_media_attempt_failure();
