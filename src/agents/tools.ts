import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { searchDocuments } from "../services/rag.service";
import type { RagResult, RagFilters } from "../services/rag.service";
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
        "REGRAS DE USO: (1) A resposta vem com um de três status. BASE_ENCONTRADA: copie o texto sem alterar. " +
        "BASE_FRACA: a evidência é correlata mas não conclusiva — use com cautela, ofereça transferir para atendente. " +
        "BASE_VAZIA: NÃO invente, escale para humano. " +
        "(2) Use queries técnicas e específicas — não queries conversacionais. " +
        "(3) Se já souber faixa etária ou tipo do conteúdo, passe os filtros para reduzir ruído. " +
        "(4) Se a primeira busca vier incompleta, chame novamente com query diferente antes de desistir.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Termos técnicos de busca. Prefira nomenclatura de bula: nome da vacina, patógeno alvo, faixa etária, indicação, contraindicação, dose, intervalo. " +
              "CORRETO: 'vacina HPV Gardasil 9 esquema doses adolescentes' | ERRADO: 'vocês têm HPV?'",
          },
          pensamento: {
            type: "string",
            description:
              "OPCIONAL. Raciocínio interno antes de buscar (não vai ao usuário). Use quando a pergunta tiver múltiplas partes ou ambiguidade.",
          },
          filtros: {
            type: "object",
            description: "OPCIONAL. Filtros de metadados para restringir o universo de busca.",
            properties: {
              faixa_etaria: {
                type: "string",
                enum: ["crianca", "adolescente", "adulto", "idoso", "gestante", "todos"],
              },
              tipo: {
                type: "string",
                enum: ["bula", "calendario"],
              },
              vacina: {
                type: "string",
                description: "Slug da vacina, ex.: 'gardasil_9', 'shingrix'.",
              },
            },
          },
        },
        required: ["query"],
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
      name: "registrar_bant",
      description:
        "Persiste no Chatwoot (additional_attributes do contato) os campos do BANT que você coletou. " +
        "Chame conforme a coleta progride. Envie APENAS os campos efetivamente coletados — não invente. " +
        "Use rótulos curtos e diretos.",
      parameters: {
        type: "object",
        properties: {
          need: {
            type: "string",
            description: "Vacina/serviço e para quem (ex.: 'HPV Gardasil 9 para filha de 14 anos').",
          },
          timeline: {
            type: "string",
            description: "Prazo (ex.: 'esta semana', 'mês que vem', 'sem pressa').",
          },
          authority: {
            type: "string",
            description: "Quem decide (ex.: 'própria', 'mãe da paciente').",
          },
          budget: {
            type: "string",
            description: "Modalidade de pagamento (ex.: 'particular', 'corporativo CNPJ').",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "encerrar_conversa",
      description:
        "Marca a conversa como resolvida no Chatwoot após a despedida final do usuário. " +
        "Chame APÓS enviar a mensagem de encerramento do fluxo. Não chame se o usuário ainda pode voltar a perguntar.",
      parameters: {
        type: "object",
        properties: {},
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
  contactId: number;       // id do contato (para BANT em additional_attributes)
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
      const filtros = (args.filtros as RagFilters) ?? {};
      const pensamento = args.pensamento as string | undefined;

      if (pensamento) {
        console.log(`[Tool] buscar_documentos pensamento → ${pensamento}`);
      }
      console.log(
        `[Tool] buscar_documentos → "${query}"${Object.keys(filtros).length ? ` filtros=${JSON.stringify(filtros)}` : ""}`,
      );

      const result: RagResult = await searchDocuments(query, filtros, {
        conversationId: ctx.conversationId,
      });

      switch (result.status) {
        case "strong":
          return {
            output:
              `BASE_ENCONTRADA (score=${result.topScore.toFixed(2)}): trechos relevantes encontrados. ` +
              "Copie o conteúdo sem alterar nada, sem combinar trechos:\n\n" +
              result.content,
          };
        case "weak":
          return {
            output:
              `BASE_FRACA (score=${result.topScore.toFixed(2)}): existe conteúdo correlato mas NÃO conclusivo. ` +
              "Você pode mencionar o que está claro no trecho, mas DEVE oferecer transferir para atendente humano para confirmação. " +
              "NÃO afirme nada que não esteja literalmente no texto:\n\n" +
              result.content,
          };
        case "empty":
        default:
          return {
            output:
              `BASE_VAZIA: A consulta "${query}" não retornou conteúdo relevante (topScore=${result.topScore.toFixed(2)}). ` +
              "NÃO afirme nada sobre este tema. Se o usuário precisar desta informação, escale para humano com motivo=base_vazia.",
          };
      }
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

    case "registrar_bant": {
      const bantFields: Record<string, string> = {};
      for (const key of ["need", "timeline", "authority", "budget"] as const) {
        const v = args[key];
        if (typeof v === "string" && v.trim()) {
          bantFields[key] = v.trim();
        }
      }
      if (Object.keys(bantFields).length === 0) {
        return { output: "Nenhum campo BANT fornecido — nada a persistir." };
      }

      if (!ctx.contactId) {
        console.warn("[Tool] registrar_bant sem contactId, pulando.");
        return { output: "Sem contactId disponível, BANT não persistido." };
      }

      console.log(
        `[Tool] registrar_bant → contato ${ctx.contactId}: ${JSON.stringify(bantFields)}`,
      );

      // Lê BANT existente para preservar campos prévios e mescla
      const existing = await chatwootService.getContactAttributes(
        ctx.accountId,
        ctx.contactId,
      );
      const existingBant = (existing.bant as Record<string, string>) ?? {};
      const mergedBant = { ...existingBant, ...bantFields };

      await chatwootService.updateContactAttributes(ctx.accountId, ctx.contactId, {
        bant: mergedBant,
      });

      return { output: `BANT persistido: ${JSON.stringify(mergedBant)}` };
    }

    case "encerrar_conversa": {
      console.log(`[Tool] encerrar_conversa → conv ${ctx.conversationId}`);
      await chatwootService.addLabel(ctx.accountId, ctx.conversationId, "resolvido");
      await chatwootService.toggleStatus(ctx.accountId, ctx.conversationId, "resolved");
      // Marca como escalada para que o webhook ignore mensagens subsequentes
      // até o atendente reabrir manualmente.
      return { output: "Conversa encerrada.", escalated: true };
    }

    case "escalar_humano": {
      const nome = (args.nome as string) || ctx.name;
      let resumo = (args.resumo_bant as string) || "";
      const motivo = args.motivo as string;

      // Dedup: se a conversa já está como agente-off, não duplica Telegram nem label.
      const existingLabels = await chatwootService.getLabels(
        ctx.accountId,
        ctx.conversationId,
      );
      if (existingLabels.includes("agente-off")) {
        console.log(
          `[Tool] escalar_humano → conversa ${ctx.conversationId} já escalada, ignorando duplicação.`,
        );
        return { output: "Conversa já escalada anteriormente.", escalated: true };
      }

      // Se o modelo não passou resumo, usar BANT persistido (Fase 4.1)
      if (!resumo && ctx.contactId) {
        try {
          const attrs = await chatwootService.getContactAttributes(
            ctx.accountId,
            ctx.contactId,
          );
          const bant = attrs.bant as Record<string, string> | undefined;
          if (bant && Object.keys(bant).length > 0) {
            resumo = Object.entries(bant)
              .filter(([, v]) => typeof v === "string" && v.trim())
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ");
          }
        } catch (err) {
          console.warn("[Tool] escalar_humano: falha ao ler BANT salvo:", err);
        }
      }

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
