import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { config } from "../config";
import { buildSystemPrompt } from "./prompt";
import { TOOLS, executeTool, ToolContext } from "./tools";
import { MessageContext } from "../types/chatwoot.types";
import { chatwootService } from "../services/chatwoot.service";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 10; // segurança contra loop infinito

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
  const combinedContent = messages.map((m) => m.content).filter(Boolean).join("\n");

  // ─── Histórico da conversa ────────────────────────────────────────────────
  const history = await chatwootService.getConversationMessages(
    ctx.accountId,
    ctx.conversationId,
    config.agent.historyWindow,
  );

  // ─── System prompt ────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    phone: ctx.phone,
    conversationId: ctx.conversationId,
    now: new Date(),
    unit: ctx.unit,
  });

  // ─── Construção do array de mensagens ─────────────────────────────────────
  const conversationMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // Histórico anterior
    ...history.slice(0, -1).map(
      (m): ChatCompletionMessageParam => ({
        role: m.role,
        content: m.content,
      }),
    ),
    // Mensagem(ns) atual(is) — pode ser uma ou várias agrupadas
    { role: "user", content: combinedContent },
  ];

  const toolCtx: ToolContext = {
    phone: ctx.phone,
    name: ctx.name,
    lastMessage: combinedContent,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    telegramChatId: ctx.unit.telegramChatId,
    unitName: ctx.unit.fullName,
  };

  // ─── Agentic loop ─────────────────────────────────────────────────────────
  let escalated = false;
  const finalReplies: string[] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: conversationMessages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1024,
    });

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

// ─── Divisão inteligente de mensagens longas ──────────────────────────────────
//
// O agente retorna um único bloco de texto. Dividimos em partes naturais
// para simular o estilo de digitação humana do WhatsApp.
// Replicamos o comportamento do nó "Split-Mensagens" do n8n.

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

  // Se não houver parágrafos claros, dividir ao final de sentenças para no máximo 2 partes
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const mid = Math.ceil(sentences.length / 2);
  return [
    sentences.slice(0, mid).join(" ").trim(),
    sentences.slice(mid).join(" ").trim(),
  ].filter((s) => s.length > 0);
}
