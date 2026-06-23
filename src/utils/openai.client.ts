import https from "https";
import OpenAI from "openai";
import { config } from "../config";

// ─── Fábrica do cliente OpenAI (com correção de socket keep-alive) ────────────
//
// O SDK `openai` v4 usa `agentkeepalive` por padrão. Em serviços de baixo volume
// (WhatsApp de clínica) o processo fica ocioso entre mensagens; o servidor da
// OpenAI fecha o socket ocioso e, na mensagem seguinte, o socket morto é
// reutilizado → `ERR_STREAM_PREMATURE_CLOSE` (a conexão cai no meio da resposta).
//
// Solução: usar um httpsAgent com keepAlive DESLIGADO (conexão nova por request),
// o que elimina o reuso de socket morto. O custo extra de handshake é irrelevante
// no nosso volume. Somamos `timeout` e `maxRetries` como defesa adicional — o SDK
// re-tenta automaticamente erros de conexão/5xx/429 com backoff.

export function createOpenAI(): OpenAI {
  return new OpenAI({
    apiKey: config.openai.apiKey,
    httpAgent: new https.Agent({ keepAlive: false }),
    timeout: 60_000,
    maxRetries: 3,
  });
}
