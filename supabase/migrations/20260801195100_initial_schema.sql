-- Initial data foundation for Annotated.
-- Client access is intentionally limited by both explicit grants and row level security.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint profiles_username_length check (
    username is null or pg_catalog.char_length(username) between 3 and 30
  ),
  constraint profiles_username_format check (
    username is null or username ~ '^[a-z0-9_-]+$'
  ),
  constraint profiles_bio_length check (
    bio is null or pg_catalog.char_length(bio) <= 280
  )
);

create unique index profiles_username_lower_key
  on public.profiles (pg_catalog.lower(username))
  where username is not null;

create table public.sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  normalized_url text not null,
  canonical_url text not null,
  source_type text not null,
  title text,
  author text,
  publisher text,
  thumbnail_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint sources_normalized_url_key unique (normalized_url),
  constraint sources_source_type_check check (
    source_type in ('article', 'youtube', 'podcast')
  ),
  constraint sources_normalized_url_scheme_check check (
    normalized_url ~ '^https?://'
  ),
  constraint sources_canonical_url_scheme_check check (
    canonical_url ~ '^https?://'
  ),
  constraint sources_metadata_object_check check (
    pg_catalog.jsonb_typeof(metadata) = 'object'
  )
);

create table public.annotations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  source_id uuid not null references public.sources (id),
  user_id uuid not null references public.profiles (id),
  annotation_type text not null,
  commentary_text text,
  commentary_audio_path text,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint annotations_annotation_type_check check (
    annotation_type in ('article_text', 'video_clip', 'audio_clip')
  ),
  constraint annotations_status_check check (
    status in ('draft', 'published', 'claim_pending', 'hidden', 'removed')
  ),
  constraint annotations_commentary_text_length check (
    commentary_text is null or pg_catalog.char_length(commentary_text) <= 2000
  ),
  constraint annotations_published_at_check check (
    status <> 'published' or published_at is not null
  )
);

create table public.annotation_targets (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  annotation_id uuid not null unique
    references public.annotations (id) on delete cascade,
  target_type text not null,
  selected_text text,
  text_prefix text,
  text_suffix text,
  start_ms integer,
  end_ms integer,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_targets_target_type_check check (
    target_type in ('text', 'time_range')
  ),
  constraint annotation_targets_text_prefix_length check (
    text_prefix is null or pg_catalog.char_length(text_prefix) <= 500
  ),
  constraint annotation_targets_text_suffix_length check (
    text_suffix is null or pg_catalog.char_length(text_suffix) <= 500
  ),
  constraint annotation_targets_shape_check check (
    (
      target_type = 'text'
      and selected_text is not null
      and pg_catalog.char_length(selected_text) <= 2000
      and start_ms is null
      and end_ms is null
    )
    or
    (
      target_type = 'time_range'
      and selected_text is null
      and start_ms is not null
      and end_ms is not null
      and start_ms >= 0
      and end_ms > start_ms
      and end_ms - start_ms <= 90000
    )
  )
);

create table public.claims (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  annotation_id uuid not null references public.annotations (id),
  claimant_name text not null,
  claimant_email text not null,
  relationship_to_content text not null,
  reason text not null,
  details text,
  status text not null default 'submitted',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint claims_claimant_name_length check (
    pg_catalog.btrim(claimant_name) <> ''
    and pg_catalog.char_length(claimant_name) <= 200
  ),
  constraint claims_claimant_email_length check (
    pg_catalog.btrim(claimant_email) <> ''
    and pg_catalog.char_length(claimant_email) <= 320
  ),
  constraint claims_relationship_length check (
    pg_catalog.btrim(relationship_to_content) <> ''
    and pg_catalog.char_length(relationship_to_content) <= 200
  ),
  constraint claims_reason_length check (
    pg_catalog.btrim(reason) <> ''
    and pg_catalog.char_length(reason) <= 2000
  ),
  constraint claims_details_length check (
    details is null or pg_catalog.char_length(details) <= 5000
  ),
  constraint claims_status_check check (
    status in ('submitted', 'reviewing', 'resolved', 'rejected')
  )
);

create index annotations_source_id_idx on public.annotations (source_id);
create index annotations_user_id_idx on public.annotations (user_id);
create index annotations_status_published_at_idx
  on public.annotations (status, published_at desc);
create index claims_annotation_id_idx on public.claims (annotation_id);
create index claims_status_idx on public.claims (status);

-- sources.normalized_url and annotation_targets.annotation_id are indexed by their
-- required unique constraints, so separate duplicate indexes are not created.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger-only function that replaces client-supplied updated_at values; an empty search_path prevents object shadowing.';

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger sources_set_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

create trigger annotations_set_updated_at
before update on public.annotations
for each row execute function public.set_updated_at();

create trigger claims_set_updated_at
before update on public.claims
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_metadata jsonb;
  safe_display_name text;
  safe_avatar_url text;
begin
  user_metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(user_metadata) <> 'object' then
    user_metadata := '{}'::jsonb;
  end if;

  safe_display_name := coalesce(
    nullif(pg_catalog.btrim(user_metadata ->> 'full_name'), ''),
    nullif(pg_catalog.btrim(user_metadata ->> 'name'), '')
  );
  safe_avatar_url := coalesce(
    nullif(pg_catalog.btrim(user_metadata ->> 'avatar_url'), ''),
    nullif(pg_catalog.btrim(user_metadata ->> 'picture'), '')
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, safe_display_name, safe_avatar_url);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'SECURITY DEFINER auth trigger that copies only allow-listed display/avatar metadata into a profile. It uses an empty search_path, schema-qualified objects, and never creates a public username.';

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.annotations enable row level security;
alter table public.annotation_targets enable row level security;
alter table public.claims enable row level security;

revoke all privileges on table public.profiles from public, anon, authenticated, service_role;
revoke all privileges on table public.sources from public, anon, authenticated, service_role;
revoke all privileges on table public.annotations from public, anon, authenticated, service_role;
revoke all privileges on table public.annotation_targets from public, anon, authenticated, service_role;
revoke all privileges on table public.claims from public, anon, authenticated, service_role;

-- The trusted service role bypasses RLS but still needs explicit table privileges
-- for server workflows such as claim review. Structural privileges are withheld.
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.sources to service_role;
grant select, insert, update, delete on table public.annotations to service_role;
grant select, insert, update, delete on table public.annotation_targets to service_role;
grant select, insert, update, delete on table public.claims to service_role;

grant select on table public.profiles to anon, authenticated;
grant update on table public.profiles to authenticated;

grant select on table public.sources to anon, authenticated;
grant insert on table public.sources to authenticated;

grant select on table public.annotations to anon, authenticated;
grant insert, update, delete on table public.annotations to authenticated;

grant select on table public.annotation_targets to anon, authenticated;
grant insert, update, delete on table public.annotation_targets to authenticated;

grant insert on table public.claims to anon, authenticated;

create policy profiles_public_read
on public.profiles
for select
to anon, authenticated
using (true);

comment on policy profiles_public_read on public.profiles is
  'Profiles are public identity records; this policy grants row visibility but no private auth data.';

create policy profiles_owner_update
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

comment on policy profiles_owner_update on public.profiles is
  'Authenticated clients may update only the profile whose primary key matches their JWT subject; direct client inserts have no grant or policy.';

create policy sources_public_read
on public.sources
for select
to anon, authenticated
using (true);

comment on policy sources_public_read on public.sources is
  'Sources are shared public records and contain no per-user draft data.';

create policy sources_authenticated_insert
on public.sources
for insert
to authenticated
with check (true);

comment on policy sources_authenticated_insert on public.sources is
  'Signed-in clients may add shared sources; no client update or delete policy or grant exists.';

create policy annotations_published_read
on public.annotations
for select
to anon, authenticated
using (status = 'published');

comment on policy annotations_published_read on public.annotations is
  'Public reads expose only annotations explicitly marked published; the table constraint also requires published_at.';

create policy annotations_owner_read
on public.annotations
for select
to authenticated
using ((select auth.uid()) = user_id);

comment on policy annotations_owner_read on public.annotations is
  'An authenticated owner may read all of their annotations, including private drafts and moderation states.';

create policy annotations_owner_insert
on public.annotations
for insert
to authenticated
with check ((select auth.uid()) = user_id);

comment on policy annotations_owner_insert on public.annotations is
  'An authenticated client can create annotations only under its own profile id.';

create policy annotations_owner_update
on public.annotations
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

comment on policy annotations_owner_update on public.annotations is
  'Only the owner may update an annotation, and the owner cannot transfer it by changing user_id.';

create policy annotations_owner_delete_draft
on public.annotations
for delete
to authenticated
using ((select auth.uid()) = user_id and status = 'draft');

comment on policy annotations_owner_delete_draft on public.annotations is
  'Client deletion is limited to the owner''s drafts; published and moderated records require server-side handling.';

create policy annotation_targets_published_read
on public.annotation_targets
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_targets.annotation_id
      and annotations.status = 'published'
  )
);

comment on policy annotation_targets_published_read on public.annotation_targets is
  'A target is public only when its parent annotation is visible as published.';

create policy annotation_targets_owner_read
on public.annotation_targets
for select
to authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_targets.annotation_id
      and annotations.user_id = (select auth.uid())
  )
);

comment on policy annotation_targets_owner_read on public.annotation_targets is
  'Owners may read targets attached to any of their own annotations, including drafts.';

create policy annotation_targets_owner_insert
on public.annotation_targets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_targets.annotation_id
      and annotations.user_id = (select auth.uid())
  )
);

comment on policy annotation_targets_owner_insert on public.annotation_targets is
  'A target can be inserted only under an annotation owned by the authenticated user.';

create policy annotation_targets_owner_update
on public.annotation_targets
for update
to authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_targets.annotation_id
      and annotations.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_targets.annotation_id
      and annotations.user_id = (select auth.uid())
  )
);

comment on policy annotation_targets_owner_update on public.annotation_targets is
  'Both the old and new parent annotation must belong to the authenticated user.';

create policy annotation_targets_owner_delete
on public.annotation_targets
for delete
to authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_targets.annotation_id
      and annotations.user_id = (select auth.uid())
  )
);

comment on policy annotation_targets_owner_delete on public.annotation_targets is
  'Only the owner of the parent annotation may delete its target.';

create policy claims_public_submit
on public.claims
for insert
to anon, authenticated
with check (status = 'submitted');

comment on policy claims_public_submit on public.claims is
  'Public clients may submit claims only in the submitted state. No client SELECT, UPDATE, or DELETE grant or policy exists; review uses service-role access.';

comment on table public.claims is
  'Copyright/fair-use claims are write-only to public clients and confidential to server-side review tooling.';
