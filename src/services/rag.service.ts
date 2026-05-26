import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { CohereClient } from "cohere-ai";
import { config } from "../config";
import { withRetry } from "../utils/retry";
import { getCached, setCached } from "./rag.cache";

// ─── Clientes (singleton) ─────────────────────────────────────────────────────

import { getSupabase } from "./supabase.client";
let openaiClient: OpenAI;
let cohereClient: CohereClient;

function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  return openaiClient;
}
function getCohere(): CohereClient {
  if (!cohereClient) cohereClient = new CohereClient({ token: config.cohere.apiKey });
  return cohereClient;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

// ─── RAG Pipeline ─────────────────────────────────────────────────────────────
//
// ESTRATÉGIA ANTI-ALUCINAÇÃO (Fase 3, atualizada):
//
// 1. Query expansion: geramos 3 variações técnicas da pergunta do usuário.
// 2. Busca HÍBRIDA (FTS portuguese + pgvector com RRF), pega tanto termos
//    raros como "Beyfortus" quanto perguntas semânticas. RPC: match_documents_hybrid.
// 3. Merge + dedup por id (UUID).
// 4. Rerank Cohere com a query TÉCNICA (queries[1]) em vez da conversacional.
// 5. Status em 3 camadas:
//      - STRONG (>= 0.35) → BASE_ENCONTRADA
//      - WEAK   (0.20 a 0.35) → BASE_FRACA (usa com cautela, sem inventar)
//      - EMPTY  (< 0.20)  → BASE_VAZIA
//    Evita o "tudo ou nada" do threshold único.

export type RagStatus = "strong" | "weak" | "empty";

export interface RagResult {
  status: RagStatus;
  content: string;       // texto dos documentos (vazio se empty)
  topScore: number;      // maior score do reranker (para log/debug)
  queriesUsed: string[]; // queries geradas (para debug/log)
}

// Filtro opcional aplicado no RPC via metadata @> filter
export interface RagFilters {
  faixa_etaria?: string;
  tipo?: string;
  vacina?: string;
}

// ─── 1. Query Expansion ───────────────────────────────────────────────────────

/**
 * Gera 2 a 3 variações da query original para melhorar o recall da busca vetorial.
 * Ex: "pode dar gripe pra grávida?" → ["vacina influenza gestante", "gripe grávida segurança", ...]
 */
async function expandQuery(originalQuery: string): Promise<string[]> {
  try {
    const response = await withRetry(
      () =>
        getOpenAI().chat.completions.create({
          model: config.agent.ragExpandModel,
          temperature: 0,
          max_completion_tokens: 200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Você é um especialista em busca em corpus de bulas e calendários de vacinação. " +
                'Dada uma pergunta de um usuário, gere 3 variações técnicas no formato {"queries": ["...", "...", "..."]}. ' +
                "Cada variação deve usar nomenclatura de bula (nome da vacina, patógeno alvo, faixa etária, indicação, contraindicação, dose, intervalo). " +
                "Não inclua a pergunta original. Não numere. Não explique. Apenas o JSON.",
            },
            {
              role: "user",
              content: originalQuery,
            },
          ],
        }),
      { label: "openai.expand_query" },
    );

    const raw = response.choices[0].message.content?.trim() ?? "{}";
    let parsed: { queries?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const variations = Array.isArray(parsed.queries)
      ? (parsed.queries as unknown[])
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.trim())
          .slice(0, 3)
      : [];

    // A query original SEMPRE entra (cobre o caso da expansão divergir do tema)
    const allQueries = [originalQuery, ...variations];
    const uniqueQueries = [...new Set(allQueries)].slice(0, 4);

    console.log(`[RAG] Query expansion: ${uniqueQueries.map((q) => `"${q}"`).join(" | ")}`);
    return uniqueQueries;
  } catch (err) {
    console.warn(`[RAG] Expansion falhou, usando query original: ${(err as Error).message}`);
    return [originalQuery];
  }
}

// ─── 2. Busca híbrida (FTS + pgvector + RRF) para uma query ──────────────────

async function hybridSearch(
  query: string,
  filter: RagFilters = {},
): Promise<DocumentRow[]> {
  const embeddingResponse = await withRetry(
    () =>
      getOpenAI().embeddings.create({
        model: config.openai.embeddingModel,
        input: query,
      }),
    { label: "openai.embeddings" },
  );
  const queryEmbedding = embeddingResponse.data[0].embedding;

  const { data, error } = await withRetry(
    async () =>
      getSupabase().rpc("match_documents_hybrid", {
        query_text: query,
        query_embedding: queryEmbedding,
        match_count: config.agent.ragTopK,
        filter,
      }),
    { label: "supabase.match_documents_hybrid" },
  );

  if (error) {
    console.error(`[RAG] Erro na busca híbrida para "${query}":`, error.message);
    return [];
  }

  return (data as DocumentRow[]) ?? [];
}

// ─── Logging assíncrono de cada busca (Fase 4.2) ─────────────────────────────
//
// Best-effort: falha de insert não derruba o pipeline. Sem `await` no caller.

interface RagLogRow {
  conversation_id?: number;
  original_query: string;
  expanded_queries: string[];
  filters: RagFilters;
  status: RagStatus;
  top_score: number;
  doc_ids: string[];
  latency_ms: number;
  cache_hit: boolean;
}

function logRagAsync(row: RagLogRow): void {
  void (async () => {
    try {
      const { error } = await getSupabase().from("rag_logs").insert({
        conversation_id: row.conversation_id ?? null,
        original_query: row.original_query,
        expanded_queries: row.expanded_queries,
        filters: row.filters,
        status: row.status,
        top_score: row.top_score,
        doc_ids: row.doc_ids,
        latency_ms: row.latency_ms,
        cache_hit: row.cache_hit,
      });
      if (error) {
        console.warn(`[RAG] log assíncrono falhou: ${error.message}`);
      }
    } catch (err) {
      console.warn(`[RAG] log assíncrono falhou: ${(err as Error).message}`);
    }
  })();
}

// ─── 3. Pipeline completo ─────────────────────────────────────────────────────

// Thresholds calibrados para o reranker Cohere multilingual.
const RELEVANCE_STRONG = 0.35;
const RELEVANCE_WEAK = 0.2;

export async function searchDocuments(
  originalQuery: string,
  filter: RagFilters = {},
  meta: { conversationId?: number } = {},
): Promise<RagResult> {
  const t0 = Date.now();

  // Passo 0: cache (perguntas comuns se repetem muito)
  if (!config.agent.ragCacheDisabled) {
    const cached = getCached(originalQuery, filter);
    if (cached) {
      console.log(
        `[RAG] Cache HIT para "${originalQuery}" (status=${cached.status}, topScore=${cached.topScore.toFixed(3)})`,
      );
      logRagAsync({
        conversation_id: meta.conversationId,
        original_query: originalQuery,
        expanded_queries: cached.queriesUsed,
        filters: filter,
        status: cached.status,
        top_score: cached.topScore,
        doc_ids: [],
        latency_ms: Date.now() - t0,
        cache_hit: true,
      });
      return cached;
    }
  }

  try {
    // Passo 1: expandir query
    const queries = await expandQuery(originalQuery);

    // Passo 2: busca híbrida em paralelo para todas as variações
    const resultSets = await Promise.all(
      queries.map((q) => hybridSearch(q, filter)),
    );

    // Passo 3: merge + dedup por id (UUID). Mais robusto que prefixo de conteúdo.
    const seenIds = new Set<string>();
    const allDocs: DocumentRow[] = [];
    for (const docs of resultSets) {
      for (const doc of docs) {
        if (!seenIds.has(doc.id)) {
          seenIds.add(doc.id);
          allDocs.push(doc);
        }
      }
    }

    if (allDocs.length === 0) {
      console.log("[RAG] Nenhum documento encontrado após merge.");
      const r: RagResult = { status: "empty", content: "", topScore: 0, queriesUsed: queries };
      logRagAsync({
        conversation_id: meta.conversationId,
        original_query: originalQuery,
        expanded_queries: queries,
        filters: filter,
        status: r.status,
        top_score: 0,
        doc_ids: [],
        latency_ms: Date.now() - t0,
        cache_hit: false,
      });
      return r;
    }

    console.log(`[RAG] ${allDocs.length} docs únicos para reranking.`);

    // Passo 4: rerank com a query TÉCNICA (primeira variação), costuma render
    // melhor que a query conversacional original em corpus de bula. Se não
    // houve expansão, cai na original.
    const rerankQuery = queries[1] ?? originalQuery;

    const rerankResponse = await withRetry(
      () =>
        getCohere().rerank({
          model: config.cohere.rerankModel,
          query: rerankQuery,
          documents: allDocs.map((d) => d.content),
          topN: config.agent.ragTopN,
          returnDocuments: true,
        }),
      { label: "cohere.rerank" },
    );

    const ranked = rerankResponse.results;
    const topScore = ranked[0]?.relevanceScore ?? 0;

    console.log(
      `[RAG] Rerank query: "${rerankQuery}" | scores: ${ranked.map((r) => r.relevanceScore.toFixed(3)).join(", ")}`,
    );

    // Passo 5: classificar em 3 camadas
    let status: RagStatus;
    if (topScore >= RELEVANCE_STRONG) status = "strong";
    else if (topScore >= RELEVANCE_WEAK) status = "weak";
    else status = "empty";

    // Doc ids dos documentos rankeados (na ordem do rerank)
    const docIds = ranked
      .map((r) => allDocs[r.index]?.id)
      .filter((id): id is string => !!id);

    if (status === "empty") {
      console.log(`[RAG] Status empty (topScore=${topScore.toFixed(3)} < ${RELEVANCE_WEAK}).`);
      const r: RagResult = { status, content: "", topScore, queriesUsed: queries };
      logRagAsync({
        conversation_id: meta.conversationId,
        original_query: originalQuery,
        expanded_queries: queries,
        filters: filter,
        status,
        top_score: topScore,
        doc_ids: docIds,
        latency_ms: Date.now() - t0,
        cache_hit: false,
      });
      return r;
    }

    // Para strong/weak, devolvemos só os docs acima do limiar fraco
    const relevantDocs = ranked.filter((r) => r.relevanceScore >= RELEVANCE_WEAK);
    const content = relevantDocs
      .map((r) => (r.document as { text: string }).text)
      .join("\n\n---\n\n");

    const result: RagResult = { status, content, topScore, queriesUsed: queries };

    // Cacheia apenas resultados úteis (strong/weak). Empty é descartado pelo
    // próprio setCached. A base pode mudar e queremos retentar.
    if (!config.agent.ragCacheDisabled) {
      setCached(originalQuery, filter, result);
    }

    logRagAsync({
      conversation_id: meta.conversationId,
      original_query: originalQuery,
      expanded_queries: queries,
      filters: filter,
      status,
      top_score: topScore,
      doc_ids: docIds,
      latency_ms: Date.now() - t0,
      cache_hit: false,
    });

    return result;
  } catch (err) {
    console.error("[RAG] Erro inesperado:", err);
    return { status: "empty", content: "", topScore: 0, queriesUsed: [originalQuery] };
  }
}
