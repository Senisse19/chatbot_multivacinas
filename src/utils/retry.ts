// ─── Retry com backoff exponencial + jitter ───────────────────────────────────
//
// Para chamadas a APIs externas (OpenAI, Cohere, Supabase) que ocasionalmente
// falham com 5xx, timeouts ou throttling. Pequenos retries cobrem a maioria
// dos casos sem afetar percepção de latência.

export interface RetryOptions {
  /** Número total de tentativas (incluindo a primeira). Default: 3. */
  attempts?: number;
  /** Delay base em ms (cresce exponencialmente). Default: 500. */
  baseDelayMs?: number;
  /** Rótulo para o log. */
  label?: string;
  /** Função de decisão: se retornar false, não tenta novamente. */
  shouldRetry?: (err: unknown) => boolean;
}

// ─── Classificação de erro transitório vs permanente ──────────────────────────
//
// Transitório = vale a pena re-tentar / NÃO deve desligar o bot:
//   - erros de conexão (socket morto/keep-alive): ERR_STREAM_PREMATURE_CLOSE,
//     ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE, ENOTFOUND, EAI_AGAIN
//   - timeouts/abortos do fetch/SDK (AbortError, APIConnectionError/Timeout)
//   - HTTP 408/409/425/429 e 5xx
// Permanente = não adianta re-tentar (401/403/404/400 etc.).

const TRANSIENT_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    errno?: string;
    name?: string;
    status?: number;
    statusCode?: number;
    cause?: unknown;
    message?: string;
  };

  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e.errno && TRANSIENT_CODES.has(e.errno)) return true;

  const status = e.status ?? e.statusCode;
  if (typeof status === "number" && TRANSIENT_STATUS.has(status)) return true;

  // Erros do SDK OpenAI / fetch por nome
  const name = e.name ?? "";
  if (
    name === "AbortError" ||
    name === "FetchError" ||
    name === "APIConnectionError" ||
    name === "APIConnectionTimeoutError" ||
    name === "InternalServerError"
  ) {
    return true;
  }

  // Mensagem (último recurso — cobre "Premature close" sem code preenchido)
  const msg = (e.message ?? "").toLowerCase();
  if (
    msg.includes("premature close") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnreset")
  ) {
    return true;
  }

  // Erros encadeados (fetch costuma aninhar a causa real em `cause`)
  if (e.cause && e.cause !== err) return isTransientError(e.cause);

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    label = "external_call",
    shouldRetry = isTransientError,
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
