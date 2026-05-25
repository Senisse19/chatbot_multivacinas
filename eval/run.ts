/**
 * Eval set runner para o pipeline RAG.
 *
 * Uso:
 *   npm run eval:rag
 *
 * Lê eval/questions.json, dispara searchDocuments para cada pergunta com cache
 * desabilitado, compara status e conteúdo contra o esperado, e imprime uma
 * tabela markdown com hit/miss + top_score + latência.
 *
 * Para considerar "hit":
 *   - status retornado == expected_status
 *   - AND todas as substrings de expected_docs_contain aparecem no `content`
 *     (case-insensitive, sem acentos)
 */
import fs from "fs";
import path from "path";

// Força cache desligado durante o eval, independente do .env
process.env.RAG_CACHE_DISABLED = "true";

import { searchDocuments, RagFilters, RagStatus } from "../src/services/rag.service";

interface Question {
  id: string;
  query: string;
  expected_status: RagStatus;
  expected_docs_contain: string[];
  filtros?: RagFilters;
}

interface EvalRow {
  id: string;
  query: string;
  expectedStatus: RagStatus;
  actualStatus: RagStatus;
  topScore: number;
  contentHits: number;
  contentExpected: number;
  latencyMs: number;
  passed: boolean;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function run(): Promise<void> {
  const file = path.resolve(__dirname, "questions.json");
  const questions = JSON.parse(fs.readFileSync(file, "utf8")) as Question[];

  console.log(`\nRodando eval com ${questions.length} perguntas...\n`);
  const rows: EvalRow[] = [];

  for (const q of questions) {
    const t0 = Date.now();
    try {
      const result = await searchDocuments(q.query, q.filtros ?? {});
      const latencyMs = Date.now() - t0;

      const normalizedContent = stripAccents(result.content);
      const contentHits = q.expected_docs_contain.filter((needle) =>
        normalizedContent.includes(stripAccents(needle)),
      ).length;

      const statusOk = result.status === q.expected_status;
      const contentOk =
        q.expected_docs_contain.length === 0
          ? true
          : contentHits === q.expected_docs_contain.length;
      const passed = statusOk && contentOk;

      rows.push({
        id: q.id,
        query: q.query,
        expectedStatus: q.expected_status,
        actualStatus: result.status,
        topScore: result.topScore,
        contentHits,
        contentExpected: q.expected_docs_contain.length,
        latencyMs,
        passed,
      });
    } catch (err) {
      console.error(`[Eval] ${q.id} ERRO: ${(err as Error).message}`);
      rows.push({
        id: q.id,
        query: q.query,
        expectedStatus: q.expected_status,
        actualStatus: "empty",
        topScore: 0,
        contentHits: 0,
        contentExpected: q.expected_docs_contain.length,
        latencyMs: Date.now() - t0,
        passed: false,
      });
    }
  }

  // ─── Relatório ──────────────────────────────────────────────────────────────
  const passed = rows.filter((r) => r.passed).length;
  const total = rows.length;
  const avgLatency = Math.round(
    rows.reduce((acc, r) => acc + r.latencyMs, 0) / total,
  );
  const p95 = [...rows]
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b)[Math.floor(total * 0.95) - 1];

  console.log("\n## Resultado\n");
  console.log(`- Hit rate: **${passed}/${total}** (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`- Latência média: ${avgLatency}ms`);
  console.log(`- Latência p95: ${p95 ?? "-"}ms`);

  console.log("\n## Detalhe\n");
  console.log(
    "| ID  | Status (esperado → real) | TopScore | Conteúdo (hit/exp) | Latência | OK |",
  );
  console.log(
    "|-----|--------------------------|---------:|--------------------:|---------:|----|",
  );
  for (const r of rows) {
    const status = `${r.expectedStatus} → ${r.actualStatus}`;
    const ok = r.passed ? "✅" : "❌";
    console.log(
      `| ${r.id} | ${status} | ${r.topScore.toFixed(3)} | ${r.contentHits}/${r.contentExpected} | ${r.latencyMs}ms | ${ok} |`,
    );
  }

  // Lista as falhas para inspeção
  const failures = rows.filter((r) => !r.passed);
  if (failures.length) {
    console.log("\n## Falhas para inspeção\n");
    for (const r of failures) {
      console.log(`- ${r.id} (\"${r.query}\") — esperado ${r.expectedStatus} / obteve ${r.actualStatus} / score=${r.topScore.toFixed(3)} / conteúdo ${r.contentHits}/${r.contentExpected}`);
    }
  }

  // Exit code: 1 se hit rate < 80% para integrar em CI futuramente
  if (passed / total < 0.8) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("[Eval] Falha fatal:", err);
  process.exit(1);
});
