-- Migration 006: Corrige o tipo do id retornado nas funções de busca RAG (uuid -> bigint)
-- para alinhar com o tipo real da coluna id na tabela documents.

DROP FUNCTION IF EXISTS public.match_documents(vector, integer, jsonb);
DROP FUNCTION IF EXISTS public.match_documents_hybrid(text, vector, integer, jsonb);

-- 1. match_documents
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1536),
  match_count integer DEFAULT 20,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  id bigint, -- Corrigido de uuid para bigint
  content text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE plpgsql
AS $function$
begin
  return query
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where (filter = '{}'::jsonb or documents.metadata @> filter)
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$function$;

-- 2. match_documents_hybrid
CREATE OR REPLACE FUNCTION public.match_documents_hybrid(
  query_text text,
  query_embedding vector(1536),
  match_count integer DEFAULT 20,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  id bigint, -- Corrigido de uuid para bigint
  content text,
  metadata jsonb,
  score double precision
)
LANGUAGE plpgsql
AS $function$
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
$function$;
