/**
 * Ingestão das contraindicações de vacinas na base RAG (tabela `documents`).
 *
 * Uso:
 *   npm run ingest:contra
 *
 * Lê rag/Contraindicacoes_Vacinas.md (fonte curada a partir do .docx oficial),
 * faz chunking por seção (1 chunk por vacina + 1 para as contraindicações gerais),
 * gera embeddings com o MESMO modelo do resto da base (text-embedding-3-small) e
 * insere em `documents` com metadata { tipo:"contraindicacoes", vacina, faixa_etaria, fonte }.
 *
 * É idempotente: antes de inserir, remove todos os chunks com tipo="contraindicacoes",
 * então re-rodar não duplica conteúdo. Os ids são sequenciais a partir de MAX(id)+1,
 * seguindo a convenção das migrations 007/008.
 */
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { config } from "../src/config";
import { getSupabase } from "../src/services/supabase.client";
import { withRetry } from "../src/utils/retry";

const SOURCE_MD = path.resolve(process.cwd(), "rag", "Contraindicacoes_Vacinas.md");
const FONTE = "CONTRAINDICAÇÕES GERAIS E ESPECÍFICAS - VACINAS (5).docx";
const TIPO = "contraindicacoes";

interface SectionMeta {
  vacina: string;
  faixa_etaria: string;
}

// Mapeamento heading da seção → slug da vacina / faixa etária.
// Slugs reaproveitam os existentes (migration 008) para que o filtro `vacina`
// cruze contraindicações com as bulas correspondentes.
const SECTION_META: Record<string, SectionMeta> = {
  "CONTRAINDICAÇÕES GERAIS": { vacina: "geral", faixa_etaria: "todos" },
  "DTPA IPV": { vacina: "dtpa_ipv", faixa_etaria: "todos" },
  "DTPA": { vacina: "dtpa", faixa_etaria: "todos" },
  "DENGUE": { vacina: "qdenga", faixa_etaria: "todos" },
  "FEBRE AMARELA": { vacina: "stamaril", faixa_etaria: "todos" },
  "GRIPE 2026": { vacina: "gripe", faixa_etaria: "todos" },
  "HEPATITE A ADULTO": { vacina: "vaqta", faixa_etaria: "adulto" },
  "HEPATITE A INFANTIL": { vacina: "vaqta", faixa_etaria: "crianca" },
  "HEPATITE A + B": { vacina: "twinrix", faixa_etaria: "todos" },
  "HEPATITE B INFANTIL": { vacina: "engerix_b", faixa_etaria: "crianca" },
  "HERPES-ZÓSTER": { vacina: "shingrix", faixa_etaria: "idoso" },
  "HEXAVALENTE": { vacina: "infanrix_hexa", faixa_etaria: "crianca" },
  "HPV-9": { vacina: "gardasil_9", faixa_etaria: "todos" },
  "MENINGOCÓCICA ACWY": { vacina: "menveo", faixa_etaria: "todos" },
  "MENINGOCÓCICA B": { vacina: "bexsero", faixa_etaria: "todos" },
  "PENTAVALENTE": { vacina: "infanrix_penta", faixa_etaria: "crianca" },
  "PNEUMOCÓCICA 20": { vacina: "prevenar_20", faixa_etaria: "adulto" },
  "ROTAVÍRUS": { vacina: "rotateq", faixa_etaria: "crianca" },
  "TRÍPLICE VIRAL": { vacina: "triplice_viral", faixa_etaria: "todos" },
  "VARICELA": { vacina: "varivax", faixa_etaria: "todos" },
  "VSR BEBÊ (BEYFORTUS)": { vacina: "beyfortus", faixa_etaria: "crianca" },
  "VSR GESTANTE E IDOSO (ABRYSVO)": { vacina: "abrysvo", faixa_etaria: "gestante" },
  "VSR IDOSO (AREXVY)": { vacina: "arexvy", faixa_etaria: "idoso" },
};

interface Chunk {
  heading: string;
  content: string;
  meta: SectionMeta;
}

/** Fatia o Markdown em seções por heading `## `. Ignora o H1 e o front matter. */
function parseSections(md: string): Chunk[] {
  const lines = md.split(/\r?\n/);
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (heading === null) return;
    const text = body.join("\n").trim();
    if (!text) return;
    const meta = SECTION_META[heading];
    if (!meta) {
      console.warn(`[ingest] Seção sem mapeamento de metadata: "${heading}" → usando geral/todos`);
    }
    // O `content` inclui o heading para reforçar nome da vacina + "Contraindicações"
    // tanto no embedding quanto no FTS.
    const content = `Contraindicações — ${heading}\n\n${text}`;
    chunks.push({ heading, content, meta: meta ?? { vacina: "geral", faixa_etaria: "todos" } });
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      flush();
      heading = h2[1].trim();
      body = [];
      continue;
    }
    if (heading === null) continue; // ainda no H1/front matter
    if (/^---\s*$/.test(line)) continue; // separadores
    body.push(line);
  }
  flush();
  return chunks;
}

async function embed(openai: OpenAI, text: string): Promise<number[]> {
  const resp = await withRetry(
    () => openai.embeddings.create({ model: config.openai.embeddingModel, input: text }),
    { label: "openai.embeddings", attempts: 3 },
  );
  return resp.data[0].embedding;
}

async function main() {
  if (!fs.existsSync(SOURCE_MD)) {
    throw new Error(`Fonte não encontrada: ${SOURCE_MD}`);
  }
  const md = fs.readFileSync(SOURCE_MD, "utf-8");
  const chunks = parseSections(md);
  if (chunks.length === 0) throw new Error("Nenhuma seção encontrada no Markdown.");
  console.log(`[ingest] ${chunks.length} seções encontradas em ${path.basename(SOURCE_MD)}.`);

  const supabase = getSupabase();
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  // 1. Idempotência: remove chunks anteriores de contraindicações.
  const { error: delErr, count: delCount } = await supabase
    .from("documents")
    .delete({ count: "exact" })
    .eq("metadata->>tipo", TIPO);
  if (delErr) throw new Error(`Falha ao limpar chunks antigos: ${delErr.message}`);
  console.log(`[ingest] Removidos ${delCount ?? 0} chunks antigos (tipo=${TIPO}).`);

  // 2. Próximo id disponível (MAX(id)+1).
  const { data: maxRow, error: maxErr } = await supabase
    .from("documents")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) throw new Error(`Falha ao obter MAX(id): ${maxErr.message}`);
  let nextId = (maxRow?.id ?? 0) + 1;
  const firstId = nextId;

  // 3. Embeddings + montagem das linhas.
  const rows: Array<{
    id: number;
    content: string;
    metadata: Record<string, string>;
    embedding: number[];
  }> = [];
  for (const chunk of chunks) {
    const embedding = await embed(openai, chunk.content);
    rows.push({
      id: nextId++,
      content: chunk.content,
      metadata: {
        tipo: TIPO,
        vacina: chunk.meta.vacina,
        faixa_etaria: chunk.meta.faixa_etaria,
        fonte: FONTE,
      },
      embedding,
    });
    console.log(`[ingest]   id=${rows[rows.length - 1].id}  ${chunk.heading} (vacina=${chunk.meta.vacina}, faixa=${chunk.meta.faixa_etaria})`);
  }

  // 4. Insert.
  const { error: insErr } = await supabase.from("documents").insert(rows);
  if (insErr) throw new Error(`Falha ao inserir chunks: ${insErr.message}`);

  console.log(
    `\n[ingest] ✅ ${rows.length} chunks inseridos (ids ${firstId}–${nextId - 1}, tipo=${TIPO}, fonte="${FONTE}").`,
  );
}

main().catch((err) => {
  console.error(`[ingest] ❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
