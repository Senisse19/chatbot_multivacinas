import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
const envPath = path.resolve(process.cwd(), ".env");

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
  console.log(`[Config] Carregando ambiente de: ${envLocalPath}`);
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`[Config] Carregando ambiente de: ${envPath}`);
} else {
  dotenv.config();
  console.log("[Config] Nenhum arquivo .env ou .env.local encontrado. Usando variáveis de ambiente do sistema.");
}

// ─── Schema de validação ──────────────────────────────────────────────────────

const envSchema = z.object({
  // ── Ambiente ────────────────────────────────────────────────────────────────
  APP_ENV: z.enum(["production", "development"]).default("development"),
  PORT: z.string().default("3000"),

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY é obrigatório"),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  // ── Supabase ─────────────────────────────────────────────────────────────────
  SUPABASE_URL: z.string().url("SUPABASE_URL deve ser uma URL válida"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY é obrigatório"),

  // ── Cohere ───────────────────────────────────────────────────────────────────
  COHERE_API_KEY: z.string().min(1, "COHERE_API_KEY é obrigatório"),
  COHERE_RERANK_MODEL: z.string().default("rerank-multilingual-v3.0"),

  // ── Chatwoot ─────────────────────────────────────────────────────────────────
  CHATWOOT_BASE_URL: z.string().url("CHATWOOT_BASE_URL deve ser uma URL válida"),
  CHATWOOT_API_TOKEN: z.string().min(1, "CHATWOOT_API_TOKEN é obrigatório"),
  CHATWOOT_WEBHOOK_SECRET: z.string().optional(),

  // ── Inbox IDs por unidade (produção) ─────────────────────────────────────────
  CHATWOOT_INBOX_ID_ASSIS_BRASIL: z.string().default("1"),
  CHATWOOT_INBOX_ID_NILO_PECANHA: z.string().default("2"),

  // ── Inbox IDs de teste (um por unidade + caixa pessoal de dev) ───────────────
  CHATWOOT_INBOX_ID_TEST_ASSIS_BRASIL: z.string().optional(),
  CHATWOOT_INBOX_ID_TEST_NILO_PECANHA: z.string().optional(),
  CHATWOOT_INBOX_ID_TEST_DEV: z.string().optional(), // caixa pessoal do Victor

  // ── Telegram ─────────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN é obrigatório"),
  TELEGRAM_CHAT_ID: z.string().min(1, "TELEGRAM_CHAT_ID é obrigatório"),

  // Grupos de produção por unidade
  TELEGRAM_CHAT_ID_ASSIS_BRASIL: z.string().optional(),
  TELEGRAM_CHAT_ID_NILO_PECANHA: z.string().optional(),

  // Chat de teste (onde alertas de dev são enviados — não perturba equipe real)
  TELEGRAM_CHAT_ID_TEST: z.string().optional(),

  // ── Dados variáveis das unidades ──────────────────────────────────────────────
  UNIT_ASSIS_ADDRESS: z.string().optional(),
  UNIT_ASSIS_HOURS: z.string().optional(),
  UNIT_ASSIS_PHONE: z.string().optional(),

  UNIT_NILO_ADDRESS: z.string().optional(),
  UNIT_NILO_HOURS: z.string().optional(),
  UNIT_NILO_PHONE: z.string().optional(),

  // ── Configurações do agente ──────────────────────────────────────────────────
  HISTORY_WINDOW: z.string().default("50"),
  MESSAGE_DEBOUNCE_MS: z.string().default("20000"),
  RAG_TOP_K: z.string().default("20"),
  RAG_TOP_N: z.string().default("5"),
});

// ─── Build da config ──────────────────────────────────────────────────────────

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Erro de configuração:");
    result.error.issues.forEach((issue) => {
      console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
    });
    process.exit(1);
  }

  const env = result.data;
  const isDev = env.APP_ENV === "development";

  // Chat de alerta de teste — fallback em cascata para não incomodar a equipe
  const testChatId = env.TELEGRAM_CHAT_ID_TEST ?? env.TELEGRAM_CHAT_ID;

  return {
    appEnv: env.APP_ENV,
    isDev,
    port: parseInt(env.PORT, 10),

    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    },

    supabase: {
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    },

    cohere: {
      apiKey: env.COHERE_API_KEY,
      rerankModel: env.COHERE_RERANK_MODEL,
    },

    chatwoot: {
      baseUrl: env.CHATWOOT_BASE_URL,
      apiToken: env.CHATWOOT_API_TOKEN,
      webhookSecret: env.CHATWOOT_WEBHOOK_SECRET,
    },

    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      // Chat padrão (fallback global)
      chatId: env.TELEGRAM_CHAT_ID,
      // Chats de produção por unidade
      chatIdAssisBrasil: env.TELEGRAM_CHAT_ID_ASSIS_BRASIL ?? env.TELEGRAM_CHAT_ID,
      chatIdNiloPecanha: env.TELEGRAM_CHAT_ID_NILO_PECANHA ?? env.TELEGRAM_CHAT_ID,
      // Chat de teste (alertas em dev não chegam nas equipes reais)
      chatIdTest: testChatId,
    },

    inboxes: {
      // Produção
      assisBrasil: parseInt(env.CHATWOOT_INBOX_ID_ASSIS_BRASIL, 10),
      niloPecanha: parseInt(env.CHATWOOT_INBOX_ID_NILO_PECANHA, 10),
      // Teste por unidade (webhooks de teste das caixas reais)
      testAssisBrasil: env.CHATWOOT_INBOX_ID_TEST_ASSIS_BRASIL
        ? parseInt(env.CHATWOOT_INBOX_ID_TEST_ASSIS_BRASIL, 10)
        : null,
      testNiloPecanha: env.CHATWOOT_INBOX_ID_TEST_NILO_PECANHA
        ? parseInt(env.CHATWOOT_INBOX_ID_TEST_NILO_PECANHA, 10)
        : null,
      // Caixa pessoal de dev (número do Victor)
      testDev: env.CHATWOOT_INBOX_ID_TEST_DEV
        ? parseInt(env.CHATWOOT_INBOX_ID_TEST_DEV, 10)
        : null,
    },

    units: {
      assisAddress: env.UNIT_ASSIS_ADDRESS,
      assisHours: env.UNIT_ASSIS_HOURS,
      assisPhone: env.UNIT_ASSIS_PHONE,
      
      niloAddress: env.UNIT_NILO_ADDRESS,
      niloHours: env.UNIT_NILO_HOURS,
      niloPhone: env.UNIT_NILO_PHONE,
    },

    agent: {
      historyWindow: parseInt(env.HISTORY_WINDOW, 10),
      messageDebouncesMs: parseInt(env.MESSAGE_DEBOUNCE_MS, 10),
      ragTopK: parseInt(env.RAG_TOP_K, 10),
      ragTopN: parseInt(env.RAG_TOP_N, 10),
    },
  } as const;
}

export const config = loadConfig();
export type Config = typeof config;
