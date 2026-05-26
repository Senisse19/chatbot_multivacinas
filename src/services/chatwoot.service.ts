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

  // ─── Listar etiquetas da conversa ──────────────────────────────────────────

  async getLabels(accountId: number, conversationId: number): Promise<string[]> {
    const res = await this.client
      .get(`/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`)
      .catch(() => ({ data: { payload: [] } }));

    return (res.data?.payload as string[]) ?? [];
  }

  // ─── Adicionar etiqueta à conversa ─────────────────────────────────────────
  //
  // O endpoint /labels SUBSTITUI a lista inteira (não acrescenta). Fazemos
  // merge antes de enviar. Logamos o payload retornado para confirmar — se
  // o label estiver no payload mas não aparecer na UI, é o bug #12792 do
  // Chatwoot (labels via API não renderizam até a label estar cadastrada em
  // Settings → Labels da conta).

  async addLabel(
    accountId: number,
    conversationId: number,
    label: string,
  ): Promise<void> {
    const existing = await this.getLabels(accountId, conversationId);
    if (existing.includes(label)) {
      console.log(`[Chatwoot] addLabel(${label}) skip — já presente em ${conversationId}.`);
      return;
    }
    const updated = [...new Set([...existing, label])];
    try {
      const res = await this.client.post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`,
        { labels: updated },
      );
      const applied = (res.data?.payload as string[]) ?? [];
      console.log(
        `[Chatwoot] addLabel(${label}) → conv ${conversationId} | aplicadas: ${JSON.stringify(applied)}`,
      );
      if (!applied.includes(label)) {
        console.warn(
          `[Chatwoot] AVISO: label "${label}" NÃO foi aplicada pelo backend. ` +
          `Verifique se ela está cadastrada em Settings → Labels da conta ${accountId}.`,
        );
      }
    } catch (err: any) {
      console.error(
        `[Chatwoot] Falha ao adicionar label "${label}" na conversa ${conversationId}:`,
        err?.response?.data || err?.message,
      );
    }
  }

  // ─── Alterar status da conversa (open / resolved / pending / snoozed) ──────

  async toggleStatus(
    accountId: number,
    conversationId: number,
    status: "open" | "resolved" | "pending" | "snoozed",
  ): Promise<void> {
    await this.client
      .post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`,
        { status },
      )
      .catch((err) => {
        console.error(
          `[Chatwoot] Falha ao alterar status para ${status} na conversa ${conversationId}:`,
          err?.response?.data || err?.message,
        );
      });
  }

  // ─── Atributos adicionais do contato (usado para persistir BANT) ───────────

  async getContactAttributes(
    accountId: number,
    contactId: number,
  ): Promise<Record<string, unknown>> {
    const res = await this.client
      .get(`/api/v1/accounts/${accountId}/contacts/${contactId}`)
      .catch(() => null);
    const data = res?.data?.payload ?? res?.data ?? {};
    return (data.additional_attributes as Record<string, unknown>) ?? {};
  }

  async updateContactAttributes(
    accountId: number,
    contactId: number,
    attrs: Record<string, unknown>,
  ): Promise<void> {
    // Merge com atributos existentes para não sobrescrever campos não tocados
    const existing = await this.getContactAttributes(accountId, contactId);
    const merged = { ...existing, ...attrs };

    await this.client
      .patch(`/api/v1/accounts/${accountId}/contacts/${contactId}`, {
        additional_attributes: merged,
      })
      .catch((err) => {
        console.error(
          `[Chatwoot] Falha ao atualizar atributos do contato ${contactId}:`,
          err?.response?.data || err?.message,
        );
      });
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

    const messages: Array<{
      message_type: number;
      content: string | null;
      private?: boolean;
    }> = res.data?.payload ?? [];

    // Considera apenas conversa real: incoming (0) do usuário e outgoing (1) público.
    // Exclui activity (2), template (3) e notas privadas — eles inflavam o histórico
    // e faziam firstContact virar false mesmo sem a Ana ter falado.
    return messages
      .filter(
        (m) =>
          m.content &&
          m.content.trim() !== "" &&
          (m.message_type === 0 || m.message_type === 1) &&
          !m.private,
      )
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
