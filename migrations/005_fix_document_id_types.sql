-- Migration 005: alinha funções/logs ao tipo real de documents.id.
--
-- O schema atual usa documents.id como bigint. As migrations anteriores
-- declaravam id uuid no retorno do RPC híbrido, causando:
-- "structure of query does not match function result type".

drop function if exists match_documents_hybrid(text, vector, int, jsonb);

create function match_documents_hybrid (
  query_text text,
  query_embedding vector(1536),
  match_count int default 20,
  filter jsonb default '{}'::jsonb
)
returns table (
  id bigint,
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

alter table rag_logs add column if not exists doc_ids_text text[];

update rag_logs
set doc_ids_text = (
  select array_agg(doc_id::text)
  from unnest(doc_ids) as doc_id
)
where doc_ids is not null
  and doc_ids_text is null;

alter table rag_logs drop column if exists doc_ids;
alter table rag_logs rename column doc_ids_text to doc_ids;
