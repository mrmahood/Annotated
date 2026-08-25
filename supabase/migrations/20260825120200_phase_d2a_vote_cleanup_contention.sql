-- Cleanup is best-effort maintenance and must not wait on limiter rows owned by
-- another in-flight mutation. Verify the exact prior definition, then make
-- both bounded candidate scans lock only immediately available expired rows.
do $$
declare
  mutation_definition text;
  cleanup_limit_occurrences integer;
  expected_fragment constant text := E'    limit 25\n  );';
  replacement_fragment constant text := E'    limit 25\n    for update skip locked\n  );';
begin
  mutation_definition := pg_catalog.pg_get_functiondef(
    'public.mutate_annotation_vote(uuid,uuid,smallint)'::regprocedure
  );

  cleanup_limit_occurrences := (
    pg_catalog.char_length(mutation_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(mutation_definition, expected_fragment, '')
      )
  ) / pg_catalog.char_length(expected_fragment);

  if cleanup_limit_occurrences <> 2 then
    raise exception using
      errcode = 'P0001',
      message = 'Unexpected D2a vote mutation definition; cleanup correction aborted.';
  end if;

  execute pg_catalog.replace(
    mutation_definition,
    expected_fragment,
    replacement_fragment
  );
end;
$$;
