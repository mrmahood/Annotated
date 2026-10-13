-- The first tweet-capture migration created the screenshot owner policies on
-- storage.objects, not on public.annotation_tweet_captures. A policy list for
-- the annotation table therefore shows only published_read. Recreate the
-- storage policies here so an already-applied database gains them even if that
-- step did not land, and so a fresh database still has them after this file.
--
-- The receipt cap used to be a BEFORE INSERT trigger. It raised 23514 before
-- the unique (annotation_id, url) constraint and before the owner insert
-- policy, so a duplicate URL and another user's insert were both reported as
-- the three-source cap. The cap now runs AFTER INSERT: row level security
-- rejects the other user, the unique constraint rejects the duplicate, and
-- only a fourth distinct source hits the cap.

alter table public.annotation_receipt_sources
  drop constraint if exists annotation_receipt_sources_annotation_url_key;

alter table public.annotation_receipt_sources
  add constraint annotation_receipt_sources_annotation_url_key
  unique (annotation_id, url);

drop policy if exists annotation_receipt_sources_owner_insert
  on public.annotation_receipt_sources;

create policy annotation_receipt_sources_owner_insert
on public.annotation_receipt_sources
for insert
to authenticated
with check (
  origin = 'ai-suggested'
  and exists (
    select 1
    from public.annotations
    where annotations.id = annotation_receipt_sources.annotation_id
      and annotations.user_id = (select auth.uid())
      and annotations.status = 'published'
  )
);

comment on policy annotation_receipt_sources_owner_insert on public.annotation_receipt_sources is
  'Only the owner of a published annotation may attach an approved AI-suggested source. There is no client update or delete.';

create or replace function private.limit_annotation_receipt_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  'AFTER INSERT cap of three approved receipt sources. Runs after row level security and the unique URL constraint. Empty search_path.';

revoke all on function private.limit_annotation_receipt_sources() from public, anon, authenticated;

drop trigger if exists annotation_receipt_sources_limit
  on public.annotation_receipt_sources;

create trigger annotation_receipt_sources_limit
after insert on public.annotation_receipt_sources
for each row execute function private.limit_annotation_receipt_sources();

drop policy if exists annotation_tweet_captures_owner_insert on storage.objects;
drop policy if exists annotation_tweet_captures_owner_select on storage.objects;
drop policy if exists annotation_tweet_captures_owner_delete on storage.objects;

create policy annotation_tweet_captures_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'annotation-tweet-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy annotation_tweet_captures_owner_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'annotation-tweet-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy annotation_tweet_captures_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'annotation-tweet-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

comment on policy annotation_tweet_captures_owner_insert on storage.objects is
  'Authenticated users may upload only new JPEG post screenshots below their UUID folder; no UPDATE policy permits upsert.';
comment on policy annotation_tweet_captures_owner_select on storage.objects is
  'Authenticated users may read only their own post screenshots in annotation-tweet-captures.';
comment on policy annotation_tweet_captures_owner_delete on storage.objects is
  'Authenticated users may delete only their own post screenshots in annotation-tweet-captures.';
