// ─── Payload do Webhook do Chatwoot ──────────────────────────────────────────

export interface ChatwootSender {
  id: number;
  name: string;
  phone_number: string | null;
  email: string | null;
  identifier: string;
  type: "contact" | "user";
  thumbnail?: string;
  blocked?: boolean;
}

export interface ChatwootMessage {
  id: number;
  content: string | null;
  account_id: number;
  inbox_id: number;
  conversation_id: number;
  message_type: number; // 0 = incoming, 1 = outgoing
  created_at: number;
  updated_at: string;
  private: boolean;
  status: string;
  content_type: string;
  content_attributes: Record<string, unknown>;
  sender_type: "Contact" | "User";
  sender_id: number;
  sender: ChatwootSender;
  additional_attributes: Record<string, unknown>;
}

export interface ChatwootAttachment {
  id: number;
  message_id: number;
  file_type: string;
  account_id: number;
  extension: string | null;
  data_url: string;
  thumb_url: string;
  file_size: number;
  width: number | null;
  height: number | null;
  meta: {
    is_recorded_audio?: boolean;
    content_type?: string;
  };
}

export interface ChatwootConversation {
  id: number;
  account_id: number;
  inbox_id: number;
  status: "open" | "resolved" | "pending" | "snoozed";
  labels: string[];
  messages: ChatwootMessage[];
  channel: string;
  unread_count: number;
  created_at: number;
  last_activity_at: number;
}

export interface ChatwootWebhookPayload {
  event: "message_created" | "message_updated" | "conversation_created" | string;
  message_type: "incoming" | "outgoing" | "activity";
  id: number;
  content: string | null;
  account: { id: number; name: string };
  conversation: ChatwootConversation;
  sender: ChatwootSender;
  inbox: { id: number; name: string };
  created_at: string;
  attachments?: ChatwootAttachment[];
  private: boolean;
}

import type { UnitConfig } from "../config/units";

// ─── Contexto normalizado para o agente ──────────────────────────────────────

export interface MessageContext {
  messageId: number;
  accountId: number;
  conversationId: number;
  inboxId: number;
  phone: string;
  name: string;
  content: string; // texto ou transcrição do áudio
  isAudio: boolean;
  labels: string[];
  unit: UnitConfig; // unidade MultiVacinas que recebeu a mensagem
}

// ─── Histórico de mensagens para a OpenAI ────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
