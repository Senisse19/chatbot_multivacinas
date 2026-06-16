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
        "BASE_FRACA: a evidência é correlata mas não conclusiva. Use com cautela e não invente. " +
        "BASE_VAZIA: NÃO invente. Reformule a busca antes de desistir. " +
        "(2) Use queries técnicas e específicas. Não use queries conversacionais. " +
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
                enum: ["bula", "calendario", "contraindicacoes"],
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
      name: "registrar_bant",
      description:
        "Persiste no Chatwoot (additional_attributes do contato) os campos do BANT que você coletou. " +
        "Chame conforme a coleta progride. Envie APENAS os campos efetivamente coletados. Não invente. " +
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
        "Transfere o atendimento para um humano. CHAME APENAS quando UMA destas condições for verdade: " +
        "(1) o usuário DECLAROU intenção concreta de agendar/comprar/aplicar/cotar; " +
        "(2) risco clínico identificado; " +
        "(3) o usuário pediu EXPLICITAMENTE atendente/humano/pessoa; " +
        "(4) cotação corporativa. " +
        "NÃO chame por BASE_VAZIA ou BASE_FRACA. Você deve reformular a query e, se continuar sem base, responder o geral disponível sem transferir. " +
        "NÃO chame por dúvida sobre preço/disponibilidade sem intenção declarada de fechar. " +
        "NÃO chame por hesitação sua. " +
        "Sempre envie a mensagem de transição ao usuário antes de chamar.",
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
              "Resumo do que foi coletado no BANT. Opcional. Se você já chamou registrar_bant, o sistema usa o BANT salvo automaticamente. Deixe vazio em risco clínico.",
          },
          motivo: {
            type: "string",
            enum: [
              "interesse_agendamento",      // usuário declarou que quer agendar/comprar/aplicar
              "cotacao_corporativa",         // empresa, CNPJ, grupo
              "risco_clinico",               // condição clínica + dúvida sobre vacina
              "usuario_solicitou",           // usuário pediu atendente/humano/pessoa
              "falha_tecnica",               // erro reiterado em ferramenta
              "off_topic_persistente",       // off-topic após advertência
            ],
            description:
              "Motivo do handover. Falta de informação na base não é motivo de handover; use usuario_solicitou apenas quando o usuário pedir uma pessoa/atendente.",
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
              "Você pode mencionar o que está claro no trecho, mas deve seguir a conversa sem transferir só por isso. " +
              "NÃO afirme nada que não esteja literalmente no texto:\n\n" +
              result.content,
          };
        case "empty":
        default:
          return {
            output:
              `BASE_VAZIA: A consulta "${query}" não retornou conteúdo relevante (topScore=${result.topScore.toFixed(2)}). ` +
              "NÃO afirme detalhe técnico sem base. Reformule a busca uma vez com nome comercial, doença, componente e termos de bula. " +
              "Se ainda falhar e a vacina estiver no catálogo, confirme apenas a oferta/tema geral disponível e diga que não consegue confirmar esse detalhe com segurança por aqui. " +
              "Não transfira por falta de base; só escale se o usuário pedir explicitamente uma pessoa agora, usando motivo=usuario_solicitou.",
          };
      }
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
        return { output: "Nenhum campo BANT fornecido. Nada a persistir." };
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

      // Dedup: se a conversa já tem agente-off OU já não está open, não duplica.
      const existingLabels = await chatwootService.getLabels(
        ctx.accountId,
        ctx.conversationId,
      );
      if (existingLabels.includes("agente-off")) {
        console.log(
          `[Tool] escalar_humano → conversa ${ctx.conversationId} já escalada (label), ignorando duplicação.`,
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

      // Tag (para histórico/filtros) + mudança de status para `pending`.
      // O status é o gating real. Labels podem não aparecer na UI por bug do
      // Chatwoot (#12792), mas `pending` é nativo e reversível pelo botão
      // "Reabrir". Veja Fase 6.1 no plano de implementação.
      await chatwootService.addLabel(ctx.accountId, ctx.conversationId, "agente-off");
      await chatwootService.toggleStatus(ctx.accountId, ctx.conversationId, "pending");

      return { output: "Humano escalado com sucesso.", escalated: true };
    }

    default:
      return { output: `Ferramenta desconhecida: ${name}` };
  }
}

// ─── Verificar se a conversa já foi escalada ──────────────────────────────────
//
// Considera escalada se:
//   - tem a label `agente-off`; OU
//   - tem a label `resolvido`; OU
//   - o status é diferente de `open` (pending/resolved/snoozed), mecanismo
//     nativo do Chatwoot, reversível pelo botão "Reabrir".
//
// Essa abordagem dupla protege contra o bug #12792 do Chatwoot (labels não
// aparecem na UI), garantindo que pelo menos o status seja o ponto de
// reabertura visível para o atendente.

export function isEscalated(labels: string[], status?: string): boolean {
  if (labels.includes("agente-off") || labels.includes("resolvido")) return true;
  if (status && status !== "open") return true;
  return false;
}
