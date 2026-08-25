create function public.get_current_annotation_vote(
  p_user_id uuid,
  p_annotation_id uuid
)
returns table (
  annotation_id uuid,
  current_vote smallint
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $$
  select annotations.id, votes.value
  from public.annotations
  join public.profiles as caller
    on caller.id = p_user_id
  left join public.annotation_votes as votes
    on votes.annotation_id = annotations.id
   and votes.user_id = caller.id
  where annotations.id = p_annotation_id
    and annotations.status = 'published';
$$;

comment on function public.get_current_annotation_vote(uuid, uuid) is
  'Service-only one-annotation projection returning only the verified user current vote for a published annotation; it exposes no other voter identity or graph data.';

revoke all on function public.get_current_annotation_vote(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_current_annotation_vote(uuid, uuid)
  to service_role;
