import crypto from "crypto";
import type { RagResult, RagFilters } from "./rag.service";

// ─── Cache em memória para resultados de buscar_documentos ────────────────────
//
// Perguntas comuns ("vocês têm vacina da gripe?", "vocês fazem febre amarela?")
// se repetem milhares de vezes. Cachear a resposta da pipeline (expand + busca +
// rerank) economiza ~3 chamadas de API por hit.
//
// Implementação simples sem dependências externas: Map com timestamp e
// invalidação por TTL + tamanho máximo (LRU manual aproximado).
//
// Pode ser desativado via env RAG_CACHE_DISABLED=true.

interface CacheEntry {
  result: RagResult;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry>();

function cacheKey(query: string, filter: RagFilters): string {
  const normalized = query.trim().toLowerCase();
  const filterStr = JSON.stringify(filter, Object.keys(filter).sort());
  return crypto
    .createHash("sha1")
    .update(`${normalized}|${filterStr}`)
    .digest("hex");
}

export function getCached(query: string, filter: RagFilters): RagResult | null {
  const key = cacheKey(query, filter);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  // Toque "LRU": reinsere para mover ao final da ordem de iteração
  store.delete(key);
  store.set(key, entry);
  return entry.result;
}

export function setCached(
  query: string,
  filter: RagFilters,
  result: RagResult,
): void {
  // Não cacheia resultados vazios — base pode mudar e queremos retentar
  if (result.status === "empty") return;

  const key = cacheKey(query, filter);
  store.set(key, { result, expiresAt: Date.now() + TTL_MS });

  // Eviction simples: se ultrapassou o máximo, remove o mais antigo
  if (store.size > MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }
}

export function clearCache(): void {
  store.clear();
}
