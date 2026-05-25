import { Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { getUnitByInboxId } from "../config/units";
import { ChatwootWebhookPayload, MessageContext } from "../types/chatwoot.types";
import { chatwootService } from "../services/chatwoot.service";
import { enqueueMessage } from "../services/queue.service";
import { runAgent, splitIntoMessages } from "../agents/agent";
import { isEscalated } from "../agents/tools";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// ─── Webhook Principal ────────────────────────────────────────────────────────

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  // Responder imediatamente para o Chatwoot não reenviar
  res.status(200).json({ ok: true });

  try {
    const payload = req.body as ChatwootWebhookPayload;

    // ── 1. Filtragem básica ────────────────────────────────────────────────
    if (!payload || payload.event !== "message_created") return;
    if (payload.message_type !== "incoming") return; // ignorar saída e atividades
    if (payload.private) return; // ignorar notas privadas

    const conv = payload.conversation;
    const msg = conv?.messages?.[0];

    if (!msg) return;

    // ── 2. Ignorar conversas com etiqueta agente-off ──────────────────────
    if (isEscalated(conv.labels ?? [])) {
      console.log(`[Webhook] Conversa ${conv.id} tem agente-off, ignorando.`);
      return;
    }

    // ── 3. Extrair telefone e conteúdo ────────────────────────────────────
    const phone = msg.sender?.phone_number ?? payload.sender?.phone_number ?? "";
    const name = msg.sender?.name ?? payload.sender?.name ?? "";
    const isAudio = payload.attachments?.[0]?.meta?.is_recorded_audio === true;

    let content: string = msg.content ?? "";

    // ── 4. Transcrição de áudio (via Whisper) ─────────────────────────────
    if (isAudio && payload.attachments?.[0]?.data_url) {
      content = await transcribeAudio(payload.attachments[0].data_url, payload);
    }

    // Ignorar mensagem sem conteúdo (ex: sticker, doc sem legenda)
    if (!content.trim() && !isAudio) {
      console.log(`[Webhook] Mensagem ${msg.id} sem conteúdo, ignorando.`);
      return;
    }

    const ctx: MessageContext = {
      messageId: msg.id,
      accountId: msg.account_id,
      conversationId: conv.id,
      inboxId: conv.inbox_id,
      phone,
      name,
      content,
      isAudio,
      labels: conv.labels ?? [],
      unit: getUnitByInboxId(conv.inbox_id), // identifica a unidade pelo inbox
    };

    console.log(`[Webhook] [${ctx.unit.name}] Mensagem de ${name} (${phone}): "${content.slice(0, 80)}"`);

    // ── 5. Fila de debounce (agrupa mensagens encavaladas) ─────────────────
    const batch = await enqueueMessage(ctx);

    // Marcar como lida
    await chatwootService.markAsRead(ctx.accountId, ctx.conversationId);

    // ── 6. Executar agente ────────────────────────────────────────────────
    await chatwootService.setTyping(ctx.accountId, ctx.conversationId, true);

    const { replies, escalated } = await runAgent(batch);

    await chatwootService.setTyping(ctx.accountId, ctx.conversationId, false);

    // Se escalado, o agente já enviou a mensagem de transição
    if (escalated) {
      console.log(`[Webhook] Conversa ${ctx.conversationId} escalada para humano.`);
      return;
    }

    // ── 7. Enviar respostas com delay entre mensagens ──────────────────────
    for (const reply of replies) {
      const parts = await splitIntoMessages(reply);
      for (const part of parts) {
        await chatwootService.setTyping(ctx.accountId, ctx.conversationId, true);
        await sleep(typingDelay(part));
        await chatwootService.setTyping(ctx.accountId, ctx.conversationId, false);
        await chatwootService.sendMessage(ctx.accountId, ctx.conversationId, part);
        await sleep(500); // pequena pausa entre partes
      }
    }
  } catch (err) {
    console.error("[Webhook] Erro no processamento:", err);
  }
}

// ─── Transcrição de Áudio ─────────────────────────────────────────────────────

async function transcribeAudio(
  audioUrl: string,
  payload: ChatwootWebhookPayload,
): Promise<string> {
  try {
    const buffer = await chatwootService.downloadFile(audioUrl);
    const file = new File([buffer], "audio.ogg", { type: "audio/ogg" });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: "pt",
    });

    return `[Áudio transcrito]: ${transcription.text}`;
  } catch (err) {
    console.error("[Webhook] Erro ao transcrever áudio:", err);
    return "";
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Calcula um delay de digitação proporcional ao comprimento do texto (máx 4s) */
function typingDelay(text: string): number {
  const WPM = 300; // palavras por minuto de digitação "rápida"
  const words = text.split(/\s+/).length;
  const ms = (words / WPM) * 60_000;
  return Math.min(Math.max(ms, 800), 4_000);
}
