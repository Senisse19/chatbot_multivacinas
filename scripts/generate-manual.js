#!/usr/bin/env node
/**
 * Gera o Manual_Atendimento_MultiVacinas.pdf na raiz do projeto.
 * Execute: node scripts/generate-manual.js
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ─── Paleta de cores ──────────────────────────────────────────────────────────

const C = {
  blue:        '#1B4F8A',
  blueLight:   '#EBF3FB',
  orange:      '#E67E22',
  orangeLight: '#FEF9E7',
  green:       '#27AE60',
  greenLight:  '#EAFAF1',
  red:         '#C0392B',
  redLight:    '#FDEDEC',
  dark:        '#2C3E50',
  gray:        '#7F8C8D',
  grayLight:   '#F4F6F7',
  white:       '#FFFFFF',
};

// ─── Métricas de página ───────────────────────────────────────────────────────

const PAGE_W  = 595.28;   // A4
const PAGE_H  = 841.89;
const ML      = 65;       // margem esquerda
const MR      = 65;       // margem direita
const CW      = PAGE_W - ML - MR;  // largura do conteúdo: 465.28

// ─── Documento ───────────────────────────────────────────────────────────────

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: ML, bottom: 72, left: ML, right: MR },
  bufferPages: true,
  info: {
    Title:   'Manual do Usuário – Sistema de Atendimento MultiVacinas',
    Author:  'MultiVacinas',
    Subject: 'Guia de uso do Chatwoot e da assistente virtual',
  },
});

const outFile = path.join(process.cwd(), 'Manual_Atendimento_MultiVacinas.pdf');
const stream  = fs.createWriteStream(outFile);
doc.pipe(stream);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function needSpace(px = 120) {
  if (doc.y > PAGE_H - doc.page.margins.bottom - px) doc.addPage();
}

function rule(color = '#D0D3D4', w = 0.5) {
  const y = doc.y;
  doc.save()
     .moveTo(ML, y).lineTo(PAGE_W - MR, y)
     .strokeColor(color).lineWidth(w).stroke()
     .restore();
  doc.moveDown(0.4);
}

function h1(text) {
  needSpace(90);
  doc.moveDown(0.7)
     .font('Helvetica-Bold').fontSize(17).fill(C.blue)
     .text(text, ML, doc.y, { width: CW });
  rule(C.blue, 1.5);
  doc.fill(C.dark);
}

function h2(text) {
  needSpace(60);
  doc.moveDown(0.5)
     .font('Helvetica-Bold').fontSize(12).fill(C.blue)
     .text(text, ML, doc.y, { width: CW })
     .moveDown(0.2);
  doc.fill(C.dark);
}

function p(text) {
  doc.font('Helvetica').fontSize(10.5).fill(C.dark)
     .text(text, ML, doc.y, { width: CW, lineGap: 4 })
     .moveDown(0.35);
}

function li(text, symbol = '•') {
  const indent = 16;
  doc.font('Helvetica').fontSize(10.5).fill(C.dark)
     .text(symbol + '  ' + text, ML + indent, doc.y, {
       width: CW - indent, lineGap: 4,
     })
     .moveDown(0.2);
}

function colorBox(text, bgColor, accentColor, bold = false) {
  needSpace(70);
  const textX  = ML + 14;
  const textW  = CW - 28;
  const startY = doc.y;
  const font   = bold ? 'Helvetica-Bold' : 'Helvetica';

  doc.font(font).fontSize(10.5);
  const textH = doc.heightOfString(text, { width: textW, lineGap: 4 });
  const boxH  = textH + 18;

  doc.save()
     .rect(ML, startY, CW, boxH).fill(bgColor)
     .rect(ML, startY, 4, boxH).fill(accentColor)
     .restore();

  doc.font(font).fontSize(10.5).fill(C.dark)
     .text(text, textX, startY + 9, { width: textW, lineGap: 4 });

  // avança cursor manualmente até além do box
  const afterY = startY + boxH + 10;
  if (doc.y < afterY) doc.text('', ML, afterY, { lineBreak: false });
  doc.moveDown(0.2);
}

function warnBox(text) {
  colorBox('⚠   ' + text, C.orangeLight, C.orange);
}

function infoBox(text) {
  colorBox('ℹ   ' + text, C.blueLight, C.blue);
}

function cardBox(title, body) {
  needSpace(100);
  const textX  = ML + 14;
  const textW  = CW - 28;
  const startY = doc.y;

  doc.font('Helvetica-Bold').fontSize(11);
  const titleH = doc.heightOfString(title, { width: textW });
  doc.font('Helvetica').fontSize(10.5);
  const bodyH  = doc.heightOfString(body, { width: textW, lineGap: 4 });
  const boxH   = titleH + bodyH + 24;

  doc.save()
     .rect(ML, startY, CW, boxH).fill(C.blueLight)
     .rect(ML, startY, 4, boxH).fill(C.blue)
     .restore();

  doc.font('Helvetica-Bold').fontSize(11).fill(C.blue)
     .text(title, textX, startY + 9, { width: textW });

  doc.font('Helvetica').fontSize(10.5).fill(C.dark)
     .text(body, textX, doc.y + 3, { width: textW, lineGap: 4 });

  const afterY = startY + boxH + 12;
  if (doc.y < afterY) doc.text('', ML, afterY, { lineBreak: false });
  doc.moveDown(0.1);
}

function step(num, title, body) {
  needSpace(75);
  const startY = doc.y;
  const circR  = 11;
  const cx     = ML + circR;
  const cy     = startY + circR + 2;

  doc.save().circle(cx, cy, circR).fill(C.blue).restore();

  doc.fill(C.white).font('Helvetica-Bold').fontSize(11)
     .text(String(num), ML, startY + 5, { width: circR * 2, align: 'center' });

  const textX = ML + circR * 2 + 10;
  const textW = CW - circR * 2 - 10;

  doc.fill(C.dark).font('Helvetica-Bold').fontSize(10.5)
     .text(title, textX, startY + 2, { width: textW });

  if (body) {
    doc.font('Helvetica').fontSize(10.5).fill(C.dark)
       .text(body, textX, doc.y + 2, { width: textW, lineGap: 4 });
  }
  doc.moveDown(0.6);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPA
// ─────────────────────────────────────────────────────────────────────────────

// Faixa azul
doc.save().rect(0, 0, PAGE_W, 205).fill(C.blue).restore();

doc.fill(C.white).font('Helvetica-Bold').fontSize(10)
   .text('MULTIVACINAS', ML, 52, { characterSpacing: 2.5 });

doc.font('Helvetica-Bold').fontSize(33)
   .text('Manual do Usuário', ML, 82);

doc.font('Helvetica').fontSize(14).fill('#AED6F1')
   .text('Guia completo para a equipe de atendimento', ML, 133);

doc.font('Helvetica').fontSize(10).fill('#85C1E9')
   .text('Versão 1.0  •  Maio de 2026', ML, 168);

// Índice da capa
doc.fill(C.dark).font('Helvetica-Bold').fontSize(13)
   .text('O que você encontra neste guia', ML, 245);

const topics = [
  'Como funciona o sistema de atendimento',
  'Como usar o Chatwoot (sua central de atendimento)',
  'Como funciona a assistente virtual Maria Antônia',
  'Quando e como intervir nas conversas',
  'Como reativar a assistente quando necessário',
  'Perguntas frequentes da equipe',
];
doc.moveDown(0.5);
for (const t of topics) li(t, '✔');

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA 2 — VISÃO GERAL + CHATWOOT
// ─────────────────────────────────────────────────────────────────────────────

doc.addPage();
h1('1. Visão Geral do Sistema');

p('O sistema de atendimento da MultiVacinas une duas ferramentas que trabalham juntas para oferecer agilidade e qualidade no atendimento dos clientes pelo WhatsApp.');

cardBox(
  'Chatwoot — Sua Central de Atendimento',
  'É a plataforma que você usa no computador ou celular para ver todas as conversas do WhatsApp, responder mensagens e acompanhar os atendimentos em tempo real. Funciona como uma caixa de entrada unificada para toda a equipe.'
);
cardBox(
  'Maria Antônia — Assistente Virtual',
  'É o robô de atendimento que responde automaticamente pelo WhatsApp. Ela tira dúvidas sobre vacinas, apresenta os serviços da clínica e, quando o cliente quer agendar, avisa a equipe para finalizar.'
);

p('Como o atendimento funciona na prática:');
li('O cliente manda uma mensagem no WhatsApp da clínica.');
li('A Maria Antônia responde automaticamente, tira dúvidas e identifica o interesse.');
li('Quando o cliente quer agendar, a Maria Antônia avisa a equipe e passa o atendimento.');
li('O atendente assume a conversa no Chatwoot e finaliza com o cliente.');

// ─── Seção 2 ─────────────────────────────────────────────────────────────────

h1('2. O Chatwoot — Sua Central de Atendimento');

h2('2.1 Como acessar');
p('Acesse pelo navegador (Chrome, Edge ou Safari) ou pelo aplicativo no celular. Faça login com o seu e-mail e senha cadastrados.');

h2('2.2 A caixa de entrada');
p('Na tela principal você vê todas as conversas do WhatsApp organizadas por data. Cada linha é um cliente diferente. O status de cada conversa indica em que etapa está:');

li('Aberta — Conversa em andamento. A assistente ou um atendente está respondendo.');
li('Pendente — Aguardando atendimento humano.');
li('Resolvida — Conversa encerrada. Fica salva no histórico para consulta futura.');

doc.moveDown(0.3);
h2('2.3 Etiquetas (marcadores)');
p('As etiquetas aparecem ao lado do nome do cliente e ajudam a identificar o status rapidamente:');
li('agente-off — A assistente virtual está DESLIGADA nessa conversa. O atendimento é humano.');
doc.moveDown(0.2);
warnBox('Enquanto a etiqueta agente-off estiver na conversa, a Maria Antônia não responde. O cliente precisa de atendimento da equipe.');

h2('2.4 Como responder a um cliente');
p('Clique na conversa, leia o histórico e escreva sua resposta na caixa de texto na parte inferior da tela. Pressione Enter ou clique em Enviar.');

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA 3 — MARIA ANTÔNIA
// ─────────────────────────────────────────────────────────────────────────────

doc.addPage();
h1('3. A Maria Antônia — Assistente Virtual');

h2('3.1 O que ela faz');
p('A Maria Antônia é a primeira a responder quando um cliente manda mensagem no WhatsApp. Ela foi treinada especificamente para atender clientes da MultiVacinas:');

li('Responde dúvidas sobre vacinas: quais a clínica oferece, indicações gerais, para quem é cada uma.', '✔');
li('Informa endereço, horários e telefone das unidades da rede.', '✔');
li('Apresenta opções de vacinas por perfil: idoso, bebê, gestante, viagem, empresa.', '✔');
li('Indica o site da clínica (multivacinas.com.br) quando o cliente perguntar.', '✔');
li('Identifica clientes com intenção de agendar e chama um atendente.', '✔');

doc.moveDown(0.3);
h2('3.2 O que ela NÃO faz');
p('A Maria Antônia tem limites claros para garantir a segurança e qualidade do atendimento:');
li('Não confirma preços — informa que o atendente confirma o valor na hora do agendamento.');
li('Não realiza agendamentos — encaminha sempre para o atendente humano.');
li('Não prescreve nem recomenda vacinas em casos clínicos específicos.');
li('Não confirma disponibilidade de estoque do dia.');

doc.moveDown(0.3);
h2('3.3 Quando ela chama um atendente');
p('A Maria Antônia passa o atendimento para a equipe ao identificar um destes momentos:');
li('Intenção de agendar ou comprar: "quero marcar", "vou passar aí", "quanto custa para fechar".');
li('Cliente pede explicitamente para falar com uma pessoa ou atendente.');
li('Cotação para empresa ou grupo (campanha corporativa).');
li('Situação de risco clínico: reação adversa, gestante, imunossuprimido, bebê com sintoma agudo.');
doc.moveDown(0.2);
infoBox('Quando isso acontece, a Maria Antônia avisa o cliente e a equipe recebe um alerta automático no celular.');

doc.moveDown(0.2);
h2('3.4 Quando ela para de responder automaticamente');
li('Após chamar um atendente — a conversa recebe a etiqueta agente-off e passa para a equipe.');
li('Após falha técnica — ela avisa o cliente e chama o atendente automaticamente.');

doc.moveDown(0.2);
warnBox('Enquanto a Maria Antônia está respondendo, evite enviar mensagens pela sua conta na mesma conversa. Isso pode confundir o cliente, pois as mensagens chegam em sequência sem distinção visual no WhatsApp.');

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA 4 — REATIVAR
// ─────────────────────────────────────────────────────────────────────────────

doc.addPage();
h1('4. Como Reativar a Assistente em uma Conversa');

p('Em alguns momentos você precisará reativar a Maria Antônia — por exemplo, quando o atendente finalizou o atendimento e o cliente voltou com uma nova dúvida.');

h2('Como identificar se a assistente está ativa ou não');

needSpace(85);
const bY   = doc.y;
const halfW = (CW / 2) - 6;

// Box verde: ativa
doc.save().rect(ML, bY, halfW, 62).fill(C.greenLight).restore();
doc.fill(C.green).font('Helvetica-Bold').fontSize(10)
   .text('✔  ASSISTENTE ATIVA', ML + 10, bY + 11);
doc.fill(C.dark).font('Helvetica').fontSize(10)
   .text('• Sem etiqueta agente-off\n• Conversa com status Aberta', ML + 10, bY + 30, { width: halfW - 18, lineGap: 3 });

// Box vermelho: desligada
const bX2 = ML + halfW + 12;
doc.save().rect(bX2, bY, halfW, 62).fill(C.redLight).restore();
doc.fill(C.red).font('Helvetica-Bold').fontSize(10)
   .text('✘  ASSISTENTE DESLIGADA', bX2 + 10, bY + 11);
doc.fill(C.dark).font('Helvetica').fontSize(10)
   .text('• Etiqueta agente-off presente', bX2 + 10, bY + 30, { width: halfW - 18, lineGap: 3 });

// Avança o cursor além dos dois boxes
doc.text('', ML, bY + 75, { lineBreak: false });
doc.moveDown(0.4);

h2('Passo a passo para reativar');

step(1, 'Abra a conversa no Chatwoot',
  'Clique no nome do cliente na caixa de entrada.');

step(2, 'Remova a etiqueta agente-off',
  'No painel à direita, localize a seção "Etiquetas" e clique no X ao lado de agente-off para removê-la.');

step(3, 'Reabra a conversa (se necessário)',
  'Se o status da conversa estiver como "Resolvida", clique no botão Reabrir no canto superior direito da tela.');

step(4, 'Aguarde a próxima mensagem do cliente',
  'Na próxima mensagem que o cliente enviar, a Maria Antônia volta a responder automaticamente.');

warnBox('A Maria Antônia só retoma o atendimento quando o cliente mandar uma nova mensagem. Se quiser que ela responda imediatamente, peça ao cliente para mandar qualquer mensagem — um simples "oi" já resolve.');

doc.moveDown(0.3);
h2('Como desligar a assistente manualmente');
p('Se precisar assumir um atendimento antes do cliente pedir:');
li('Abra a conversa no Chatwoot.');
li('No painel à direita, clique em Etiquetas e adicione agente-off.');
li('A partir daí, responda você mesmo — a Maria Antônia não vai mais interferir nessa conversa.');

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA 5 — PERGUNTAS FREQUENTES
// ─────────────────────────────────────────────────────────────────────────────

doc.addPage();
h1('5. Perguntas Frequentes');

const faqs = [
  [
    'O cliente mandou mensagem e a assistente não respondeu. O que fazer?',
    'Verifique se a conversa tem a etiqueta agente-off ou se está com status Resolvida. Se sim, siga o passo a passo da seção 4 para reativar. Se não houver nenhuma dessas condições, aguarde alguns segundos — a assistente pode estar digitando a resposta.',
  ],
  [
    'A assistente respondeu algo incorreto. O que fazer?',
    'Adicione a etiqueta agente-off manualmente, escreva a resposta correta para o cliente e continue o atendimento você mesmo. Tire um print da mensagem incorreta e repasse para a equipe técnica para que possamos ajustar o sistema.',
  ],
  [
    'O cliente quer agendar mas a assistente não chamou o atendente.',
    'Isso acontece quando o cliente não usa palavras que a assistente reconhece como intenção de agendamento (ex.: "quero marcar", "vou passar aí", "quanto custa para fechar"). Nesse caso, adicione a etiqueta agente-off manualmente e assuma o atendimento.',
  ],
  [
    'Posso usar o Chatwoot pelo celular?',
    'Sim! O Chatwoot tem aplicativo gratuito para Android e iOS disponível nas lojas de aplicativos. O funcionamento é idêntico ao do computador.',
  ],
  [
    'O histórico das conversas fica salvo?',
    'Sim. Todas as mensagens ficam salvas indefinidamente, mesmo após as conversas serem encerradas. Você pode consultar o histórico completo de qualquer cliente clicando no nome dele.',
  ],
  [
    'A assistente responde fora do horário comercial?',
    'Sim, a Maria Antônia responde 24 horas por dia, 7 dias por semana. Quando ela chamar um atendente fora do expediente, a equipe verá o alerta ao retornar ao trabalho.',
  ],
  [
    'E se vários clientes enviarem mensagens ao mesmo tempo?',
    'O sistema processa cada conversa de forma independente. Não há limite de atendimentos simultâneos — a Maria Antônia pode responder centenas de clientes ao mesmo tempo sem prejuízo na qualidade.',
  ],
  [
    'Como sei que a Maria Antônia chamou um atendente?',
    'A equipe recebe um alerta automático com o nome e telefone do cliente e o resumo do que foi conversado. Além disso, a conversa aparece com a etiqueta agente-off no Chatwoot.',
  ],
];

for (const [q, a] of faqs) {
  needSpace(80);
  h2(q);
  p(a);
  doc.moveDown(0.1);
}

// ─────────────────────────────────────────────────────────────────────────────
// NUMERAÇÃO DE PÁGINAS + RODAPÉ
// ─────────────────────────────────────────────────────────────────────────────

const range = doc.bufferedPageRange();

for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);

  if (i === 0) continue; // sem rodapé na capa

  const footY = PAGE_H - 42;
  doc.save()
     .moveTo(ML, footY).lineTo(PAGE_W - MR, footY)
     .strokeColor('#D0D3D4').lineWidth(0.5).stroke()
     .restore();

  doc.fill(C.gray).font('Helvetica').fontSize(8.5)
     .text(
       'Manual do Usuário — Sistema de Atendimento MultiVacinas',
       ML, footY + 10,
       { width: CW - 40 },
     );

  doc.text(
    `${i + 1} / ${range.count}`,
    ML, footY + 10,
    { width: CW, align: 'right' },
  );
}

// ─────────────────────────────────────────────────────────────────────────────

doc.end();

stream.on('finish', () => {
  console.log(`\n✅  PDF gerado com sucesso!\n   → ${outFile}\n`);
});

stream.on('error', (err) => {
  console.error('❌  Erro ao gravar o PDF:', err);
  process.exit(1);
});
