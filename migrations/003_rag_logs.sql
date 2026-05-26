-- Migration 003: tabela de observabilidade do RAG.
--
-- Cada chamada de searchDocuments registra um log estruturado para permitir:
--   - calibrar thresholds (strong/weak) com base em dados reais;
--   - identificar perguntas que caem em BASE_VAZIA com frequência;
--   - medir latência e taxa de hit do cache.
--
-- O log é assíncrono (best-effort) — falha de insert não derruba o pipeline.

create table if not exists rag_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id bigint,
  original_query text not null,
  expanded_queries text[],
  filters jsonb,
  status text not null check (status in ('strong', 'weak', 'empty')),
  top_score float,
  doc_ids uuid[],
  latency_ms int,
  cache_hit boolean default false
);

create index if not exists rag_logs_created_at_idx on rag_logs(created_at desc);
create index if not exists rag_logs_status_idx on rag_logs(status);
create index if not exists rag_logs_cache_hit_idx on rag_logs(cache_hit);
