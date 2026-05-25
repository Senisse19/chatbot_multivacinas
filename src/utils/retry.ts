// ─── Retry com backoff exponencial + jitter ───────────────────────────────────
//
// Para chamadas a APIs externas (OpenAI, Cohere, Supabase) que ocasionalmente
// falham com 5xx, timeouts ou throttling. Pequenos retries cobrem a maioria
// dos casos sem afetar percepção de latência.

export interface RetryOptions {
  /** Número total de tentativas (incluindo a primeira). Default: 2. */
  attempts?: number;
  /** Delay base em ms (cresce exponencialmente). Default: 400. */
  baseDelayMs?: number;
  /** Rótulo para o log. */
  label?: string;
  /** Função de decisão: se retornar false, não tenta novamente. */
  shouldRetry?: (err: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 2,
    baseDelayMs = 400,
    label = "external_call",
    shouldRetry = () => true,
  } = options;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i >= attempts - 1 || !shouldRetry(err)) break;
      const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 200;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Retry] ${label} falhou (tentativa ${i + 1}/${attempts}): ${msg}. Retry em ${Math.round(delay)}ms.`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
