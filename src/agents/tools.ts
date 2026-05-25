import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { searchDocuments } from "../services/rag.service";
import type { RagResult } from "../services/rag.service";
import { sendEscalationAlert } from "../services/telegram.service";
import { chatwootService } from "../services/chatwoot.service";

// ─── Definição das ferramentas (OpenAI Function Calling) ──────────────────────

export const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_documentos",
      description:
        "Consulta a base de conhecimento interna da MultiVacinas (bulas, calendários, protocolos e informações de serviços). " +
        "OBRIGATÓRIA antes de qualquer afirmação factual sobre vacinas, preços, disponibilidade ou procedimentos. " +
        "REGRAS DE USO: (1) Se a ferramenta retornar conteúdo, copie o texto original SEM ALTERAR NADA — não resuma, não interprete, não combine trechos diferentes. " +
        "(2) Se retornar VAZIO ou 'BASE_VAZIA', NÃO invente. Escale para humano imediatamente. " +
        "(3) Use queries técnicas e específicas — não queries conversacionais. " +
        "(4) Se a primeira busca vier incompleta, chame novamente com uma query diferente antes de desistir.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Termos técnicos de busca. Prefira nomenclatura de bula: nome da vacina, patógeno alvo, faixa etária, indicação, contraindicação, dose, intervalo. " +
              "CORRETO: 'vacina HPV Gardasil 9 esquema doses adolescentes' | ERRADO: 'vocês têm HPV?'",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refletir",
      description:
        "Permite raciocinar internamente antes de responder. Use quando a pergunta tiver múltiplas partes, houver ambiguidade, contradição com turnos anteriores ou indício de risco clínico. O resultado não é enviado ao usuário.",
      parameters: {
        type: "object",
        properties: {
          pensamento: {
            type: "string",
            description: "Seu raciocínio interno sobre como proceder.",
          },
        },
        required: ["pensamento"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reagir_mensagem",
      description:
        "Envia uma reação de emoji à última mensagem do usuário. Use com parcimônia (ex: agradecimento final). Nunca em mensagens com conteúdo clínico.",
      parameters: {
        type: "object",
        properties: {
          emoji: {
            type: "string",
            description: "O emoji de reação. Ex: 👍, ❤️, 😊",
          },
        },
        required: ["emoji"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_humano",
      description:
        "Transfere o atendimento para um humano. Chame esta ferramenta após enviar a mensagem de transição ao usuário. Preencha o resumo com tudo que foi coletado no BANT.",
      parameters: {
        type: "object",
        properties: {
          nome: {
            type: "string",
            description: "Nome do cliente conforme apareceu na conversa.",
          },
          resumo_bant: {
            type: "string",
            description:
              "Resumo do que foi coletado no BANT: necessidade, prazo, autoridade e modalidade de pagamento. Deixe vazio se o handover foi por risco clínico ou base vazia.",
          },
          motivo: {
            type: "string",
            enum: [
              "interesse_agendamento",
              "cotacao_corporativa",
              "risco_clinico",
              "base_vazia",
              "usuario_solicitou",
              "falha_tecnica",
              "off_topic_persistente",
            ],
            description: "Motivo do handover para o log.",
          },
        },
        required: ["nome", "motivo"],
      },
    },
  },
];

// ─── Execução das ferramentas ─────────────────────────────────────────────────

export interface ToolContext {
  phone: string;
  name: string;
  lastMessage: string;
  accountId: number;
  conversationId: number;
  messageId: number;
  telegramChatId: string;  // chat_id do grupo Telegram desta unidade
  unitName: string;        // nome da unidade para o alerta
}

export interface ToolResult {
  output: string;
  escalated?: boolean;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case "buscar_documentos": {
      const query = args.query as string;
      console.log(`[Tool] buscar_documentos → "${query}"`);
      const result: RagResult = await searchDocuments(query);

      if (!result.found) {
        // Sinalização explícita para o agente NÃO inventar
        return {
          output:
            "BASE_VAZIA: A consulta '" + query + "' não retornou nenhum documento relevante na base de conhecimento. " +
            "NÃO afirme nada sobre este tema. Se o usuário precisar desta informação, escale para humano com motivo=base_vazia.",
        };
      }

      return {
        output:
          "BASE_ENCONTRADA: Os seguintes trechos foram encontrados na base de conhecimento. " +
          "Copie o conteúdo relevante sem alterar nada:\n\n" +
          result.content,
      };
    }

    case "refletir": {
      console.log(`[Tool] refletir → ${args.pensamento}`);
      return { output: "Reflexão registrada." };
    }

    case "reagir_mensagem": {
      const emoji = args.emoji as string;
      console.log(`[Tool] reagir_mensagem → ${emoji}`);
      await chatwootService.sendReaction(
        ctx.accountId,
        ctx.conversationId,
        ctx.messageId,
        emoji,
      );
      return { output: "Reação enviada." };
    }

    case "escalar_humano": {
      const nome = (args.nome as string) || ctx.name;
      const resumo = (args.resumo_bant as string) || "";
      const motivo = args.motivo as string;

      console.log(`[Tool] escalar_humano → motivo: ${motivo}, nome: ${nome}, unidade: ${ctx.unitName}`);

      await sendEscalationAlert({
        phone: ctx.phone,
        name: nome,
        lastMessage: ctx.lastMessage,
        conversationId: ctx.conversationId,
        summary: resumo || undefined,
        telegramChatId: ctx.telegramChatId,
        unitName: ctx.unitName,
      });

      // Adicionar etiqueta agente-off no Chatwoot
      await chatwootService.addLabel(ctx.accountId, ctx.conversationId, "agente-off");

      return { output: "Humano escalado com sucesso.", escalated: true };
    }

    default:
      return { output: `Ferramenta desconhecida: ${name}` };
  }
}

// ─── Verificar se a conversa já foi escalada ──────────────────────────────────

export function isEscalated(labels: string[]): boolean {
  return labels.includes("agente-off");
}
