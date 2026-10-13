-- Annotation classification: Fact check, Receipts, Context, Steelman, and Hot take,
-- plus an optional verdict and the source links Fact check and Receipts require.
-- Agree/disagree continues to use annotation_votes. Helpful ratings are per source
-- because that table is one row per user per annotation.
-- Historical publish signatures stay in place so existing article publication keeps
-- working. The extended signatures are the ones Create calls, and they require a type.

alter table public.annotations
  add column note_type text,
  add column verdict text;

alter table public.annotations
  add constraint annotations_note_type_check check (
    note_type is null or note_type in (
      'fact_check', 'receipts', 'context', 'steelman', 'hot_take'
    )
  ),
  add constraint annotations_verdict_check check (
    verdict is null or verdict in ('true', 'misleading', 'false', 'needs_context')
  ),
  add constraint annotations_fact_check_verdict_check check (
    note_type is distinct from 'fact_check' or verdict is not null
  );

comment on column public.annotations.note_type is
  'Creator classification: fact_check, receipts, context, steelman, or hot_take. Null on historical rows.';

comment on column public.annotations.verdict is
  'Optional truth label: true, misleading, false, or needs_context. Required when note_type is fact_check.';

create table public.annotation_sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  annotation_id uuid not null references public.annotations (id) on delete cascade,
  url text not null,
  position smallint not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint annotation_sources_position_check check (position between 1 and 8),
  constraint annotation_sources_url_check check (
    pg_catalog.char_length(url) between 1 and 2000
    and url ~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
  ),
  constraint annotation_sources_annotation_position_key unique (annotation_id, position),
  constraint annotation_sources_annotation_url_key unique (annotation_id, url)
);

comment on table public.annotation_sources is
  'Public HTTP(S) source links attached when an annotation is classified. Fact check and Receipts require at least one.';

alter table public.annotation_sources enable row level security;

revoke all privileges on table public.annotation_sources
  from public, anon, authenticated, service_role;

grant select on table public.annotation_sources to anon, authenticated;

create policy annotation_sources_published_read
on public.annotation_sources
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.annotations
    where annotations.id = annotation_sources.annotation_id
      and (
        annotations.status = 'published'
        or annotations.user_id = (select auth.uid())
      )
  )
);

comment on policy annotation_sources_published_read on public.annotation_sources is
  'Source links are readable on published annotations and on the owner''s own drafts. Clients cannot insert, update, or delete them.';

create table public.annotation_source_votes (
  source_id uuid not null references public.annotation_sources (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (source_id, user_id),
  constraint annotation_source_votes_value_check check (value = 1)
);

comment on table public.annotation_source_votes is
  'Private helpful marks on annotation source links. One row per user and source. Agree/disagree stays on annotation_votes.';

alter table public.annotation_source_votes enable row level security;
alter table public.annotation_source_votes force row level security;

revoke all privileges on table public.annotation_source_votes
  from public, anon, authenticated, service_role;

create function private.protect_annotation_note_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.note_type is distinct from old.note_type
    or new.verdict is distinct from old.verdict then
    if pg_catalog.current_user() in ('authenticated', 'anon', 'authenticator') then
      raise exception using
        errcode = '42501',
        message = 'Annotation type and verdict are set when the annotation is published.';
    end if;
  end if;
  return new;
end;
$$;

comment on function private.protect_annotation_note_columns() is
  'Blocks client updates of note_type and verdict. The security-definer classification function runs as its owner and may set them once.';

revoke all on function private.protect_annotation_note_columns()
  from public, anon, authenticated, service_role;

create trigger annotations_protect_note_columns
before update of note_type, verdict on public.annotations
for each row execute function private.protect_annotation_note_columns();

create function private.enforce_annotation_note_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
begin
  if new.note_type is null or new.note_type not in ('fact_check', 'receipts') then
    return null;
  end if;

  select pg_catalog.count(*)::integer
  into source_count
  from public.annotation_sources
  where annotation_sources.annotation_id = new.id;

  if source_count < 1 then
    raise exception using
      errcode = '22023',
      message = 'Fact check and Receipts require at least one source link.';
  end if;

  return null;
end;
$$;

comment on function private.enforce_annotation_note_sources() is
  'Requires a fact check or receipts annotation to have at least one source link. Sources are written before note_type, so this runs at the end of that statement.';

revoke all on function private.enforce_annotation_note_sources()
  from public, anon, authenticated, service_role;

create trigger annotations_note_sources_required
after insert or update of note_type, verdict on public.annotations
for each row
when (new.note_type in ('fact_check', 'receipts'))
execute function private.enforce_annotation_note_sources();

create function private.apply_annotation_note(
  p_annotation_id uuid,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_existing text;
  v_type text := nullif(pg_catalog.btrim(p_note_type), '');
  v_verdict text := nullif(pg_catalog.btrim(p_verdict), '');
  v_url text;
  v_clean text[] := array[]::text[];
  v_position smallint := 0;
begin
  if p_annotation_id is null or auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to classify an annotation.';
  end if;

  select annotations.user_id, annotations.note_type
  into v_owner, v_existing
  from public.annotations
  where annotations.id = p_annotation_id
  for update;

  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to classify an annotation.';
  end if;

  if v_existing is not null then
    raise exception using
      errcode = '22023',
      message = 'Annotation type is already set.';
  end if;

  if v_type is null or v_type not in (
    'fact_check', 'receipts', 'context', 'steelman', 'hot_take'
  ) then
    raise exception using
      errcode = '22023',
      message = 'An annotation type is required.';
  end if;

  if v_verdict is not null and v_verdict not in (
    'true', 'misleading', 'false', 'needs_context'
  ) then
    raise exception using
      errcode = '22023',
      message = 'The verdict is not recognized.';
  end if;

  if v_type = 'fact_check' and v_verdict is null then
    raise exception using
      errcode = '22023',
      message = 'A fact check requires a verdict.';
  end if;

  if p_source_urls is not null then
    foreach v_url in array p_source_urls loop
      v_url := pg_catalog.btrim(v_url);
      if v_url is null or v_url = '' then
        continue;
      end if;
      if pg_catalog.char_length(v_url) > 2000
        or v_url !~* '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
        raise exception using
          errcode = '22023',
          message = 'Each source link must be an HTTP or HTTPS URL.';
      end if;
      if pg_catalog.array_position(v_clean, v_url) is null then
        v_clean := v_clean || v_url;
      end if;
    end loop;
  end if;

  if pg_catalog.cardinality(v_clean) > 8 then
    raise exception using
      errcode = '22023',
      message = 'At most 8 source links are allowed.';
  end if;

  if v_type in ('fact_check', 'receipts') and pg_catalog.cardinality(v_clean) < 1 then
    raise exception using
      errcode = '22023',
      message = 'Fact check and Receipts require at least one source link.';
  end if;

  if pg_catalog.cardinality(v_clean) > 0 then
    foreach v_url in array v_clean loop
      v_position := (v_position + 1)::smallint;
      insert into public.annotation_sources (annotation_id, url, position)
      values (p_annotation_id, v_url, v_position);
    end loop;
  end if;

  update public.annotations
  set note_type = v_type,
      verdict = v_verdict
  where annotations.id = p_annotation_id;
end;
$$;

comment on function private.apply_annotation_note(uuid, text, text, text[]) is
  'Owner-only, one-time classification used by the extended publish RPCs. Validates the type, fact-check verdict, and source links, then writes them.';

revoke all on function private.apply_annotation_note(uuid, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function private.apply_annotation_note(uuid, text, text, text[])
  to authenticated;

create function private.consume_annotation_response_rate(
  p_user_id uuid,
  p_annotation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_pair_window_started_at timestamptz;
  v_pair_mutation_count smallint;
  v_user_window_started_at timestamptz;
  v_user_mutation_count smallint;
  v_pair_retry integer := 0;
  v_user_retry integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('annotation-vote-user:' || p_user_id::text, 0)
  );

  select limits.window_started_at, limits.mutation_count
  into v_pair_window_started_at, v_pair_mutation_count
  from private.annotation_vote_pair_rate_limits as limits
  where limits.user_id = p_user_id
    and limits.annotation_id = p_annotation_id
  for update;

  if not found or v_pair_window_started_at <= v_now - interval '10 minutes' then
    v_pair_window_started_at := v_now;
    v_pair_mutation_count := 0;
  end if;

  select limits.window_started_at, limits.mutation_count
  into v_user_window_started_at, v_user_mutation_count
  from private.annotation_vote_user_rate_limits as limits
  where limits.user_id = p_user_id
  for update;

  if not found or v_user_window_started_at <= v_now - interval '10 minutes' then
    v_user_window_started_at := v_now;
    v_user_mutation_count := 0;
  end if;

  if v_pair_mutation_count >= 20 then
    v_pair_retry := pg_catalog.ceil(
      extract(epoch from v_pair_window_started_at + interval '10 minutes' - v_now)
    )::integer;
    if v_pair_retry < 1 then
      v_pair_retry := 1;
    end if;
  end if;

  if v_user_mutation_count >= 100 then
    v_user_retry := pg_catalog.ceil(
      extract(epoch from v_user_window_started_at + interval '10 minutes' - v_now)
    )::integer;
    if v_user_retry < 1 then
      v_user_retry := 1;
    end if;
  end if;

  if v_pair_retry > 0 or v_user_retry > 0 then
    if v_pair_retry > v_user_retry then
      return v_pair_retry;
    end if;
    return v_user_retry;
  end if;

  insert into private.annotation_vote_pair_rate_limits (
    user_id, annotation_id, window_started_at, mutation_count
  ) values (
    p_user_id, p_annotation_id, v_pair_window_started_at, (v_pair_mutation_count + 1)::smallint
  )
  on conflict (user_id, annotation_id) do update
  set window_started_at = excluded.window_started_at,
      mutation_count = excluded.mutation_count;

  insert into private.annotation_vote_user_rate_limits (
    user_id, window_started_at, mutation_count
  ) values (
    p_user_id, v_user_window_started_at, (v_user_mutation_count + 1)::smallint
  )
  on conflict (user_id) do update
  set window_started_at = excluded.window_started_at,
      mutation_count = excluded.mutation_count;

  return 0;
end;
$$;

comment on function private.consume_annotation_response_rate(uuid, uuid) is
  'Shares the existing annotation vote rate-limit tables: 20 mutations per user and annotation, and 100 per user, in a ten-minute window.';

revoke all on function private.consume_annotation_response_rate(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.get_annotation_consensus(p_annotation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_status text;
  v_viewer uuid := auth.uid();
  v_agree bigint;
  v_disagree bigint;
  v_viewer_agreement smallint;
  v_sources jsonb;
begin
  if p_annotation_id is null then
    return null;
  end if;

  select annotations.status
  into v_status
  from public.annotations
  where annotations.id = p_annotation_id;

  if v_status is distinct from 'published' then
    return null;
  end if;

  select
    pg_catalog.count(*) filter (where votes.value = 1)::bigint,
    pg_catalog.count(*) filter (where votes.value = -1)::bigint
  into v_agree, v_disagree
  from public.annotation_votes as votes
  where votes.annotation_id = p_annotation_id;

  select votes.value
  into v_viewer_agreement
  from public.annotation_votes as votes
  where votes.annotation_id = p_annotation_id
    and votes.user_id = v_viewer;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', sources.id,
      'url', sources.url,
      'position', sources.position,
      'helpful_count', (
        select pg_catalog.count(*)::bigint
        from public.annotation_source_votes as helpful
        where helpful.source_id = sources.id
          and helpful.value = 1
      ),
      'viewer_helpful', exists (
        select 1
        from public.annotation_source_votes as helpful
        where helpful.source_id = sources.id
          and helpful.user_id = v_viewer
          and helpful.value = 1
      )
    )
    order by sources.position
  )
  into v_sources
  from public.annotation_sources as sources
  where sources.annotation_id = p_annotation_id;

  if v_sources is null then
    v_sources := '[]'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object(
    'annotation_id', p_annotation_id,
    'agree_count', v_agree,
    'disagree_count', v_disagree,
    'viewer_agreement', v_viewer_agreement,
    'sources', v_sources
  );
end;
$$;

comment on function public.get_annotation_consensus(uuid) is
  'Published agree/disagree totals from annotation_votes, plus helpful counts on that annotation''s source links. The caller''s own marks are included; other voters are not.';

revoke all on function public.get_annotation_consensus(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_annotation_consensus(uuid)
  to anon, authenticated;

create function public.cast_annotation_agreement(
  p_annotation_id uuid,
  p_value smallint
)
returns table (
  result_code text,
  current_vote smallint,
  upvote_count bigint,
  downvote_count bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if auth.uid() is null then
    return query
    select 'VOTE_UNAVAILABLE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  if p_value is not null and p_value not in (-1, 1) then
    return query
    select 'INVALID_VOTE'::text, null::smallint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  return query
  select *
  from public.mutate_annotation_vote(auth.uid(), p_annotation_id, p_value);
end;
$$;

comment on function public.cast_annotation_agreement(uuid, smallint) is
  'Authenticated agree (1) or disagree (-1) vote. Reuses mutate_annotation_vote, including its self-vote ban and rate limits. Null clears the caller''s vote.';

revoke all on function public.cast_annotation_agreement(uuid, smallint)
  from public, anon, authenticated, service_role;

grant execute on function public.cast_annotation_agreement(uuid, smallint)
  to authenticated;

create function public.rate_annotation_source_helpful(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_caller uuid := auth.uid();
  v_annotation_id uuid;
  v_owner uuid;
  v_status text;
  v_retry integer;
  v_exists boolean := false;
  v_helpful bigint;
  v_result text;
begin
  if v_caller is null then
    return pg_catalog.jsonb_build_object(
      'result_code', 'AUTH_REQUIRED',
      'helpful_count', 0,
      'viewer_helpful', false,
      'retry_after_seconds', null
    );
  end if;

  if p_source_id is null then
    return pg_catalog.jsonb_build_object(
      'result_code', 'SOURCE_UNAVAILABLE',
      'helpful_count', 0,
      'viewer_helpful', false,
      'retry_after_seconds', null
    );
  end if;

  select sources.annotation_id, annotations.user_id, annotations.status
  into v_annotation_id, v_owner, v_status
  from public.annotation_sources as sources
  join public.annotations as annotations
    on annotations.id = sources.annotation_id
  where sources.id = p_source_id;

  if v_annotation_id is null or v_status is distinct from 'published' then
    return pg_catalog.jsonb_build_object(
      'result_code', 'SOURCE_UNAVAILABLE',
      'helpful_count', 0,
      'viewer_helpful', false,
      'retry_after_seconds', null
    );
  end if;

  if v_owner = v_caller then
    return pg_catalog.jsonb_build_object(
      'result_code', 'SELF_RATE_FORBIDDEN',
      'helpful_count', (
        select pg_catalog.count(*)::bigint
        from public.annotation_source_votes as helpful
        where helpful.source_id = p_source_id
      ),
      'viewer_helpful', false,
      'retry_after_seconds', null
    );
  end if;

  v_retry := private.consume_annotation_response_rate(v_caller, v_annotation_id);
  if v_retry > 0 then
    return pg_catalog.jsonb_build_object(
      'result_code', 'RATE_LIMITED',
      'helpful_count', (
        select pg_catalog.count(*)::bigint
        from public.annotation_source_votes as helpful
        where helpful.source_id = p_source_id
      ),
      'viewer_helpful', exists (
        select 1
        from public.annotation_source_votes as helpful
        where helpful.source_id = p_source_id
          and helpful.user_id = v_caller
      ),
      'retry_after_seconds', v_retry
    );
  end if;

  select true
  into v_exists
  from public.annotation_source_votes as helpful
  where helpful.source_id = p_source_id
    and helpful.user_id = v_caller;

  if v_exists then
    delete from public.annotation_source_votes as helpful
    where helpful.source_id = p_source_id
      and helpful.user_id = v_caller;
    v_result := 'CLEARED';
  else
    insert into public.annotation_source_votes (source_id, user_id, value)
    values (p_source_id, v_caller, 1);
    v_result := 'CREATED';
  end if;

  select pg_catalog.count(*)::bigint
  into v_helpful
  from public.annotation_source_votes as helpful
  where helpful.source_id = p_source_id;

  return pg_catalog.jsonb_build_object(
    'result_code', v_result,
    'helpful_count', v_helpful,
    'viewer_helpful', v_result = 'CREATED',
    'retry_after_seconds', null
  );
end;
$$;

comment on function public.rate_annotation_source_helpful(uuid) is
  'Toggles the caller''s helpful mark on one published source link. Creators cannot rate their own sources. Rate limits reuse the annotation vote windows.';

revoke all on function public.rate_annotation_source_helpful(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.rate_annotation_source_helpful(uuid)
  to authenticated;

create function public.publish_article_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_page_title text,
  p_author text,
  p_publisher text,
  p_selected_text text,
  p_text_prefix text,
  p_text_suffix text,
  p_commentary_text text,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  annotation_id uuid;
begin
  annotation_id := public.publish_article_annotation(
    p_normalized_url,
    p_canonical_url,
    p_page_title,
    p_author,
    p_publisher,
    p_selected_text,
    p_text_prefix,
    p_text_suffix,
    p_commentary_text,
    p_title
  );

  perform private.apply_annotation_note(
    annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return annotation_id;
end;
$$;

comment on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text, text, text, text, text[]) is
  'Publishes an article annotation and requires a classification. Fact check requires a verdict and a source link. Receipts require a source link.';

revoke all on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.publish_article_annotation(text, text, text, text, text, text, text, text, text, text, text, text, text[])
  to authenticated;

create function public.publish_article_annotation_with_audio(
  p_normalized_url text,
  p_canonical_url text,
  p_page_title text,
  p_author text,
  p_publisher text,
  p_selected_text text,
  p_text_prefix text,
  p_text_suffix text,
  p_commentary_text text,
  p_storage_path text,
  p_audio_duration_ms integer,
  p_audio_mime_type text,
  p_audio_byte_size integer,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  annotation_id uuid;
begin
  annotation_id := public.publish_article_annotation_with_audio(
    p_normalized_url,
    p_canonical_url,
    p_page_title,
    p_author,
    p_publisher,
    p_selected_text,
    p_text_prefix,
    p_text_suffix,
    p_commentary_text,
    p_storage_path,
    p_audio_duration_ms,
    p_audio_mime_type,
    p_audio_byte_size,
    p_title
  );

  perform private.apply_annotation_note(
    annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return annotation_id;
end;
$$;

comment on function public.publish_article_annotation_with_audio(text, text, text, text, text, text, text, text, text, text, integer, text, integer, text, text, text, text[]) is
  'Publishes an article annotation with owner audio and the same required classification as text publication.';

revoke all on function public.publish_article_annotation_with_audio(text, text, text, text, text, text, text, text, text, text, integer, text, integer, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.publish_article_annotation_with_audio(text, text, text, text, text, text, text, text, text, text, integer, text, integer, text, text, text, text[])
  to authenticated;

create function public.begin_hosted_youtube_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_video_id text,
  p_video_title text,
  p_channel_name text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_row record;
begin
  select *
  into created_row
  from public.begin_hosted_youtube_annotation(
    p_normalized_url,
    p_canonical_url,
    p_video_id,
    p_video_title,
    p_channel_name,
    p_start_ms,
    p_end_ms,
    p_commentary_text,
    p_title
  );

  perform private.apply_annotation_note(
    created_row.annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return query
  select
    created_row.annotation_id,
    created_row.media_id,
    created_row.creator_handle,
    created_row.annotation_slug,
    created_row.processing_status;
end;
$$;

comment on function public.begin_hosted_youtube_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[]) is
  'Begins a hosted YouTube draft and stores the required classification on that draft.';

revoke all on function public.begin_hosted_youtube_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.begin_hosted_youtube_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[])
  to authenticated;

create function public.begin_hosted_audio_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_episode_title text,
  p_author text,
  p_publisher text,
  p_show_name text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_row record;
begin
  select *
  into created_row
  from public.begin_hosted_audio_annotation(
    p_normalized_url,
    p_canonical_url,
    p_episode_title,
    p_author,
    p_publisher,
    p_show_name,
    p_start_ms,
    p_end_ms,
    p_commentary_text,
    p_title
  );

  perform private.apply_annotation_note(
    created_row.annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return query
  select
    created_row.annotation_id,
    created_row.media_id,
    created_row.creator_handle,
    created_row.annotation_slug,
    created_row.processing_status;
end;
$$;

comment on function public.begin_hosted_audio_annotation(text, text, text, text, text, text, integer, integer, text, text, text, text, text[]) is
  'Begins a hosted audio draft and stores the required classification on that draft.';

revoke all on function public.begin_hosted_audio_annotation(text, text, text, text, text, text, integer, integer, text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.begin_hosted_audio_annotation(text, text, text, text, text, text, integer, integer, text, text, text, text, text[])
  to authenticated;

create function public.begin_hosted_spotify_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_episode_id text,
  p_episode_title text,
  p_author text,
  p_show_name text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_row record;
begin
  select *
  into created_row
  from public.begin_hosted_spotify_annotation(
    p_normalized_url,
    p_canonical_url,
    p_episode_id,
    p_episode_title,
    p_author,
    p_show_name,
    p_start_ms,
    p_end_ms,
    p_commentary_text,
    p_title
  );

  perform private.apply_annotation_note(
    created_row.annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return query
  select
    created_row.annotation_id,
    created_row.media_id,
    created_row.creator_handle,
    created_row.annotation_slug,
    created_row.processing_status;
end;
$$;

comment on function public.begin_hosted_spotify_annotation(text, text, text, text, text, text, integer, integer, text, text, text, text, text[]) is
  'Begins a hosted Spotify draft and stores the required classification on that draft.';

revoke all on function public.begin_hosted_spotify_annotation(text, text, text, text, text, text, integer, integer, text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.begin_hosted_spotify_annotation(text, text, text, text, text, text, integer, integer, text, text, text, text, text[])
  to authenticated;

create function public.begin_hosted_tiktok_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_video_id text,
  p_video_title text,
  p_author text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_row record;
begin
  select *
  into created_row
  from public.begin_hosted_tiktok_annotation(
    p_normalized_url,
    p_canonical_url,
    p_video_id,
    p_video_title,
    p_author,
    p_start_ms,
    p_end_ms,
    p_commentary_text,
    p_title
  );

  perform private.apply_annotation_note(
    created_row.annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return query
  select
    created_row.annotation_id,
    created_row.media_id,
    created_row.creator_handle,
    created_row.annotation_slug,
    created_row.processing_status;
end;
$$;

comment on function public.begin_hosted_tiktok_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[]) is
  'Begins a hosted TikTok draft and stores the required classification on that draft.';

revoke all on function public.begin_hosted_tiktok_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.begin_hosted_tiktok_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[])
  to authenticated;

create function public.begin_hosted_webpage_video_annotation(
  p_normalized_url text,
  p_canonical_url text,
  p_page_title text,
  p_author text,
  p_publisher text,
  p_start_ms integer,
  p_end_ms integer,
  p_commentary_text text,
  p_title text,
  p_note_type text,
  p_verdict text,
  p_source_urls text[]
)
returns table (
  annotation_id uuid,
  media_id uuid,
  creator_handle text,
  annotation_slug text,
  processing_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_row record;
begin
  select *
  into created_row
  from public.begin_hosted_webpage_video_annotation(
    p_normalized_url,
    p_canonical_url,
    p_page_title,
    p_author,
    p_publisher,
    p_start_ms,
    p_end_ms,
    p_commentary_text,
    p_title
  );

  perform private.apply_annotation_note(
    created_row.annotation_id,
    p_note_type,
    p_verdict,
    p_source_urls
  );

  return query
  select
    created_row.annotation_id,
    created_row.media_id,
    created_row.creator_handle,
    created_row.annotation_slug,
    created_row.processing_status;
end;
$$;

comment on function public.begin_hosted_webpage_video_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[]) is
  'Begins a hosted webpage-video draft and stores the required classification on that draft.';

revoke all on function public.begin_hosted_webpage_video_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[])
  from public, anon, authenticated, service_role;

grant execute on function public.begin_hosted_webpage_video_annotation(text, text, text, text, text, integer, integer, text, text, text, text, text[])
  to authenticated;
