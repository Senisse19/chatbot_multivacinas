-- Migration 001: alinha assinatura do RPC match_documents com o código.
--
-- O código em src/services/rag.service.ts chama:
--   supabase.rpc("match_documents", { query_embedding, match_count, filter })
-- mas a definição original no README não tinha `filter`. Esta migration
-- adiciona o parâmetro opcional e prepara terreno para o filtro de
-- metadados da Fase 3.3 (vacina, faixa_etaria, tipo).
--
-- Idempotente: usa CREATE OR REPLACE.
--
-- IMPORTANTE: se o embedding em uso for text-embedding-3-large, troque
-- `vector(1536)` por `vector(3072)`.

create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default 20,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
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
$$;
