import { Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { getUnitByInboxId } from "../config/units";
import { ChatwootWebhookPayload, MessageContext } from "../types/chatwoot.types";
import { chatwootService } from "../services/chatwoot.service";
import { enqueueMessage } from "../services/queue.service";
import { runAgent, splitIntoMessages } from "../agents/agent";
import { isEscalated } from "../agents/tools";
import { sendEscalationAlert } from "../services/telegram.service";
import { upsertCliente, saveMessageHistory } from "../services/database.service";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Intervalo de refresh do "digitando…" — Chatwoot/WhatsApp derrubam o
// indicador em ~10-15s, então refrescamos a cada 8s enquanto o agente roda.
const TYPING_REFRESH_MS = 8_000;

// ─── Webhook Principal ────────────────────────────────────────────────────────

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  // Responder imediatamente para o Chatwoot não reenviar
  res.status(200).json({ ok: true });

  // ctx é hoisted para ficar disponível no catch (mensagem de fallback)
  let ctx: MessageContext | undefined;

  try {
    const payload = req.body as ChatwootWebhookPayload;

    // ── 1. Filtragem básica ────────────────────────────────────────────────
    if (!payload || payload.event !== "message_created") return;
    if (payload.message_type !== "incoming") return; // ignorar saída e atividades
    if (payload.private) return; // ignorar notas privadas

    const conv = payload.conversation;
    const msg = conv?.messages?.[0];

    if (!msg) return;

    // ── 2. Ignorar conversas escaladas/encerradas ─────────────────────────
    // Considera label `agente-off`/`resolvido` E status diferente de `open`.
    // Atendente reabre a conversa pelo botão "Reabrir" no Chatwoot (volta para
    // status=open) — esse é o mecanismo de "agente-on" via UI nativa.
    if (isEscalated(conv.labels ?? [], conv.status)) {
      console.log(
        `[Webhook] Conversa ${conv.id} escalada/encerrada (status=${conv.status}, labels=${JSON.stringify(conv.labels ?? [])}), ignorando.`,
      );
      return;
    }

    // ── 3. Extrair telefone e conteúdo ────────────────────────────────────
    const phone = msg.sender?.phone_number ?? payload.sender?.phone_number ?? "";
    const name = msg.sender?.name ?? payload.sender?.name ?? "";
    const isAudio = payload.attachments?.[0]?.meta?.is_recorded_audio === true;

    let content: string = msg.content ?? "";

    // ── 4. Transcrição de áudio (via Whisper) ─────────────────────────────
    if (isAudio && payload.attachments?.[0]?.data_url) {
      content = await transcribeAudio(payload.attachments[0].data_url);
    }

    // Ignorar mensagem sem conteúdo (ex: sticker, doc sem legenda)
    if (!content.trim() && !isAudio) {
      console.log(`[Webhook] Mensagem ${msg.id} sem conteúdo, ignorando.`);
      return;
    }

    ctx = {
      messageId: msg.id,
      accountId: msg.account_id,
      conversationId: conv.id,
      inboxId: conv.inbox_id,
      contactId: msg.sender?.id ?? payload.sender?.id ?? 0,
      phone,
      name,
      content,
      isAudio,
      labels: conv.labels ?? [],
      unit: getUnitByInboxId(conv.inbox_id), // identifica a unidade pelo inbox
    };

    console.log(`[Webhook] [${ctx.unit.name}] Mensagem de ${name} (${phone}): "${content.slice(0, 80)}"`);

    // ── 4.5 Salvar no banco (Clientes e Histórico) ────────────────────────
    await upsertCliente(phone, name, "whatsapp");
    await saveMessageHistory(phone, conv.id, "user", content);

    // ── 5. Fila de debounce (agrupa mensagens encavaladas) ─────────────────
    const batch = await enqueueMessage(ctx);

    // Follow-up calls (mensagens encavaladas após a primária) recebem `null`
    // e devem parar aqui — a primária já está processando o batch completo.
    if (batch === null) {
      console.log(`[Webhook] Mensagem ${ctx.messageId} agrupada no batch primário, ignorando.`);
      return;
    }

    // Marcar como lida
    await chatwootService.markAsRead(ctx.accountId, ctx.conversationId);

    // ── 6. Executar agente (com refresh contínuo do "digitando…") ──────────
    await chatwootService.setTyping(ctx.accountId, ctx.conversationId, true);
    const typingTimer = setInterval(() => {
      chatwootService
        .setTyping(ctx!.accountId, ctx!.conversationId, true)
        .catch(() => {});
    }, TYPING_REFRESH_MS);

    let replies: string[];
    let escalated: boolean;
    try {
      ({ replies, escalated } = await runAgent(batch));
    } finally {
      clearInterval(typingTimer);
      await chatwootService.setTyping(ctx.accountId, ctx.conversationId, false);
    }

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
        await saveMessageHistory(phone, ctx.conversationId, "assistant", part);
        await sleep(500); // pequena pausa entre partes
      }
    }
  } catch (err) {
    console.error("[Webhook] Erro no processamento:", err);
    if (ctx) {
      await sendFallbackAndEscalate(ctx).catch((fallbackErr) => {
        console.error("[Webhook] Fallback também falhou:", fallbackErr);
      });
    }
  }
}

// ─── Fallback de falha técnica ────────────────────────────────────────────────
//
// Quando algo dá errado no meio do processamento (OpenAI/Cohere/Supabase fora,
// timeout, erro inesperado), o usuário não pode ficar no escuro. Mandamos uma
// mensagem cordial, marcamos a conversa como agente-off (para não tentar de
// novo) e alertamos a equipe via Telegram.

async function sendFallbackAndEscalate(ctx: MessageContext): Promise<void> {
  // Evita duplicar fallback se já está escalado
  const labels = await chatwootService.getLabels(ctx.accountId, ctx.conversationId);
  if (labels.includes("agente-off")) return;

  await chatwootService.setTyping(ctx.accountId, ctx.conversationId, false).catch(() => {});

  await chatwootService.sendMessage(
    ctx.accountId,
    ctx.conversationId,
    "Tive uma instabilidade aqui de momento. Vou chamar um atendente para continuar com você.",
  );

  await chatwootService.addLabel(ctx.accountId, ctx.conversationId, "agente-off");

  await sendEscalationAlert({
    phone: ctx.phone,
    name: ctx.name,
    lastMessage: ctx.content,
    conversationId: ctx.conversationId,
    summary: "Handover automático por falha técnica no processamento.",
    telegramChatId: ctx.unit.telegramChatId,
    unitName: ctx.unit.fullName,
  });
}

// ─── Transcrição de Áudio ─────────────────────────────────────────────────────

async function transcribeAudio(audioUrl: string): Promise<string> {
  try {
    const buffer = await chatwootService.downloadFile(audioUrl);
    const file = new File([buffer], "audio.ogg", { type: "audio/ogg" });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: "pt",
    });

    // Sem prefixo "[Áudio transcrito]:" — a sinalização vai pelo campo
    // `isAudio` do MessageContext e é tratada no prompt da Ana.
    return transcription.text;
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
