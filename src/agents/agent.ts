import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { config } from "../config";
import { PUBLIC_BRAND_NAME, buildSystemPrompt } from "./prompt";
import { TOOLS, executeTool, ToolContext } from "./tools";
import { MessageContext } from "../types/chatwoot.types";
import { chatwootService } from "../services/chatwoot.service";
import { withRetry } from "../utils/retry";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 10; // segurança contra loop infinito

function supportsChatCompletionsReasoningEffort(model: string): boolean {
  // This app currently uses Chat Completions. In this endpoint, gpt-5.4-mini
  // has returned 400 "Unrecognized request argument supplied: reasoning_effort".
  // Keep this allowlist narrow to avoid breaking production on model changes.
  return model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
}

function getCurrentGreeting(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  });
  const hourPart = formatter
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart ?? formatter.format(now));

  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function normalizeGreetingText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingOnly(text: string): boolean {
  const normalized = normalizeGreetingText(text);
  if (!normalized || normalized.length > 120) return false;
  if (/(vacina|agendar|marcar|consulta|preco|valor|dose|hpv|gripe|covid|febre|meningite|dengue|exame|procedimento)/.test(normalized)) {
    return false;
  }

  const allowedTokens = new Set([
    "bom",
    "boa",
    "dia",
    "tarde",
    "noite",
    "oi",
    "ola",
    "opa",
    "eai",
    "salve",
    "familia",
    "tudo",
    "td",
    "bem",
    "blz",
    "beleza",
    "como",
    "estamos",
    "vai",
    "indo",
  ]);

  return normalized.split(" ").every((token) => allowedTokens.has(token));
}

function buildInstitutionalGreeting(name: string): string {
  const greeting = getCurrentGreeting();
  const namePart = name ? `, ${name}` : "";

  return `${greeting}${namePart}! Sou a Ana, da ${PUBLIC_BRAND_NAME}. Estou por aqui para te ajudar. O que você precisa hoje?`;
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

/**
 * Executa o ciclo completo do agente para um lote de mensagens:
 * 1. Busca histórico do Chatwoot
 * 2. Monta o prompt
 * 3. Loop de chamadas à OpenAI + execução de ferramentas
 * 4. Retorna o array de mensagens finais para envio
 */
export async function runAgent(
  messages: MessageContext[],
): Promise<{ replies: string[]; escalated: boolean }> {
  // Usamos o contexto da última mensagem como principal
  const ctx = messages[messages.length - 1];
  const validContents = messages.map((m) => m.content).filter(Boolean);
  // Quando o usuário mandou 2+ mensagens em sequência, numeramos para que o
  // LLM perceba claramente que são perguntas distintas e cubra todas.
  const combinedContent =
    validContents.length > 1
      ? validContents.map((c, i) => `[Mensagem ${i + 1}] ${c}`).join("\n")
      : validContents.join("\n");

  // ─── Histórico + BANT persistido (em paralelo) ────────────────────────────
  const [history, contactAttrs] = await Promise.all([
    chatwootService.getConversationMessages(
      ctx.accountId,
      ctx.conversationId,
      config.agent.historyWindow,
    ),
    ctx.contactId
      ? chatwootService.getContactAttributes(ctx.accountId, ctx.contactId)
      : Promise.resolve({} as Record<string, unknown>),
  ]);

  const savedBant = (contactAttrs.bant as Record<string, string> | undefined) ?? {};

  // ─── System prompt ────────────────────────────────────────────────────────
  // firstContact: nenhuma mensagem da Ana ainda → primeira interação real.
  // (history vem do Chatwoot já filtrado por role="user"|"assistant")
  const firstContact = !history.some((h) => h.role === "assistant");

  const batchContents = new Set(
    messages.map((m) => m.content).filter((c) => c && c.trim().length > 0),
  );
  const cleanHistory = history.filter(
    (h) => !(h.role === "user" && batchContents.has(h.content)),
  );

  if (cleanHistory.length !== history.length - messages.length) {
    console.warn(
      `[Agent] Limpeza de histórico inesperada: history=${history.length}, batch=${messages.length}, clean=${cleanHistory.length}`,
    );
  }

  const hasMeaningfulPriorUserMessage = cleanHistory.some(
    (h) => h.role === "user" && !isGreetingOnly(h.content),
  );
  const shouldUseInstitutionalGreeting =
    isGreetingOnly(combinedContent) && (firstContact || !hasMeaningfulPriorUserMessage);

  if (shouldUseInstitutionalGreeting) {
    console.log(
      `[Agent] Saudação institucional direta: firstContact=${firstContact}, meaningfulPriorUser=${hasMeaningfulPriorUserMessage}`,
    );
    return {
      replies: [buildInstitutionalGreeting(ctx.name)],
      escalated: false,
    };
  }

  const systemPrompt = buildSystemPrompt({
    name: ctx.name,
    conversationId: ctx.conversationId,
    now: new Date(),
    unit: ctx.unit,
    firstContact,
    isAudio: messages.some((m) => m.isAudio),
    savedBant,
  });

  // ─── Construção do array de mensagens ─────────────────────────────────────
  const conversationMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // Histórico anterior (sem as mensagens do batch atual)
    ...cleanHistory.map(
      (m): ChatCompletionMessageParam => ({
        role: m.role,
        content: m.content,
      }),
    ),
    // Mensagem(ns) atual(is), pode ser uma ou várias agrupadas
    { role: "user", content: combinedContent },
  ];

  const toolCtx: ToolContext = {
    phone: ctx.phone,
    name: ctx.name,
    lastMessage: combinedContent,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    messageId: ctx.messageId,
    telegramChatId: ctx.unit.telegramChatId,
    unitName: ctx.unit.fullName,
  };

  // ─── Agentic loop ─────────────────────────────────────────────────────────
  let escalated = false;
  const finalReplies: string[] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // reasoning_effort is only sent to Chat Completions models known to accept it.
    // gpt-5.4-mini rejects this top-level field in the current production route.
    const reasoningEffort = config.openai.reasoningEffort;
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: config.openai.model,
      messages: conversationMessages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_completion_tokens: 1024,
    };
    if (
      reasoningEffort !== "none" &&
      supportsChatCompletionsReasoningEffort(config.openai.model)
    ) {
      params.reasoning_effort = reasoningEffort;
    }

    const response = await withRetry(
      () => openai.chat.completions.create(params),
      { label: "openai.chat.completions" },
    );

    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const totalPromptTokens = response.usage?.prompt_tokens ?? 0;
    if (totalPromptTokens > 0) {
      const pct = Math.round((100 * cachedTokens) / totalPromptTokens);
      console.log(
        `[Agent] prompt_tokens=${totalPromptTokens}, cached=${cachedTokens} (${pct}%)`,
      );
    }

    const choice = response.choices[0];
    const message = choice.message;

    // Adicionar a resposta ao histórico do loop
    conversationMessages.push(message as ChatCompletionMessageParam);

    // ─── Sem chamada de ferramenta → resposta final ─────────────────────────
    if (choice.finish_reason === "stop" || !message.tool_calls?.length) {
      if (message.content) {
        finalReplies.push(message.content.trim());
      }
      break;
    }

    // ─── Executar chamadas de ferramenta ───────────────────────────────────
    for (const toolCall of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      const result = await executeTool(toolCall.function.name, args, toolCtx);

      if (result.escalated) {
        escalated = true;
      }

      const toolMessage: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.output,
      };
      conversationMessages.push(toolMessage);
    }
  }

  return { replies: finalReplies, escalated };
}

// ─── Splitter LLM (estilo n8n "Agente divisor de mensagens") ──────────────────
//
// Recebe a resposta da Ana e devolve 1 ou 2 partes naturais, simulando
// digitação humana no WhatsApp. Mensagens curtas (≤120 chars) pulam o LLM
// para economizar latência/custo. Em caso de falha do LLM, cai no splitter
// regex (splitIntoMessages) abaixo.

function buildSplitterPrompt(maxParts: number): string {
  return `## PAPEL
Você divide uma mensagem da assistente Ana em 1 a ${maxParts} parte(s), simulando o envio natural de WhatsApp. Não reescreva nem traduza — só separe.

## REGRAS
- Devolva 1 parte se a mensagem for curta, direta ou tiver uma única ideia.
- Devolva mais de 1 parte apenas quando houver ideias bem distintas (ex.: afirmação + pergunta, contexto + lista, respostas a perguntas separadas do usuário).
- NUNCA devolva mais de ${maxParts} parte(s).
- NUNCA quebre listas, enumerações ou itens com "-", "•", "1.", "2." em mensagens diferentes — mantenha juntos.
- NUNCA corte uma frase no meio.
- NUNCA altere palavras, pontuação ou formatação (negrito, *itálico*).
- Não invente conteúdo novo. Não adicione saudações ou despedidas.
- Se a mensagem tem apenas uma frase, devolva como 1 parte só.

## FORMATO DE SAÍDA
Responda APENAS com JSON neste formato exato:
{"mensagens": ["parte 1"]}
ou
{"mensagens": ["parte 1", "parte 2", ...]}

## EXEMPLOS
Entrada: "Boa tarde! Tudo bem? Como posso ajudar?"
Saída: {"mensagens": ["Boa tarde! Tudo bem? Como posso ajudar?"]}

Entrada: "A gente trabalha com vacinas de gripe, HPV, meningite, pneumocócicas, herpes-zóster, hepatites, febre amarela, dengue, VSR e várias outras. Você procura alguma vacina específica ou é para alguém em uma fase/necessidade, como bebê, gestante, idoso ou viagem?"
Saída: {"mensagens": ["A gente trabalha com vacinas de gripe, HPV, meningite, pneumocócicas, herpes-zóster, hepatites, febre amarela, dengue, VSR e várias outras.", "Você procura alguma vacina específica ou é para alguém em uma fase/necessidade, como bebê, gestante, idoso ou viagem?"]}`;
}

export async function splitWithLLM(
  text: string,
  maxParts: number = 2,
): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Mensagens curtas não vão pro splitter — economia de latência/custo.
  // Se maxParts>2 (batch do usuário com várias perguntas), passamos mesmo
  // assim, porque a resposta provavelmente concatena múltiplos blocos.
  if (trimmed.length <= 120 && maxParts <= 2) return [trimmed];

  const cap = Math.max(1, maxParts);

  try {
    const response = await withRetry(
      () =>
        openai.chat.completions.create({
          model: config.openai.splitterModel,
          messages: [
            { role: "system", content: buildSplitterPrompt(cap) },
            { role: "user", content: trimmed },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_completion_tokens: 800,
        }),
      { label: "openai.splitter" },
    );

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { mensagens?: unknown };
    const parts = Array.isArray(parsed.mensagens)
      ? parsed.mensagens
          .filter(
            (p): p is string => typeof p === "string" && p.trim().length > 0,
          )
          .map((p) => p.trim())
      : [];

    if (parts.length === 0) {
      console.warn("[Splitter] LLM devolveu array vazio, usando fallback regex");
      return splitIntoMessages(trimmed);
    }
    // Hard cap (se o LLM ignorar a regra).
    return parts.slice(0, cap);
  } catch (err) {
    console.error("[Splitter] Falha no LLM splitter, usando fallback regex:", err);
    return splitIntoMessages(trimmed);
  }
}

// ─── Divisão inteligente de mensagens longas ──────────────────────────────────
//
// O agente retorna um único bloco de texto. Dividimos em partes naturais
// para simular o estilo de digitação humana do WhatsApp.
// Replicamos o comportamento do nó "Split-Mensagens" do n8n.
// Fallback usado quando o splitWithLLM acima falha.

export async function splitIntoMessages(text: string): Promise<string[]> {
  if (!text || text.trim() === "") return [];

  // Resposta curta (até 300 chars) → envia em uma mensagem só
  if (text.length <= 300) return [text.trim()];

  // Tentar dividir em parágrafos naturais (linha dupla)
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length >= 2 && paragraphs.length <= 3) {
    return paragraphs;
  }

  // Fallback: dividir por sentenças, preservando abreviações comuns
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return [text.trim()];

  const mid = Math.ceil(sentences.length / 2);
  return [
    sentences.slice(0, mid).join(" ").trim(),
    sentences.slice(mid).join(" ").trim(),
  ].filter((s) => s.length > 0);
}

// Abreviações pt-BR comuns que não devem terminar frase. Antes do regex de
// sentença, substituímos o ponto por um placeholder da Private Use Area
// (\uE000), garantidamente ausente do texto real, e restauramos depois.
const DOT_PH = "\uE000";

const ABBREV_PATTERNS: Array<[RegExp, string]> = [
  [/\bDr\./g, `Dr${DOT_PH}`],
  [/\bDra\./g, `Dra${DOT_PH}`],
  [/\bSr\./g, `Sr${DOT_PH}`],
  [/\bSra\./g, `Sra${DOT_PH}`],
  [/\bex\./g, `ex${DOT_PH}`],
  [/\bAv\./g, `Av${DOT_PH}`],
  [/\bnº\./g, `nº${DOT_PH}`],
  // Números com separador decimal/milhar: 1.000 ou 1.5
  [/(\d)\.(\d)/g, `$1${DOT_PH}$2`],
];

function splitSentences(text: string): string[] {
  let protectedText = text;
  for (const [from, to] of ABBREV_PATTERNS) {
    protectedText = protectedText.replace(from, to);
  }

  const matched = protectedText.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!matched) return [text];

  return matched.map((s) => s.replace(new RegExp(DOT_PH, "g"), "."));
}
