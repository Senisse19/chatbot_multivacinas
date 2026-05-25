import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { CohereClient } from "cohere-ai";
import { config } from "../config";

// ─── Clientes (singleton) ─────────────────────────────────────────────────────

let supabase: SupabaseClient;
let openaiClient: OpenAI;
let cohereClient: CohereClient;

function getSupabase(): SupabaseClient {
  if (!supabase) supabase = createClient(config.supabase.url, config.supabase.serviceKey);
  return supabase;
}
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
// ESTRATÉGIA ANTI-ALUCINAÇÃO:
//
// O principal motivo de alucinação no n8n era que o agente recebia resultados
// irrelevantes da busca vetorial (alta recall, baixa precision) e "completava"
// as lacunas com conhecimento próprio.
//
// Solução em 3 camadas:
//   1. Query expansion: geramos 3 variações da query do usuário para cobrir
//      diferentes formas de falar sobre o mesmo tema (coloquial, técnico, etc.)
//   2. Merge + dedup: juntamos os resultados das 3 buscas e removemos duplicatas
//   3. Reranker Cohere com threshold alto: só passa conteúdo com score > 0.35,
//      garantindo que só textos genuinamente relevantes chegam ao agente.

export interface RagResult {
  found: boolean;       // true se encontrou conteúdo relevante
  content: string;      // texto dos documentos (vazio se not found)
  queriesUsed: string[]; // queries geradas (para debug/log)
}

// ─── 1. Query Expansion ───────────────────────────────────────────────────────

/**
 * Gera 2–3 variações da query original para melhorar o recall da busca vetorial.
 * Ex: "pode dar gripe pra grávida?" → ["vacina influenza gestante", "gripe grávida segurança", ...]
 */
async function expandQuery(originalQuery: string): Promise<string[]> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Você é um especialista em busca de informações sobre vacinas. " +
            "Dado uma pergunta de um usuário, gere EXATAMENTE 3 variações de busca " +
            "mais técnicas e específicas, adequadas para recuperar bulas e documentos médicos. " +
            "Responda APENAS com as 3 variações separadas por '|', sem numeração nem explicação. " +
            "Exemplo: 'vacina influenza gestante indicação|gripe inativada gravidez contraindicação|influenza trivalente dose única gestação'",
        },
        {
          role: "user",
          content: originalQuery,
        },
      ],
    });

    const raw = response.choices[0].message.content?.trim() ?? "";
    const variations = raw
      .split("|")
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 3);

    // Garante que a query original sempre está incluída
    const allQueries = [originalQuery, ...variations];
    const uniqueQueries = [...new Set(allQueries)].slice(0, 4);

    console.log(`[RAG] Query expansion: ${uniqueQueries.map((q) => `"${q}"`).join(" | ")}`);
    return uniqueQueries;
  } catch {
    // Em caso de falha, usa apenas a query original
    return [originalQuery];
  }
}

// ─── 2. Busca vetorial para uma query ────────────────────────────────────────

async function vectorSearch(query: string): Promise<DocumentRow[]> {
  const embeddingResponse = await getOpenAI().embeddings.create({
    model: config.openai.embeddingModel,
    input: query,
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  const { data, error } = await getSupabase().rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_count: config.agent.ragTopK,
    filter: {},
  });

  if (error) {
    console.error(`[RAG] Erro na busca vetorial para "${query}":`, error.message);
    return [];
  }

  return (data as DocumentRow[]) ?? [];
}

// ─── 3. Pipeline completo ─────────────────────────────────────────────────────

export async function searchDocuments(originalQuery: string): Promise<RagResult> {
  try {
    // Passo 1: Expandir query
    const queries = await expandQuery(originalQuery);

    // Passo 2: Buscar em paralelo para todas as variações
    const resultSets = await Promise.all(queries.map((q) => vectorSearch(q)));

    // Passo 3: Merge e deduplicação por conteúdo
    const seen = new Set<string>();
    const allDocs: DocumentRow[] = [];
    for (const docs of resultSets) {
      for (const doc of docs) {
        const key = doc.content.slice(0, 100); // fingerprint pelos primeiros 100 chars
        if (!seen.has(key)) {
          seen.add(key);
          allDocs.push(doc);
        }
      }
    }

    if (allDocs.length === 0) {
      console.log("[RAG] Nenhum documento encontrado após merge.");
      return { found: false, content: "", queriesUsed: queries };
    }

    console.log(`[RAG] ${allDocs.length} docs únicos para reranking.`);

    // Passo 4: Reranker Cohere com threshold rigoroso
    const rerankResponse = await getCohere().rerank({
      model: config.cohere.rerankModel,
      query: originalQuery,      // rerank sempre com a query ORIGINAL do usuário
      documents: allDocs.map((d) => d.content),
      topN: config.agent.ragTopN,
      returnDocuments: true,
    });

    // Threshold: 0.35 (calibrado para eliminar documentos marginalmente relevantes)
    const RELEVANCE_THRESHOLD = 0.35;

    const relevantDocs = rerankResponse.results.filter(
      (r) => r.relevanceScore >= RELEVANCE_THRESHOLD,
    );

    if (relevantDocs.length === 0) {
      console.log(
        `[RAG] Todos os ${rerankResponse.results.length} docs ficaram abaixo do threshold (${RELEVANCE_THRESHOLD}). ` +
        `Melhor score: ${rerankResponse.results[0]?.relevanceScore?.toFixed(3) ?? "N/A"}`,
      );
      return { found: false, content: "", queriesUsed: queries };
    }

    // Formatar output: inclui score para transparência interna (não vai ao usuário)
    const content = relevantDocs
      .map((r) => {
        const text = (r.document as { text: string }).text;
        return text;
      })
      .join("\n\n---\n\n");

    console.log(
      `[RAG] ${relevantDocs.length} docs relevantes (scores: ` +
      relevantDocs.map((r) => r.relevanceScore.toFixed(3)).join(", ") +
      `)`,
    );

    return { found: true, content, queriesUsed: queries };
  } catch (err) {
    console.error("[RAG] Erro inesperado:", err);
    return { found: false, content: "", queriesUsed: [originalQuery] };
  }
}
