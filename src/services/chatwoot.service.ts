import axios, { AxiosInstance } from "axios";
import { config } from "../config";

// ─── Cliente HTTP do Chatwoot ─────────────────────────────────────────────────

class ChatwootService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.chatwoot.baseUrl,
      headers: {
        "api_access_token": config.chatwoot.apiToken,
        "Content-Type": "application/json",
      },
      timeout: 15_000,
    });
  }

  // ─── Marcar conversa como lida ──────────────────────────────────────────────

  async markAsRead(accountId: number, conversationId: number): Promise<void> {
    await this.client
      .post(`/api/v1/accounts/${accountId}/conversations/${conversationId}/update_last_seen`)
      .catch(() => { /* não fatal */ });
  }

  // ─── Status de digitando ────────────────────────────────────────────────────

  async setTyping(accountId: number, conversationId: number, typing: boolean): Promise<void> {
    await this.client
      .post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_typing_status`,
        { typing_status: typing ? "on" : "off" },
      )
      .catch(() => { /* não fatal */ });
  }

  // ─── Enviar mensagem de texto ───────────────────────────────────────────────

  async sendMessage(
    accountId: number,
    conversationId: number,
    content: string,
  ): Promise<void> {
    await this.client.post(
      `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
      { content, message_type: "outgoing", private: false },
    );
  }

  // ─── Enviar reação com emoji ────────────────────────────────────────────────

  async sendReaction(
    accountId: number,
    conversationId: number,
    messageId: number,
    emoji: string,
  ): Promise<void> {
    await this.client
      .post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
        {
          content: emoji,
          content_attributes: {
            in_reply_to: messageId,
            is_reaction: true,
          },
        },
      )
      .catch(() => { /* não fatal */ });
  }

  // ─── Listar etiquetas da conversa ──────────────────────────────────────────

  async getLabels(accountId: number, conversationId: number): Promise<string[]> {
    const res = await this.client
      .get(`/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`)
      .catch(() => ({ data: { payload: [] } }));

    return (res.data?.payload as string[]) ?? [];
  }

  // ─── Adicionar etiqueta à conversa ─────────────────────────────────────────

  async addLabel(
    accountId: number,
    conversationId: number,
    label: string,
  ): Promise<void> {
    const existing = await this.getLabels(accountId, conversationId);
    const updated = [...new Set([...existing, label])];
    await this.client.post(
      `/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`,
      { labels: updated },
    );
  }

  // ─── Buscar histórico de mensagens ─────────────────────────────────────────

  async getConversationMessages(
    accountId: number,
    conversationId: number,
    limit = 50,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const res = await this.client
      .get(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
      )
      .catch(() => ({ data: { payload: [] } }));

    const messages: Array<{ message_type: number; content: string | null }> =
      res.data?.payload ?? [];

    return messages
      .filter((m) => m.content && m.content.trim() !== "")
      .slice(-limit)
      .map((m) => ({
        role: m.message_type === 0 ? "user" : "assistant",
        content: m.content!,
      }));
  }

  // ─── Download de arquivo (áudio) ───────────────────────────────────────────

  async downloadFile(url: string): Promise<Buffer> {
    const res = await this.client.get(url, { responseType: "arraybuffer" });
    return Buffer.from(res.data);
  }
}

export const chatwootService = new ChatwootService();
