import axios from "axios";
import { config } from "../config";

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;

export interface EscalarHumanoParams {
  phone: string;
  name: string;
  lastMessage: string;
  conversationId: number;
  summary?: string;       // resumo BANT coletado pelo agente
  telegramChatId?: string; // override por unidade (usa config global como fallback)
  unitName?: string;       // nome da unidade para identificação no alerta
}

export async function sendEscalationAlert(params: EscalarHumanoParams): Promise<void> {
  const { phone, name, lastMessage, conversationId, summary, unitName } = params;

  // Usa o chat_id específico da unidade ou o fallback global do .env
  const chatId = params.telegramChatId || config.telegram.chatId;

  const nameDisplay = name || "(sem nome)";
  const unitDisplay = unitName ? `🏥 *Unidade:* ${unitName}\n` : "";
  const summaryBlock = summary ? `\n\n📋 *Resumo BANT:*\n${summary}` : "";

  const text =
    `🔔 *Atendimento para humano*\n\n` +
    unitDisplay +
    `👤 *Cliente:* ${nameDisplay}\n` +
    `📞 *Telefone:* ${phone}\n` +
    `💬 *Conversa ID:* ${conversationId}\n\n` +
    `📨 *Última mensagem:*\n${lastMessage}` +
    summaryBlock +
    `\n\n_Acesse o Chatwoot para continuar o atendimento._`;

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });

  console.log(`[Telegram] Alerta enviado → chat_id: ${chatId} | unidade: ${unitName ?? "padrão"}`);
}
