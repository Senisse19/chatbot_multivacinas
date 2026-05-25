# Chatbot MultiVacinas

Serviço Node.js/TypeScript que substitui o fluxo n8n da MultiVacinas.

## Stack
- **Express** — servidor webhook
- **OpenAI** (`gpt-4.1-mini` + Whisper + embeddings)
- **Supabase** — base vetorial (pgvector)
- **Cohere** — reranker multilingual
- **Chatwoot** — CRM / envio de mensagens
- **Telegram** — alertas de escalada para a equipe

## Estrutura

```
src/
├── index.ts                    # Servidor Express
├── config.ts                   # Validação de variáveis de ambiente
├── types/
│   └── chatwoot.types.ts       # Tipos do webhook
├── agents/
│   ├── prompt.ts               # System prompt aprimorado
│   ├── tools.ts                # Ferramentas OpenAI (function calling)
│   └── agent.ts                # Agentic loop + split de mensagens
├── controllers/
│   └── webhook.controller.ts   # Handler do webhook Chatwoot
└── services/
    ├── chatwoot.service.ts     # API Chatwoot
    ├── rag.service.ts          # Busca vetorial + reranker
    ├── telegram.service.ts     # Alertas Telegram
    └── queue.service.ts        # Debounce de mensagens encavaladas
```

## Configuração

1. Copiar `.env.example` para `.env` e preencher todas as variáveis.
2. Instalar dependências:
   ```bash
   npm install
   ```
3. Garantir que a função RPC `match_documents` existe no Supabase (ver abaixo).

## Função RPC no Supabase

Execute no SQL Editor do Supabase:

```sql
create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default 20
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
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

> **Nota:** Verifique o tamanho do embedding (1536 para `text-embedding-3-small`, 3072 para `text-embedding-3-large`). Ajuste se necessário.

## Executar

```bash
# Desenvolvimento (hot-reload)
npm run dev

# Produção
npm run build && npm start
```

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
| `OPENAI_MODEL` | Modelo de chat (padrão: gpt-4.1-mini) |
| `OPENAI_EMBEDDING_MODEL` | Modelo de embedding |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave de serviço do Supabase |
| `COHERE_API_KEY` | Chave da API Cohere |
| `CHATWOOT_BASE_URL` | URL base do Chatwoot |
| `CHATWOOT_API_TOKEN` | Token de acesso da conta Chatwoot |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo para alertas |
| `MESSAGE_DEBOUNCE_MS` | Janela de debounce em ms (padrão: 20000) |
| `RAG_TOP_K` | Documentos retornados antes do reranker (padrão: 20) |
| `RAG_TOP_N` | Documentos após reranker (padrão: 5) |
