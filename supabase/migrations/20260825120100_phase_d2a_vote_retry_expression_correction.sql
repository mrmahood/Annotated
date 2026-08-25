-- GREATEST is PostgreSQL expression syntax rather than a pg_catalog routine.
-- Keep the already-applied D2a migration immutable and correct only the three
-- retry-bound expressions after verifying the expected definition is present.
do $$
declare
  mutation_definition text;
  qualified_occurrences integer;
begin
  mutation_definition := pg_catalog.pg_get_functiondef(
    'public.mutate_annotation_vote(uuid,uuid,smallint)'::regprocedure
  );

  qualified_occurrences := (
    pg_catalog.char_length(mutation_definition)
    - pg_catalog.char_length(
        pg_catalog.replace(mutation_definition, 'pg_catalog.greatest', '')
      )
  ) / pg_catalog.char_length('pg_catalog.greatest');

  if qualified_occurrences <> 3 then
    raise exception using
      errcode = 'P0001',
      message = 'Unexpected D2a vote mutation definition; retry correction aborted.';
  end if;

  execute pg_catalog.replace(
    mutation_definition,
    'pg_catalog.greatest',
    'greatest'
  );
end;
$$;
