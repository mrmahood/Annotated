-- Close the concurrent-insert race on the three-source cap. Two transactions
-- can both pass the unique URL check and insert before either AFTER INSERT
-- count sees the other row. A transaction advisory lock on the annotation
-- serializes those inserts: the second waits until the first commits, then
-- counts the committed row and raises 23514.
--
-- Do not edit 20261013050000. That migration is already applied and recorded
-- on Staging. Replacing the function body is enough; the existing AFTER INSERT
-- trigger keeps calling this function.

create or replace function private.limit_annotation_receipt_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.annotation_id::text));

  if (
    select pg_catalog.count(*)
    from public.annotation_receipt_sources
    where annotation_receipt_sources.annotation_id = new.annotation_id
  ) > 3 then
    raise exception using
      errcode = '23514',
      message = 'An annotation can have at most 3 receipt sources.';
  end if;
  return null;
end;
$$;

comment on function private.limit_annotation_receipt_sources() is
  'AFTER INSERT cap of three approved receipt sources. Takes a transaction advisory lock on the annotation so concurrent inserts cannot both pass the count. Runs after row level security and the unique URL constraint. Empty search_path.';

revoke all on function private.limit_annotation_receipt_sources() from public, anon, authenticated;
