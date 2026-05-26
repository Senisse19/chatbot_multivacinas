import { getSupabase } from "./supabase.client";

export async function upsertCliente(
  phone: string,
  name: string,
  source: string = "whatsapp"
): Promise<void> {
  if (!phone) return;
  try {
    const { error } = await getSupabase().from("clientes").upsert(
      {
        telefone: phone,
        nome: name,
        origem: source,
      },
      { onConflict: "telefone" }
    );
    if (error) {
      console.error("[Database] Erro ao salvar cliente:", error.message);
    }
  } catch (err) {
    console.error("[Database] Exceção ao salvar cliente:", err);
  }
}

export async function saveMessageHistory(
  phone: string,
  sessionId: string | number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  if (!phone) return;
  try {
    const { error } = await getSupabase().from("historico_mensagens").insert({
      telefone: phone,
      session_id: sessionId.toString(),
      message: { role, content },
    });
    if (error) {
      console.error("[Database] Erro ao salvar mensagem no histórico:", error.message);
    }
  } catch (err) {
    console.error("[Database] Exceção ao salvar mensagem no histórico:", err);
  }
}
