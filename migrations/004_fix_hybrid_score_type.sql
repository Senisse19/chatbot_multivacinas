-- Migration 004: fixes match_documents_hybrid score type.
--
-- Some Postgres expressions with 1.0 are inferred as numeric, while the RPC
-- returns table declares score as float. Supabase then raises:
-- "structure of query does not match function result type".

create or replace function match_documents_hybrid (
  query_text text,
  query_embedding vector(1536),
  match_count int default 20,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  score float
)
language plpgsql
as $$
declare
  k constant int := 60;
begin
  return query
  with vector_search as (
    select
      d.id,
      row_number() over (order by d.embedding <=> query_embedding) as rank
    from documents d
    where (filter = '{}'::jsonb or d.metadata @> filter)
    order by d.embedding <=> query_embedding
    limit match_count
  ),
  fts_search as (
    select
      d.id,
      row_number() over (
        order by ts_rank(d.fts, plainto_tsquery('portuguese', query_text)) desc
      ) as rank
    from documents d
    where d.fts @@ plainto_tsquery('portuguese', query_text)
      and (filter = '{}'::jsonb or d.metadata @> filter)
    limit match_count
  )
  select
    d.id,
    d.content,
    d.metadata,
    (
      coalesce(1.0::float / (k + v.rank), 0::float) +
      coalesce(1.0::float / (k + f.rank), 0::float)
    )::float as score
  from documents d
  left join vector_search v on v.id = d.id
  left join fts_search f on f.id = d.id
  where v.id is not null or f.id is not null
  order by score desc
  limit match_count;
end;
$$;
