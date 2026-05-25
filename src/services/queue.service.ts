import { MessageContext } from "../types/chatwoot.types";
import { config } from "../config";

// ─── Fila de mensagens encavaladas (debounce por telefone) ────────────────────
//
// O mesmo usuário pode enviar várias mensagens em sequência antes do bot
// terminar de processar a primeira. Em vez de responder várias vezes,
// agrupamos todas e processamos apenas a última rodada de mensagens juntas.
//
// Modelo:
//   - O PRIMEIRO webhook a chegar é o "primário" e receberá o batch completo.
//   - Webhooks subsequentes (follow-ups) reiniciam o timer mas resolvem com
//     `null` quando o debounce termina — sinal para o caller pular o
//     processamento (que já está nas mãos do primário).
//
// Isso evita:
//   1. Promises órfãs que nunca resolvem (vazamento de memória).
//   2. Múltiplas execuções paralelas do agente para o mesmo batch.

interface QueueEntry {
  messages: MessageContext[];
  timer: ReturnType<typeof setTimeout>;
  primaryResolver: (m: MessageContext[]) => void;
  followupResolvers: Array<(m: MessageContext[] | null) => void>;
}

const queue = new Map<string, QueueEntry>();

/**
 * Enfileira a mensagem com debounce por telefone.
 *
 * Retorna:
 *   - `MessageContext[]` para o primeiro chamador (deve executar o agente).
 *   - `null` para chamadores subsequentes (devem retornar sem fazer nada).
 */
export function enqueueMessage(
  ctx: MessageContext,
): Promise<MessageContext[] | null> {
  const key = ctx.phone;

  return new Promise<MessageContext[] | null>((resolve) => {
    const existing = queue.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(ctx);
      existing.followupResolvers.push(resolve);

      existing.timer = setTimeout(() => {
        const batch = existing.messages;
        queue.delete(key);
        // Followups recebem null para que pulem o processamento
        for (const r of existing.followupResolvers) r(null);
        // Primário recebe o batch completo
        existing.primaryResolver(batch);
      }, config.agent.messageDebouncesMs);
    } else {
      const entry: QueueEntry = {
        messages: [ctx],
        followupResolvers: [],
        primaryResolver: resolve,
        timer: setTimeout(() => {
          const batch = entry.messages;
          queue.delete(key);
          for (const r of entry.followupResolvers) r(null);
          entry.primaryResolver(batch);
        }, config.agent.messageDebouncesMs),
      };
      queue.set(key, entry);
    }
  });
}
