import { Request, Response } from "express";
import { getUnitByInboxId } from "../config/units";
import { ChatwootWebhookPayload, MessageContext } from "../types/chatwoot.types";
import { chatwootService } from "../services/chatwoot.service";
import { enqueueMessage } from "../services/queue.service";
import { runAgent, splitWithLLM } from "../agents/agent";
import { isEscalated } from "../agents/tools";
import { sendEscalationAlert } from "../services/telegram.service";
import { upsertCliente, saveMessageHistory } from "../services/database.service";
import { createOpenAI } from "../utils/openai.client";
import { isTransientError } from "../utils/retry";

const openai = createOpenAI();

// Intervalo de refresh do "digitando…" — Chatwoot/WhatsApp derrubam o
// indicador em ~10-15s, então refrescamos a cada 8s enquanto o agente roda.
const TYPING_REFRESH_MS = 8_000;

// Cache de IDs processados para ignorar webhooks duplicados do Chatwoot.
// O Chatwoot v3+ pode disparar o mesmo message_created duas vezes em falhas de
// entrega. TTL de 30s é suficiente para cobrir qualquer retry do Chatwoot.
const processedMessageIds = new Map<number, number>(); // messageId → timestamp
const DEDUP_TTL_MS = 30_000;

// Aviso padrão de handover, usado só se o agente não gerou texto de transição.
// Garante que o usuário nunca fique no escuro quando o bot passa para um humano.
const HANDOVER_FALLBACK_MSG =
  "Vou te transferir para um atendente da nossa equipe, tá? Em instantes alguém continua seu atendimento por aqui 😊";

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

    // ── 1.5 Deduplicação de webhooks duplicados do Chatwoot ───────────────
    const nowTs = Date.now();
    for (const [id, ts] of processedMessageIds) {
      if (nowTs - ts > DEDUP_TTL_MS) processedMessageIds.delete(id);
    }
    if (processedMessageIds.has(msg.id)) {
      console.log(`[Webhook] Mensagem ${msg.id} já processada (duplicata do Chatwoot), ignorando.`);
      return;
    }
    processedMessageIds.set(msg.id, nowTs);

    // ── 2. Ignorar conversas escaladas/encerradas ─────────────────────────
    // Considera label `agente-off`/`resolvido` E status diferente de `open`.
    // Atendente reabre a conversa pelo botão "Reabrir" no Chatwoot (volta para
    // status=open) — esse é o mecanismo de "agente-on" via UI nativa.
    if (isEscalated(conv.labels ?? [], conv.status)) {
      const labels = conv.labels ?? [];
      const isManualEscalation = !labels.includes("agente-off") && !labels.includes("resolvido");
      const reason = isManualEscalation ? "encerrada manualmente" : "escalada/encerrada";
      console.log(
        `[Webhook] Conversa ${conv.id} ${reason} (status=${conv.status}, labels=${JSON.stringify(labels)}), ignorando.`,
      );
      return;
    }

    // ── 3. Extrair telefone e conteúdo ────────────────────────────────────
    const phone = msg.sender?.phone_number ?? payload.sender?.phone_number ?? "";
    const fullName = msg.sender?.name ?? payload.sender?.name ?? "";
    const name = fullName.trim().split(/\s+/)[0] ?? "";
    const isAudio = payload.attachments?.[0]?.meta?.is_recorded_audio === true;

    let content: string = msg.content ?? "";

    // ── 4. Transcrição de áudio (via Whisper) ─────────────────────────────
    if (isAudio && payload.attachments?.[0]?.data_url) {
      content = await transcribeAudio(payload.attachments[0].data_url);
    }

    // Áudio que não pôde ser transcrito (Whisper falhou/instável): em vez de
    // seguir com texto vazio, peça que o cliente escreva.
    if (isAudio && !content.trim()) {
      console.log(`[Webhook] Áudio ${msg.id} não transcrito, pedindo texto.`);
      await chatwootService
        .sendMessage(
          msg.account_id,
          conv.id,
          "Não consegui ouvir seu áudio agora 🙈 pode me escrever por texto, por favor?",
        )
        .catch(() => {});
      return;
    }

    // Ignorar mensagem sem conteúdo (ex: sticker, doc sem legenda)
    if (!content.trim()) {
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

    // Handover: o agente NÃO envia sozinho a mensagem de transição (a tool só
    // alerta a equipe e muda o status). Então enviamos aqui o texto que o LLM
    // gerou (transição/despedida); se vier vazio, um aviso padrão — o usuário
    // precisa saber que vai falar com um atendente, senão a conversa só "morre".
    if (escalated) {
      console.log(`[Webhook] Conversa ${ctx.conversationId} escalada para humano.`);
      const avisos = replies.length > 0 ? replies : [HANDOVER_FALLBACK_MSG];
      for (const aviso of avisos) {
        await chatwootService.setTyping(ctx.accountId, ctx.conversationId, true);
        await sleep(typingDelay(aviso));
        await chatwootService.setTyping(ctx.accountId, ctx.conversationId, false);
        await chatwootService.sendMessage(ctx.accountId, ctx.conversationId, aviso);
        await saveMessageHistory(phone, ctx.conversationId, "assistant", aviso);
        await sleep(500);
      }
      return;
    }

    // ── 7. Enviar respostas com delay entre mensagens ──────────────────────
    // Se o usuário mandou várias mensagens em sequência, autorizamos o splitter
    // a devolver mais partes (uma por bloco lógico da resposta).
    const maxParts = Math.max(2, batch.length);
    for (const reply of replies) {
      const parts = await splitWithLLM(reply, maxParts);
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
      await handleProcessingError(ctx, err).catch((fallbackErr) => {
        console.error("[Webhook] Fallback também falhou:", fallbackErr);
      });
    }
  }
}

// ─── Tratamento de falha técnica ──────────────────────────────────────────────
//
// Erro TRANSITÓRIO (rede/timeout/5xx — ex.: ERR_STREAM_PREMATURE_CLOSE da OpenAI):
//   NÃO desliga o bot. Pede para reenviar e mantém a conversa `open`, então a
//   próxima mensagem é processada normalmente (auto-recuperação). Avisa a equipe.
// Erro PERMANENTE/desconhecido:
//   Handover real — apologia + agente-off + status `pending` (gating por status)
//   + alerta no Telegram.

async function handleProcessingError(ctx: MessageContext, err: unknown): Promise<void> {
  await chatwootService.setTyping(ctx.accountId, ctx.conversationId, false).catch(() => {});

  if (isTransientError(err)) {
    console.log(
      `[Webhook] Erro transitório na conversa ${ctx.conversationId} — bot mantido ligado (sem agente-off).`,
    );
    await chatwootService.sendMessage(
      ctx.accountId,
      ctx.conversationId,
      "Tive uma instabilidade rápida aqui 🙈 Pode me reenviar sua última mensagem, por favor?",
    );
    // Avisa a equipe (informativo), mas NÃO escala/desliga o bot.
    await sendEscalationAlert({
      phone: ctx.phone,
      name: ctx.name,
      lastMessage: ctx.content,
      conversationId: ctx.conversationId,
      summary: "Instabilidade técnica transitória (rede/OpenAI). Bot segue ligado; pedi reenvio ao cliente.",
      telegramChatId: ctx.unit.telegramChatId,
      unitName: ctx.unit.fullName,
    }).catch(() => {});
    return;
  }

  // Permanente/desconhecido → handover real. Evita duplicar se já escalado.
  const labels = await chatwootService.getLabels(ctx.accountId, ctx.conversationId);
  if (labels.includes("agente-off")) return;

  await chatwootService.sendMessage(
    ctx.accountId,
    ctx.conversationId,
    "Tive uma instabilidade aqui de momento. Vou chamar um atendente para continuar com você.",
  );

  await chatwootService.addLabel(ctx.accountId, ctx.conversationId, "agente-off");
  // Gating do bot é por STATUS (ver isEscalated): precisa de `pending` para desligar.
  await chatwootService.toggleStatus(ctx.accountId, ctx.conversationId, "pending");

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
