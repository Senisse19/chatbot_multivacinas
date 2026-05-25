import { MessageContext } from "../types/chatwoot.types";
import { config } from "../config";

// ─── Fila de mensagens encavaladas (debounce por telefone) ────────────────────
//
// O mesmo usuário pode enviar várias mensagens em sequência antes do bot
// terminar de processar a primeira. Em vez de responder várias vezes,
// agrupamos todas e processamos apenas a última rodada de mensagens juntas.
// Isso replica o comportamento do n8n (Enfileirar → Esperar → Analise-Mensagens).

interface QueueEntry {
  messages: MessageContext[];
  timer: ReturnType<typeof setTimeout>;
  resolve: (messages: MessageContext[]) => void;
}

const queue = new Map<string, QueueEntry>();

/**
 * Adiciona a mensagem à fila do telefone e retorna uma Promise que resolve
 * com TODAS as mensagens acumuladas após o período de debounce.
 *
 * Se o usuário continuar mandando mensagens dentro do intervalo, o timer
 * é reiniciado, acumulando mais conteúdo antes de processar.
 */
export function enqueueMessage(ctx: MessageContext): Promise<MessageContext[]> {
  const key = ctx.phone;

  return new Promise<MessageContext[]>((resolve) => {
    const existing = queue.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(ctx);

      const timer = setTimeout(() => {
        queue.delete(key);
        existing.resolve(existing.messages);
      }, config.agent.messageDebouncesMs);

      existing.timer = timer;
    } else {
      const entry: QueueEntry = {
        messages: [ctx],
        timer: setTimeout(() => {
          queue.delete(key);
          entry.resolve(entry.messages);
        }, config.agent.messageDebouncesMs),
        resolve,
      };
      queue.set(key, entry);
    }
  });
}
