-- Phase F1a: claim intake may only target currently published annotations.
-- Additive policy replacement. Does not alter applied migration history.
-- Media-only removed pages remain claimable because those annotations stay
-- published while media is marked removed.

drop policy if exists claims_public_submit on public.claims;

create policy claims_public_submit
on public.claims
for insert
to anon, authenticated
with check (
  status = 'submitted'
  and exists (
    select 1
    from public.annotations as annotations
    where annotations.id = annotation_id
      and annotations.status = 'published'
  )
);

comment on policy claims_public_submit on public.claims is
  'Public clients may insert claims only as submitted, and only when the target annotation is currently published. Draft, hidden, and removed annotations are rejected. No client SELECT, UPDATE, or DELETE grant or policy exists; review remains service-role only.';
