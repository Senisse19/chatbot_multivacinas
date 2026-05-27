# Chatbot MultiVacinas — Maria Antônia

Serviço Node.js/TypeScript que substitui o fluxo n8n da MultiVacinas. A assistente virtual chama-se **Maria Antônia**.

## Stack
- **Express** — servidor webhook
- **OpenAI** — agente principal `gpt-5.4-mini` (reasoning tokens, anti-alucinação) + `gpt-5.4-nano` para query expansion + Whisper para transcrição + embeddings
- **Supabase** — base vetorial (pgvector) + Postgres FTS (busca híbrida) + observabilidade
- **Cohere** — reranker multilingual
- **Chatwoot** — CRM / envio de mensagens / persistência de BANT (additional_attributes)
- **Telegram** — alertas de escalada para a equipe

## Estrutura

```
src/
├── index.ts                    # Servidor Express
├── config.ts                   # Validação de variáveis de ambiente
├── types/
│   └── chatwoot.types.ts       # Tipos do webhook
├── agents/
│   ├── prompt.ts               # System prompt da Maria Antônia (humanizado)
│   ├── tools.ts                # Ferramentas OpenAI (function calling)
│   └── agent.ts                # Agentic loop + split de mensagens
├── controllers/
│   └── webhook.controller.ts   # Handler do webhook Chatwoot
├── services/
│   ├── chatwoot.service.ts     # API Chatwoot
│   ├── rag.service.ts          # Busca híbrida (FTS+pgvector+RRF) + reranker
│   ├── rag.cache.ts            # Cache LRU em memória das respostas RAG
│   ├── telegram.service.ts     # Alertas Telegram
│   └── queue.service.ts        # Debounce de mensagens encavaladas
└── utils/
    └── retry.ts                # Retry com backoff para APIs externas

migrations/
├── 001_match_documents_filter.sql  # Filtro de metadados no RPC vetorial
├── 002_hybrid_search.sql           # Coluna FTS + função match_documents_hybrid
├── 003_rag_logs.sql                # Tabela de observabilidade
├── 004_fix_hybrid_score_type.sql   # Correção do tipo score no RPC híbrido
└── 005_fix_document_id_types.sql   # Alinha RPC/logs ao tipo de documents.id

eval/
├── questions.json              # 28 perguntas de baseline para o RAG
└── run.ts                      # Runner do eval set (npm run eval:rag)
```

## Configuração

1. Copiar `.env.example` para `.env` e preencher todas as variáveis (ver tabela abaixo).
2. Instalar dependências:
   ```bash
   npm install
   ```
3. Aplicar as migrations no Supabase (na ordem). Você pode rodar o SQL pelo painel ou via Supabase MCP / CLI:
   - `migrations/001_match_documents_filter.sql`
   - `migrations/002_hybrid_search.sql`
   - `migrations/003_rag_logs.sql`
   - `migrations/004_fix_hybrid_score_type.sql`
   - `migrations/005_fix_document_id_types.sql`

> **Embedding size:** as migrations assumem `vector(1536)` (text-embedding-3-small). Se usar `text-embedding-3-large`, troque para `vector(3072)`.

## Executar

```bash
# Desenvolvimento (hot-reload)
npm run dev

# Produção
npm run build && npm start
```

## Eval set do RAG

```bash
npm run eval:rag
```

Roda as 28 perguntas baseline contra o pipeline real (com cache desligado) e imprime uma tabela markdown com:
- hit rate por status (`strong`/`weak`/`empty`)
- conteúdo esperado vs. retornado (substrings case-insensitive sem acento)
- latência média e p95

Use o eval **antes e depois** de qualquer mudança no `rag.service.ts` ou na base de documentos para verificar regressão.

## Configurar Webhook no Chatwoot

No painel do Chatwoot, vá em **Configurações → Integrações → Webhooks** e adicione:

```
URL: https://SEU_DOMINIO/webhook/chatwoot
Eventos: message_created
```

## Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão: 3000) |
| `OPENAI_API_KEY` | Chave da API OpenAI |
| `OPENAI_MODEL` | Modelo principal do agente (padrão: `gpt-5.4-mini`). Família GPT-5 traz reasoning tokens, que combatem alucinação. |
| `OPENAI_REASONING_EFFORT` | Nível de raciocínio: `none` / `low` / `medium` / `high` (padrão: `low`). `low` é o melhor equilíbrio latência × precisão para WhatsApp. Aumente se ainda houver erros factuais. |
| `OPENAI_EMBEDDING_MODEL` | Modelo de embedding (padrão: text-embedding-3-small) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave de serviço do Supabase |
| `COHERE_API_KEY` | Chave da API Cohere |
| `CHATWOOT_BASE_URL` | URL base do Chatwoot |
| `CHATWOOT_API_TOKEN` | Token de acesso da conta Chatwoot |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo para alertas (fallback global) |
| `MESSAGE_DEBOUNCE_MS` | Janela de debounce em ms (padrão: 20000) |
| `RAG_TOP_K` | Documentos retornados pela busca antes do reranker (padrão: 20) |
| `RAG_TOP_N` | Documentos após reranker (padrão: 5) |
| `RAG_EXPAND_MODEL` | Modelo usado na query expansion (padrão: `gpt-5.4-nano` — tarefa simples, ~75% mais barato que mini) |
| `RAG_CACHE_DISABLED` | `true` para desligar o cache em memória do RAG |

## Migrations no Supabase (referência rápida)

### `match_documents` (com filtro)
Aceita filtro opcional de metadados:
```sql
select * from match_documents(
  '[1,2,3,...]'::vector,
  20,
  '{"faixa_etaria": "adolescente"}'::jsonb
);
```

### `match_documents_hybrid` (FTS + vetor + RRF)
Combina busca vetorial e full-text com Reciprocal Rank Fusion (k=60):
```sql
select * from match_documents_hybrid(
  'vacina HPV adolescente Gardasil',
  '[...]'::vector,
  20,
  '{"tipo": "bula"}'::jsonb
);
```

### `rag_logs`
Cada chamada de `searchDocuments` registra um log para calibrar thresholds e ver perguntas que caem em `empty`. Útil para investigar:
```sql
select created_at, original_query, status, top_score, latency_ms
from rag_logs
order by created_at desc
limit 50;

-- Perguntas frequentes que caem em empty
select original_query, count(*) as freq
from rag_logs
where status = 'empty' and created_at > now() - interval '7 days'
group by original_query
order by freq desc;
```

## Persistência do BANT

A Maria Antônia grava o BANT que coleta em `additional_attributes.bant` no contato (visível no Chatwoot). Em conversas futuras com o mesmo contato, ela carrega o BANT existente e não repete perguntas. A escalação para humano (Telegram) reaproveita o BANT salvo automaticamente.

## Estrutura recomendada de metadados nos documentos

Para tirar proveito do filtro de metadados (Fase 3.3), popule `metadata` na tabela `documents` com:

```json
{
  "vacina": "gardasil_9",
  "tipo": "bula",
  "faixa_etaria": "adolescente",
  "fonte": "gardasi_9_bula_pro.pdf"
}
```

Valores aceitos:
- `tipo`: `"bula"` | `"calendario"`
- `faixa_etaria`: `"crianca"` | `"adolescente"` | `"adulto"` | `"idoso"` | `"gestante"` | `"todos"`
- `vacina`: slug livre (ex.: `"gardasil_9"`, `"shingrix"`).

Sem metadados, a busca continua funcionando — apenas perde a possibilidade de filtrar.
