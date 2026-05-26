-- Migration 002: busca híbrida (Postgres FTS + pgvector + Reciprocal Rank Fusion).
--
-- Por quê: a busca puramente vetorial perde termos próprios pouco frequentes
-- (Beyfortus, Abrysvo, Shingrix). FTS captura esses casos. RRF combina os dois
-- rankings sem precisar normalizar scores entre paradigmas diferentes.
--
-- Idempotente.
--
-- IMPORTANTE: requer extensão `unaccent` (já vem habilitada em Supabase por
-- padrão na maioria dos projetos). Verifique com:
--   select * from pg_extension where extname = 'unaccent';

-- ── 1. Coluna FTS gerada automaticamente ────────────────────────────────────
alter table documents
  add column if not exists fts tsvector
  generated always as (to_tsvector('portuguese', coalesce(content, ''))) stored;

create index if not exists documents_fts_idx on documents using gin(fts);

-- ── 2. Função híbrida com RRF ───────────────────────────────────────────────
-- A constante k=60 é o valor canônico da literatura de RRF (Cormack et al.).
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
