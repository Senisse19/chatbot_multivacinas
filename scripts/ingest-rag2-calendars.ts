/**
 * Ingestão dos calendários de vacinação SBIm 2026/2027 (pasta rag2/) na base RAG.
 *
 * Uso:
 *   npm run ingest:calendarios
 *
 * Substitui os calendários ANTIGOS (2025/2026) das faixas cobertas por estes novos
 * (adolescente, adulto, criança, idoso; prematuro entra como criança), MANTENDO
 * gestante e os calendários gerais ("todos"). Os .docx são tabulares e de estrutura
 * irregular entre si, então extraímos o texto (mammoth) e fatiamos por parágrafos
 * com alvo de tamanho + sobreposição. Cada chunk é prefixado com a faixa + versão,
 * o que o torna auto-identificável na busca (evita o bot misturar faixas/versões).
 *
 * Idempotente: re-rodar apaga os calendários das mesmas faixas e reinsere.
 */
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import OpenAI from "openai";
import { config } from "../src/config";
import { getSupabase } from "../src/services/supabase.client";
import { createOpenAI } from "../src/utils/openai.client";
import { withRetry } from "../src/utils/retry";

const RAG2_DIR = path.resolve(process.cwd(), "rag2");
const TIPO = "calendario";
const VERSAO = "2026-2027";
const CHUNK_TARGET = 1600; // chars-alvo por chunk (quebra em limite de parágrafo)

// Faixas substituídas (as cobertas pelos novos calendários). gestante/todos ficam.
const FAIXAS_SUBSTITUIDAS = ["adolescente", "adulto", "crianca", "idoso"];

interface FileMeta {
  faixa_etaria: string;
  label: string;
}

// Mapeia o arquivo (por trecho do nome) → faixa + rótulo legível.
function metaForFile(filename: string): FileMeta {
  const n = filename.toLowerCase();
  if (n.includes("10 a 19")) return { faixa_etaria: "adolescente", label: "Adolescente (10 a 19 anos)" };
  if (n.includes("20 a 59")) return { faixa_etaria: "adulto", label: "Adulto (20 a 59 anos)" };
  if (n.includes("de 0 a 10")) return { faixa_etaria: "crianca", label: "Criança (0 a 10 anos)" };
  if (n.includes("mais de 60")) return { faixa_etaria: "idoso", label: "Idoso (60 anos ou mais)" };
  if (n.includes("prematuro")) return { faixa_etaria: "crianca", label: "Prematuro (primeiro ano de vida)" };
  throw new Error(`Não sei mapear a faixa do arquivo: ${filename}`);
}

/** Agrupa parágrafos em chunks ~CHUNK_TARGET chars, com 1 parágrafo de sobreposição. */
function chunkParagraphs(paras: string[]): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (len > 0 && len + p.length > CHUNK_TARGET) {
      chunks.push(cur.join("\n"));
      const last = cur[cur.length - 1]; // overlap
      cur = [last];
      len = last.length;
    }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) chunks.push(cur.join("\n"));
  return chunks;
}

async function embed(openai: OpenAI, text: string): Promise<number[]> {
  const resp = await withRetry(
    () => openai.embeddings.create({ model: config.openai.embeddingModel, input: text }),
    { label: "openai.embeddings", attempts: 4 },
  );
  return resp.data[0].embedding;
}

async function main() {
  const files = fs.existsSync(RAG2_DIR)
    ? fs.readdirSync(RAG2_DIR).filter((f) => f.toLowerCase().endsWith(".docx"))
    : [];
  if (files.length === 0) throw new Error(`Nenhum .docx em ${RAG2_DIR}`);
  console.log(`[ingest] ${files.length} calendários encontrados em rag2/.`);

  const supabase = getSupabase();
  const openai = createOpenAI();

  // 1. Substituir: remover calendários das faixas cobertas (mantém gestante/todos).
  const { error: delErr, count: delCount } = await supabase
    .from("documents")
    .delete({ count: "exact" })
    .eq("metadata->>tipo", TIPO)
    .in("metadata->>faixa_etaria", FAIXAS_SUBSTITUIDAS);
  if (delErr) throw new Error(`Falha ao remover calendários antigos: ${delErr.message}`);
  console.log(`[ingest] Removidos ${delCount ?? 0} chunks de calendário antigos (faixas: ${FAIXAS_SUBSTITUIDAS.join(", ")}).`);

  // 2. Próximo id (MAX(id)+1).
  const { data: maxRow, error: maxErr } = await supabase
    .from("documents")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) throw new Error(`Falha ao obter MAX(id): ${maxErr.message}`);
  let nextId = (maxRow?.id ?? 0) + 1;
  const firstId = nextId;

  // 3. Extrair + chunk + embed + montar linhas.
  const rows: Array<{ id: number; content: string; metadata: Record<string, string>; embedding: number[] }> = [];
  for (const file of files) {
    const meta = metaForFile(file);
    const { value: txt } = await mammoth.extractRawText({ path: path.join(RAG2_DIR, file) });
    const paras = txt.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
    const chunks = chunkParagraphs(paras);
    console.log(`[ingest] ${file} → faixa=${meta.faixa_etaria}, ${paras.length} parágrafos, ${chunks.length} chunks.`);

    for (const chunk of chunks) {
      const content = `Calendário de vacinação SBIm 2026/2027 — ${meta.label}.\n\n${chunk}`;
      const embedding = await embed(openai, content);
      rows.push({
        id: nextId++,
        content,
        metadata: { tipo: TIPO, faixa_etaria: meta.faixa_etaria, fonte: file, versao: VERSAO },
        embedding,
      });
    }
  }

  // 4. Insert (em lotes para não estourar payload).
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from("documents").insert(slice);
    if (insErr) throw new Error(`Falha ao inserir (lote ${i}): ${insErr.message}`);
  }

  console.log(`\n[ingest] ✅ ${rows.length} chunks inseridos (ids ${firstId}–${nextId - 1}, tipo=${TIPO}, versao=${VERSAO}).`);
}

main().catch((err) => {
  console.error(`[ingest] ❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
