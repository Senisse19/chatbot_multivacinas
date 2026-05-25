import { config } from "../config";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type UnitMode = "production" | "test" | "dev";

export interface UnitConfig {
  key: string;
  name: string;
  fullName: string;
  address: string;
  hours: string;
  phone: string;
  telegramChatId: string;
  chatwootInboxId: number;
  mode: UnitMode;          // identifica se é prod, teste de unidade ou dev pessoal
  mirrorOf?: string;       // se é caixa de teste, aponta para qual unidade real espelha
}

// ─── Definição das Unidades ───────────────────────────────────────────────────
//
// Estrutura de inboxes no Chatwoot:
//
//  Assis Brasil (prod)   ──► webhook prod  → /webhook/chatwoot (servidor prod)
//                        ──► webhook teste → /webhook/chatwoot (servidor dev)
//
//  Nilo Peçanha (prod)   ──► webhook prod  → /webhook/chatwoot (servidor prod)
//                        ──► webhook teste → /webhook/chatwoot (servidor dev)
//
//  Victor - Teste (dev)  ──► webhook único → /webhook/chatwoot (servidor dev)
//
// Um único servidor responde a todos. O inbox_id identifica qual unidade/modo usar.

function buildUnits(): UnitConfig[] {
  const units: UnitConfig[] = [];

  const telegramTest = config.telegram.chatIdTest;

  // ── Assis Brasil — Produção ──────────────────────────────────────────────────
  units.push({
    key: "assis_brasil",
    name: "Assis Brasil",
    fullName: "MultiVacinas Assis Brasil",
    address: config.units.assisAddress ?? "Av. Assis Brasil, 4582 — Loja 20, Icon Shopping, Porto Alegre/RS",
    hours: config.units.assisHours ?? "Segunda a sexta: 10h às 19h | Sábado: 9h às 15h",
    phone: config.units.assisPhone ?? "(51) 99959-8056",
    telegramChatId: config.telegram.chatIdAssisBrasil,
    chatwootInboxId: config.inboxes.assisBrasil,
    mode: "production",
  });

  // ── Nilo Peçanha — Produção ──────────────────────────────────────────────────
  units.push({
    key: "nilo_pecanha",
    name: "Nilo Peçanha",
    fullName: "MultiVacinas Nilo Peçanha",
    address: config.units.niloAddress ?? "Av. Nilo Peçanha — Porto Alegre/RS (confirme com o atendente)",
    hours: config.units.niloHours ?? "Segunda a sexta: 09h às 18h | Sábado: 09h às 13h",
    phone: config.units.niloPhone ?? "(51) 99959-8056",
    telegramChatId: config.telegram.chatIdNiloPecanha,
    chatwootInboxId: config.inboxes.niloPecanha,
    mode: "production",
  });

  // ── Assis Brasil — Teste (webhook de teste da caixa real) ───────────────────
  if (config.inboxes.testAssisBrasil !== null) {
    units.push({
      key: "assis_brasil_test",
      name: "Assis Brasil",
      fullName: "MultiVacinas Assis Brasil",
      address: config.units.assisAddress ?? "Av. Assis Brasil, 4582 — Loja 20, Icon Shopping, Porto Alegre/RS",
      hours: config.units.assisHours ?? "Segunda a sexta: 10h às 19h | Sábado: 9h às 15h",
      phone: config.units.assisPhone ?? "(51) 99959-8056",
      telegramChatId: telegramTest,  // alerta vai pro chat de teste, não para a equipe
      chatwootInboxId: config.inboxes.testAssisBrasil,
      mode: "test",
      mirrorOf: "assis_brasil",
    });
  }

  // ── Nilo Peçanha — Teste (webhook de teste da caixa real) ───────────────────
  if (config.inboxes.testNiloPecanha !== null) {
    units.push({
      key: "nilo_pecanha_test",
      name: "Nilo Peçanha",
      fullName: "MultiVacinas Nilo Peçanha",
      address: config.units.niloAddress ?? "Av. Nilo Peçanha — Porto Alegre/RS",
      hours: config.units.niloHours ?? "Segunda a sexta: 09h às 18h | Sábado: 09h às 13h",
      phone: config.units.niloPhone ?? "(51) 99959-8056",
      telegramChatId: telegramTest,
      chatwootInboxId: config.inboxes.testNiloPecanha,
      mode: "test",
      mirrorOf: "nilo_pecanha",
    });
  }

  // ── Victor — Caixa Pessoal de Dev ────────────────────────────────────────────
  if (config.inboxes.testDev !== null) {
    units.push({
      key: "victor_dev",
      name: "Dev",
      fullName: "MultiVacinas [MODO TESTE]",
      address: config.units.assisAddress ?? "Av. Assis Brasil, 4582 — Loja 20, Icon Shopping, Porto Alegre/RS",
      hours: config.units.assisHours ?? "Segunda a sexta: 10h às 19h | Sábado: 9h às 15h",
      phone: config.units.assisPhone ?? "(51) 99959-8056",
      telegramChatId: telegramTest,
      chatwootInboxId: config.inboxes.testDev,
      mode: "dev",
      mirrorOf: "assis_brasil",
    });
  }

  return units;
}

// ─── Índice por inbox_id ──────────────────────────────────────────────────────

let _units: UnitConfig[] | null = null;
let _inboxIndex: Map<number, UnitConfig> | null = null;

function getUnits(): UnitConfig[] {
  if (!_units) _units = buildUnits();
  return _units;
}

function getInboxIndex(): Map<number, UnitConfig> {
  if (!_inboxIndex) {
    _inboxIndex = new Map(getUnits().map((u) => [u.chatwootInboxId, u]));
  }
  return _inboxIndex;
}

export function getUnitByInboxId(inboxId: number): UnitConfig {
  const unit = getInboxIndex().get(inboxId);
  if (!unit) {
    console.warn(`[Units] inbox_id ${inboxId} não mapeado. Usando fallback Assis Brasil.`);
    return getUnits()[0]; // fallback seguro
  }
  return unit;
}

export function getOtherUnits(currentUnitKey: string): UnitConfig[] {
  // Retorna apenas as unidades de PRODUÇÃO (não duplica as de teste no prompt)
  return getUnits().filter(
    (u) => u.mode === "production" && u.key !== currentUnitKey,
  );
}

export function isTestMode(unit: UnitConfig): boolean {
  return unit.mode === "test" || unit.mode === "dev";
}

// Export para diagnóstico/log no startup
export function logUnitMapping(): void {
  console.log("📋 Mapeamento de inboxes:");
  for (const unit of getUnits()) {
    const modeLabel =
      unit.mode === "production" ? "🟢 PROD" :
      unit.mode === "test"       ? "🟡 TESTE" : "🔵 DEV";
    console.log(
      `  ${modeLabel} inbox_id=${unit.chatwootInboxId} → ${unit.fullName}` +
      (unit.mirrorOf ? ` (espelho de ${unit.mirrorOf})` : ""),
    );
  }
}
