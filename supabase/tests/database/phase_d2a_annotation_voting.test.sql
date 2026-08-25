begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

select has_table('public', 'annotation_votes', 'vote rows exist in the public schema'); -- 1
select columns_are( -- 2
  'public',
  'annotation_votes',
  array['annotation_id', 'user_id', 'value', 'created_at', 'updated_at'],
  'vote rows expose only the intended columns'
);
select col_is_pk( -- 3
  'public', 'annotation_votes', array['annotation_id', 'user_id'],
  'one vote row is allowed per annotation and user'
);
select ok( -- 4
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.annotation_votes'::regclass
      and conname = 'annotation_votes_value_check'
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), 'value = ANY') > 0
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(oid), '-1') > 0
  ),
  'vote direction is constrained to -1 or 1'
);
select has_index( -- 5
  'public', 'annotation_votes', 'annotation_votes_user_updated_at_idx',
  'user vote maintenance has a bounded supporting index'
);
select ok( -- 6
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.annotation_votes'::regclass
  )
  and not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'public.annotation_votes'::regclass
  ),
  'vote rows force RLS and define no client policy'
);
select ok( -- 7
  not pg_catalog.has_table_privilege('anon', 'public.annotation_votes', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_votes', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'public.annotation_votes', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.annotation_votes', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.annotation_votes', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.annotation_votes', 'insert'),
  'no API role has direct vote graph access'
);

select has_table( -- 8
  'private', 'annotation_vote_pair_rate_limits',
  'the per-user and annotation limiter is private'
);
select ok( -- 9
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'private.annotation_vote_pair_rate_limits'::regclass
  )
  and not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'private.annotation_vote_pair_rate_limits'::regclass
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'private.annotation_vote_pair_rate_limits', 'select'
  ),
  'pair limiter state forces RLS and is unavailable to the API roles'
);
select has_table( -- 10
  'private', 'annotation_vote_user_rate_limits',
  'the cross-annotation user limiter is private'
);
select ok( -- 11
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'private.annotation_vote_user_rate_limits'::regclass
  )
  and not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'private.annotation_vote_user_rate_limits'::regclass
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'private.annotation_vote_user_rate_limits', 'select'
  ),
  'global limiter state forces RLS and is unavailable to the API roles'
);
select ok( -- 12
  (
    select prosecdef
      and proconfig @> array['search_path=""']
      and proconfig @> array['statement_timeout=5s']
      and proconfig @> array['lock_timeout=2s']
    from pg_catalog.pg_proc
    where oid = 'public.get_public_annotation_vote_totals(uuid[])'::regprocedure
  ),
  'the public aggregate has a hardened bounded definer context'
);
select ok( -- 13
  pg_catalog.has_function_privilege(
    'anon', 'public.get_public_annotation_vote_totals(uuid[])', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.get_public_annotation_vote_totals(uuid[])', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.get_public_annotation_vote_totals(uuid[])', 'execute'
  ),
  'only aggregate execution is available to public API roles'
);
select ok( -- 14
  (
    select prosecdef
      and proconfig @> array['search_path=""']
      and proconfig @> array['statement_timeout=5s']
      and proconfig @> array['lock_timeout=2s']
      and (
        pg_catalog.char_length(pg_catalog.pg_get_functiondef(oid))
        - pg_catalog.char_length(
            pg_catalog.replace(
              pg_catalog.pg_get_functiondef(oid),
              'for update skip locked',
              ''
            )
          )
      ) / pg_catalog.char_length('for update skip locked') = 2
    from pg_catalog.pg_proc
    where oid = 'public.mutate_annotation_vote(uuid,uuid,smallint)'::regprocedure
  ),
  'the trusted mutation has a hardened bounded definer context'
);
select ok( -- 15
  not pg_catalog.has_function_privilege(
    'anon', 'public.mutate_annotation_vote(uuid,uuid,smallint)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.mutate_annotation_vote(uuid,uuid,smallint)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.mutate_annotation_vote(uuid,uuid,smallint)', 'execute'
  ),
  'only the trusted service boundary can mutate votes'
);

set local role anon;
select throws_ok( -- 16
  $$select * from public.annotation_votes$$,
  '42501',
  'permission denied for table annotation_votes',
  'anonymous clients cannot read vote rows'
);
reset role;

set local role authenticated;
select throws_ok( -- 17
  $$insert into public.annotation_votes (annotation_id, user_id, value)
    values ('d2a10000-0000-4000-8000-000000000001',
            'd2a00000-0000-4000-8000-000000000002', 1)$$,
  '42501',
  'permission denied for table annotation_votes',
  'authenticated clients cannot write vote rows'
);
reset role;

set local role service_role;
select throws_ok( -- 18
  $$select * from public.annotation_votes$$,
  '42501',
  'permission denied for table annotation_votes',
  'the service API role cannot bypass the trusted mutation to read identities'
);
reset role;

select lives_ok( -- 19
  $$
    insert into auth.users (id, raw_user_meta_data) values
      ('d2a00000-0000-4000-8000-000000000001', '{"full_name":"D2A Creator"}'::jsonb),
      ('d2a00000-0000-4000-8000-000000000002', '{"full_name":"D2A Voter Two"}'::jsonb),
      ('d2a00000-0000-4000-8000-000000000003', '{"full_name":"D2A Voter Three"}'::jsonb),
      ('d2a00000-0000-4000-8000-000000000004', '{"full_name":"D2A Voter Four"}'::jsonb),
      ('d2a00000-0000-4000-8000-000000000005', '{"full_name":"D2A Voter Five"}'::jsonb),
      ('d2a00000-0000-4000-8000-000000000006', '{"full_name":"D2A Voter Six"}'::jsonb);

    update public.profiles
    set username = 'd2a-creator'
    where id = 'd2a00000-0000-4000-8000-000000000001';

    insert into public.sources (
      id, normalized_url, canonical_url, source_type, title
    ) values (
      'd2a20000-0000-4000-8000-000000000001',
      'https://example.test/d2a/votes',
      'https://example.test/d2a/votes',
      'article',
      'D2a voting source'
    );

    insert into public.annotations (
      id, source_id, user_id, annotation_type, commentary_text, status, published_at
    ) values
      ('d2a10000-0000-4000-8000-000000000001', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a annotation one', 'published', pg_catalog.now()),
      ('d2a10000-0000-4000-8000-000000000002', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a annotation two', 'published', pg_catalog.now()),
      ('d2a10000-0000-4000-8000-000000000003', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a annotation three', 'published', pg_catalog.now()),
      ('d2a10000-0000-4000-8000-000000000004', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a annotation four', 'published', pg_catalog.now()),
      ('d2a10000-0000-4000-8000-000000000005', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a annotation five', 'published', pg_catalog.now()),
      ('d2a10000-0000-4000-8000-000000000006', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a annotation six', 'published', pg_catalog.now()),
      ('d2a10000-0000-4000-8000-000000000007', 'd2a20000-0000-4000-8000-000000000001', 'd2a00000-0000-4000-8000-000000000001', 'article_text', 'D2a private draft', 'draft', null);
  $$,
  'exact disposable voting fixtures are valid'
);

select is_empty( -- 20
  $$select * from public.get_public_annotation_vote_totals(array[]::uuid[])$$,
  'an empty bounded aggregate request is valid and empty'
);
select results_eq( -- 21
  $$select annotation_id, upvote_count, downvote_count
    from public.get_public_annotation_vote_totals(
      array['d2a10000-0000-4000-8000-000000000001'::uuid]
    )$$,
  $$values ('d2a10000-0000-4000-8000-000000000001'::uuid, 0::bigint, 0::bigint)$$,
  'published annotations return explicit separate zero totals'
);
select results_eq( -- 22
  $$select annotation_id
    from public.get_public_annotation_vote_totals(
      array[
        'd2a10000-0000-4000-8000-000000000003'::uuid,
        'd2a10000-0000-4000-8000-000000000001'::uuid
      ]
    )$$,
  $$values
      ('d2a10000-0000-4000-8000-000000000003'::uuid),
      ('d2a10000-0000-4000-8000-000000000001'::uuid)$$,
  'aggregate rows preserve the unique requested order'
);
select results_eq( -- 23
  $$select annotation_id
    from public.get_public_annotation_vote_totals(
      array[
        'd2a10000-0000-4000-8000-000000000007'::uuid,
        'd2afffff-0000-4000-8000-000000000001'::uuid,
        'd2a10000-0000-4000-8000-000000000001'::uuid
      ]
    )$$,
  $$values ('d2a10000-0000-4000-8000-000000000001'::uuid)$$,
  'draft and unknown annotations are omitted without existence disclosure'
);
select throws_ok( -- 24
  $$select * from public.get_public_annotation_vote_totals(null)$$,
  '22023', 'Vote aggregate request is invalid.',
  'a null aggregate request is rejected with one bounded error'
);
select throws_ok( -- 25
  $$select * from public.get_public_annotation_vote_totals(array[null]::uuid[])$$,
  '22023', 'Vote aggregate request is invalid.',
  'null aggregate IDs are rejected with one bounded error'
);
select throws_ok( -- 26
  $$select * from public.get_public_annotation_vote_totals(
    array[
      'd2a10000-0000-4000-8000-000000000001'::uuid,
      'd2a10000-0000-4000-8000-000000000001'::uuid
    ])$$,
  '22023', 'Vote aggregate request is invalid.',
  'duplicate aggregate IDs are rejected'
);
select throws_ok( -- 27
  $$select * from public.get_public_annotation_vote_totals(
    array(select pg_catalog.gen_random_uuid() from pg_catalog.generate_series(1, 101))
  )$$,
  '22023', 'Vote aggregate request is invalid.',
  'aggregate input is bounded to one hundred unique IDs'
);

select is( -- 28
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000002',
    'd2a10000-0000-4000-8000-000000000001', 0::smallint
  )),
  'INVALID_VOTE',
  'invalid vote values return a bounded code'
);
select is( -- 29
  (select result_code from public.mutate_annotation_vote(
    null, 'd2a10000-0000-4000-8000-000000000001', 1::smallint
  )),
  'VOTE_UNAVAILABLE',
  'a null trusted user ID returns a bounded code'
);
select is( -- 30
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000002', null, 1::smallint
  )),
  'ANNOTATION_UNAVAILABLE',
  'a null annotation ID returns a bounded code'
);
select is( -- 31
  (select result_code from public.mutate_annotation_vote(
    'd2afffff-0000-4000-8000-000000000001',
    'd2a10000-0000-4000-8000-000000000001', 1::smallint
  )),
  'VOTE_UNAVAILABLE',
  'an unknown user does not expose profile detail'
);
select is( -- 32
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000002',
    'd2afffff-0000-4000-8000-000000000001', 1::smallint
  )),
  'ANNOTATION_UNAVAILABLE',
  'an unknown annotation does not expose detail'
);
select is( -- 33
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000001',
    'd2a10000-0000-4000-8000-000000000001', 1::smallint
  )),
  'SELF_VOTE_FORBIDDEN',
  'annotation creators cannot vote on their own annotations'
);
select is( -- 34
  (select pg_catalog.count(*)
   from private.annotation_vote_user_rate_limits
   where user_id = 'd2a00000-0000-4000-8000-000000000001'),
  0::bigint,
  'rejected self-votes consume no limiter state'
);
select is( -- 35
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000002',
    'd2a10000-0000-4000-8000-000000000007', 1::smallint
  )),
  'ANNOTATION_UNAVAILABLE',
  'private annotations cannot be voted on'
);
select results_eq( -- 36
  $$select result_code, current_vote, upvote_count, downvote_count, retry_after_seconds
    from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000002',
      'd2a10000-0000-4000-8000-000000000001', 1::smallint
    )$$,
  $$values ('CREATED'::text, 1::smallint, 1::bigint, 0::bigint, null::integer)$$,
  'a first vote is atomically created with bounded state and totals'
);
select results_eq( -- 37
  $$select upvote_count, downvote_count
    from public.get_public_annotation_vote_totals(
      array['d2a10000-0000-4000-8000-000000000001'::uuid]
    )$$,
  $$values (1::bigint, 0::bigint)$$,
  'the public aggregate reflects the created vote without identities'
);
select is( -- 38
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000002',
    'd2a10000-0000-4000-8000-000000000001', 1::smallint
  )),
  'UNCHANGED',
  'an idempotent vote request has a stable bounded result'
);
select is( -- 39
  (select result_code from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000002',
    'd2a10000-0000-4000-8000-000000000001', -1::smallint
  )),
  'CHANGED',
  'a direction change updates the one existing vote'
);
select results_eq( -- 40
  $$select result_code, upvote_count, downvote_count
    from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000003',
      'd2a10000-0000-4000-8000-000000000001', 1::smallint
    )$$,
  $$values ('CREATED'::text, 1::bigint, 1::bigint)$$,
  'separate up and down totals never collapse to a net score'
);
select results_eq( -- 41
  $$select result_code, current_vote, upvote_count, downvote_count
    from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000002',
      'd2a10000-0000-4000-8000-000000000001', null
    )$$,
  $$values ('CLEARED'::text, null::smallint, 1::bigint, 0::bigint)$$,
  'clearing removes only the caller vote and returns current totals'
);

do $$
declare
  request_number integer;
begin
  for request_number in 1..19 loop
    perform * from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000003',
      'd2a10000-0000-4000-8000-000000000002', 1::smallint
    );
  end loop;
  perform * from public.mutate_annotation_vote(
    'd2a00000-0000-4000-8000-000000000003',
    'd2a10000-0000-4000-8000-000000000002', -1::smallint
  );
end;
$$;

select ok( -- 42
  (
    select result_code = 'RATE_LIMITED'
      and current_vote = -1
      and retry_after_seconds between 1 and 600
    from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000003',
      'd2a10000-0000-4000-8000-000000000002', 1::smallint
    )
  )
  and (
    select value = -1
    from public.annotation_votes
    where user_id = 'd2a00000-0000-4000-8000-000000000003'
      and annotation_id = 'd2a10000-0000-4000-8000-000000000002'
  ),
  'the twenty-first pair mutation is rejected with bounded retry and no vote change'
);
select results_eq( -- 43
  $$select pair_limits.mutation_count, user_limits.mutation_count
    from private.annotation_vote_pair_rate_limits as pair_limits
    join private.annotation_vote_user_rate_limits as user_limits using (user_id)
    where pair_limits.user_id = 'd2a00000-0000-4000-8000-000000000003'
      and pair_limits.annotation_id = 'd2a10000-0000-4000-8000-000000000002'$$,
  $$values (20::smallint, 21::smallint)$$,
  'rejected pair mutations increment neither fixed-window counter'
);

update private.annotation_vote_pair_rate_limits
set window_started_at = pg_catalog.now() - interval '11 minutes'
where user_id = 'd2a00000-0000-4000-8000-000000000003'
  and annotation_id = 'd2a10000-0000-4000-8000-000000000002';

create temporary table d2a_pair_reset_result on commit drop as
select * from public.mutate_annotation_vote(
  'd2a00000-0000-4000-8000-000000000003',
  'd2a10000-0000-4000-8000-000000000002',
  1::smallint
);

select ok( -- 44
  (select result_code = 'CHANGED' and current_vote = 1
   from d2a_pair_reset_result)
  and (
    select limits.mutation_count = 1
    from private.annotation_vote_pair_rate_limits as limits
    where limits.user_id = 'd2a00000-0000-4000-8000-000000000003'
      and limits.annotation_id = 'd2a10000-0000-4000-8000-000000000002'
  ),
  'an expired pair window resets on the next accepted request'
);

do $$
declare
  annotation_number integer;
  request_number integer;
begin
  for annotation_number in 1..5 loop
    for request_number in 1..20 loop
      perform * from public.mutate_annotation_vote(
        'd2a00000-0000-4000-8000-000000000004',
        ('d2a10000-0000-4000-8000-' || pg_catalog.lpad(annotation_number::text, 12, '0'))::uuid,
        (case when request_number % 2 = 0 then 1 else -1 end)::smallint
      );
    end loop;
  end loop;
end;
$$;

select ok( -- 45
  (
    select result_code = 'RATE_LIMITED'
      and current_vote is null
      and retry_after_seconds between 1 and 600
    from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000004',
      'd2a10000-0000-4000-8000-000000000006', 1::smallint
    )
  )
  and not exists (
    select 1 from public.annotation_votes
    where user_id = 'd2a00000-0000-4000-8000-000000000004'
      and annotation_id = 'd2a10000-0000-4000-8000-000000000006'
  )
  and (
    select mutation_count = 100
    from private.annotation_vote_user_rate_limits
    where user_id = 'd2a00000-0000-4000-8000-000000000004'
  ),
  'the one-hundred-and-first cross-annotation mutation is rejected without a vote'
);

update private.annotation_vote_user_rate_limits
set window_started_at = pg_catalog.now() - interval '11 minutes'
where user_id = 'd2a00000-0000-4000-8000-000000000004';

create temporary table d2a_user_reset_result on commit drop as
select * from public.mutate_annotation_vote(
  'd2a00000-0000-4000-8000-000000000004',
  'd2a10000-0000-4000-8000-000000000006',
  1::smallint
);

select ok( -- 46
  (select result_code = 'CREATED' and current_vote = 1
   from d2a_user_reset_result)
  and (
    select limits.mutation_count = 1
    from private.annotation_vote_user_rate_limits as limits
    where limits.user_id = 'd2a00000-0000-4000-8000-000000000004'
  ),
  'an expired global window resets independently on the next accepted request'
);

insert into private.annotation_vote_pair_rate_limits (
  user_id, annotation_id, window_started_at, mutation_count
) values (
  'd2a00000-0000-4000-8000-000000000005',
  'd2a10000-0000-4000-8000-000000000006',
  pg_catalog.now() - interval '11 minutes',
  1
);
insert into private.annotation_vote_user_rate_limits (
  user_id, window_started_at, mutation_count
) values (
  'd2a00000-0000-4000-8000-000000000005',
  pg_catalog.now() - interval '11 minutes',
  1
);

create temporary table d2a_cleanup_result on commit drop as
select * from public.mutate_annotation_vote(
  'd2a00000-0000-4000-8000-000000000006',
  'd2a10000-0000-4000-8000-000000000001',
  1::smallint
);

select ok( -- 47
  (select result_code = 'CREATED' from d2a_cleanup_result)
  and not exists (
    select 1 from private.annotation_vote_pair_rate_limits
    where user_id = 'd2a00000-0000-4000-8000-000000000005'
  )
  and not exists (
    select 1 from private.annotation_vote_user_rate_limits
    where user_id = 'd2a00000-0000-4000-8000-000000000005'
  ),
  'accepted mutations opportunistically delete expired private limiter state'
);

update public.annotations
set status = 'hidden'
where id = 'd2a10000-0000-4000-8000-000000000001';

select is_empty( -- 48
  $$select * from public.get_public_annotation_vote_totals(
    array['d2a10000-0000-4000-8000-000000000001'::uuid]
  )$$,
  'nonpublished annotations expose no aggregate row'
);
select ok( -- 49
  (
    select result_code = 'ANNOTATION_UNAVAILABLE'
    from public.mutate_annotation_vote(
      'd2a00000-0000-4000-8000-000000000006',
      'd2a10000-0000-4000-8000-000000000001', -1::smallint
    )
  )
  and (
    select value = 1
    from public.annotation_votes
    where user_id = 'd2a00000-0000-4000-8000-000000000006'
      and annotation_id = 'd2a10000-0000-4000-8000-000000000001'
  ),
  'publication withdrawal blocks mutation without rewriting stored vote state'
);

delete from auth.users
where id = 'd2a00000-0000-4000-8000-000000000006';

select ok( -- 50
  not exists (
    select 1 from public.annotation_votes
    where user_id = 'd2a00000-0000-4000-8000-000000000006'
  )
  and not exists (
    select 1 from private.annotation_vote_pair_rate_limits
    where user_id = 'd2a00000-0000-4000-8000-000000000006'
  )
  and not exists (
    select 1 from private.annotation_vote_user_rate_limits
    where user_id = 'd2a00000-0000-4000-8000-000000000006'
  ),
  'user deletion cascades private vote and limiter state'
);
select is( -- 51
  (select pg_catalog.count(*) from public.annotation_comments
   where annotation_id::text like 'd2a1%'),
  0::bigint,
  'voting creates no comments or other social interaction records'
);
select ok( -- 52
  (select status = 'hidden' and published_at is not null
   from public.annotations
   where id = 'd2a10000-0000-4000-8000-000000000001')
  and (
    select pg_catalog.count(*) = 7
    from public.annotations
    where source_id = 'd2a20000-0000-4000-8000-000000000001'
  ),
  'vote mutations do not alter annotation identity, publication history, or discovery rows'
);

select * from finish();
rollback;
