export interface LibraryTemplate {
  category: string;
  icon: string;
  name: string;
  header?: string;
  body: string;
  footer?: string;
}

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  // ── Academia / Gym ──
  {
    category: 'Academia',
    icon: '💪',
    name: 'reativacao-academia',
    body: 'Oi {{nome}}! Sentimos sua falta 😔 Faz {{dias_inativo}} dias desde seu último treino. Que tal voltar? Temos uma condição especial esperando por você! 💪',
    footer: 'Responda QUERO para saber mais.',
  },
  {
    category: 'Academia',
    icon: '💪',
    name: 'promocao-academia',
    header: '🔥 Promoção Exclusiva',
    body: '{{nome}}, {{desconto}}% de desconto na renovação do seu plano {{plano}}! Válido até {{data_limite}}. Não perca essa chance de continuar treinando!',
    footer: 'Promoção válida apenas para clientes ativos.',
  },
  {
    category: 'Academia',
    icon: '💪',
    name: 'aniversario-academia',
    body: 'Feliz aniversário, {{nome}}! 🎂 Como presente, liberamos {{dias}} dias de acesso gratuito para você. Venha comemorar treinando! 🎉',
  },

  // ── Clínica / Saúde ──
  {
    category: 'Clínica',
    icon: '🏥',
    name: 'lembrete-consulta',
    header: '📅 Lembrete de Consulta',
    body: 'Olá {{nome}}, sua consulta com {{medico}} está agendada para amanhã, {{data}} às {{horario}}. Confirme sua presença respondendo *SIM* ou reagende respondendo *NÃO*.',
  },
  {
    category: 'Clínica',
    icon: '🏥',
    name: 'pos-consulta',
    body: 'Olá {{nome}}, esperamos que esteja bem após sua consulta! Tem alguma dúvida sobre o tratamento prescrito? Estamos aqui para ajudar 🩺',
    footer: 'Em emergências, ligue 190.',
  },
  {
    category: 'Clínica',
    icon: '🏥',
    name: 'resultado-exame',
    body: '{{nome}}, seu resultado de {{exame}} já está disponível! Entre em contato para agendar o retorno com {{medico}} e discutirmos os resultados 📋',
  },

  // ── E-commerce ──
  {
    category: 'E-commerce',
    icon: '🛒',
    name: 'carrinho-abandonado',
    body: '{{nome}}, você esqueceu *{{produto}}* no carrinho! 🛒 Ainda está disponível. Finalize agora e ganhe {{desconto}}% de desconto com o código *{{codigo}}*.',
    footer: 'Oferta válida por 24h.',
  },
  {
    category: 'E-commerce',
    icon: '🛒',
    name: 'rastreio-pedido',
    header: '📦 Atualização do seu pedido',
    body: '{{nome}}, seu pedido *#{{pedido}}* foi *{{status}}*! Previsão de entrega: {{data}}. Acompanhe pelo link: {{link_rastreio}}',
  },
  {
    category: 'E-commerce',
    icon: '🛒',
    name: 'pos-compra',
    body: '{{nome}}, seu {{produto}} chegou? 🎉 Esperamos que tenha adorado! Avalie sua experiência — sua opinião nos ajuda a melhorar cada dia ⭐',
    footer: 'Acesse nossa loja: {{link_loja}}',
  },

  // ── Restaurante ──
  {
    category: 'Restaurante',
    icon: '🍽️',
    name: 'confirmacao-reserva',
    header: '✅ Reserva Confirmada',
    body: '{{nome}}, sua reserva para *{{pessoas}} pessoa(s)* está confirmada para {{data}} às {{horario}}! Nos vemos em breve 🍽️',
    footer: 'Em caso de cancelamento, avise com 2h de antecedência.',
  },
  {
    category: 'Restaurante',
    icon: '🍽️',
    name: 'promocao-restaurante',
    body: '{{nome}}, hoje é {{dia_semana}} e temos *{{promocao}}* especial no jantar! Venha com a família e ganhe {{brinde}} de brinde 🎁 Reservas: responda aqui!',
  },
  {
    category: 'Restaurante',
    icon: '🍽️',
    name: 'status-delivery',
    body: '{{nome}}, seu pedido está a caminho! 🛵 Chegará em aproximadamente *{{tempo}} minutos*. Aproveite a refeição! 😋',
  },

  // ── Beleza / Estética ──
  {
    category: 'Beleza',
    icon: '💅',
    name: 'confirmacao-agendamento',
    header: '✂️ Agendamento Confirmado',
    body: 'Oi {{nome}}! Seu horário com *{{profissional}}* está confirmado para {{data}} às {{horario}} ✨ Qualquer dúvida, é só chamar!',
    footer: 'Pedimos pontualidade de até 10 minutos.',
  },
  {
    category: 'Beleza',
    icon: '💅',
    name: 'lembrete-beleza',
    body: '{{nome}}, lembrando que amanhã é seu dia de beleza! 💅 *{{data}} às {{horario}}* com {{profissional}}. Vai poder comparecer? Responda SIM ou NÃO.',
  },
  {
    category: 'Beleza',
    icon: '💅',
    name: 'fidelidade-beleza',
    body: 'Parabéns {{nome}}! 🎉 Você completou *{{qtd}} visitas* e ganhou *{{premio}}* de presente! Agende seu próximo horário e aproveite seu brinde 🎁',
  },

  // ── Imobiliária ──
  {
    category: 'Imobiliária',
    icon: '🏠',
    name: 'novo-imovel',
    body: '{{nome}}, encontramos um imóvel que combina com o que você procura! 🏠 *{{quartos}} quartos* em *{{bairro}}* por R$ {{preco}}. Quer agendar uma visita?',
  },
  {
    category: 'Imobiliária',
    icon: '🏠',
    name: 'followup-visita',
    body: '{{nome}}, o que achou do imóvel que visitamos? Ficou alguma dúvida? Estou à disposição para ajudar a encontrar o lar dos seus sonhos 🏡',
  },
  {
    category: 'Imobiliária',
    icon: '🏠',
    name: 'proposta-aceita',
    header: '🤝 Ótima Notícia!',
    body: '{{nome}}, o proprietário aceitou negociar a proposta! Podemos agendar uma reunião para fechar os detalhes? Esse imóvel pode ser seu! 🎉',
  },

  // ── Financeiro / Cobrança ──
  {
    category: 'Financeiro',
    icon: '💰',
    name: 'lembrete-vencimento',
    body: 'Olá {{nome}}, seu boleto de R$ {{valor}} vence em *{{data_vencimento}}*. Pague em dia e evite juros! 📄 Acesse: {{link_boleto}}',
  },
  {
    category: 'Financeiro',
    icon: '💰',
    name: 'oferta-negociacao',
    body: '{{nome}}, temos uma proposta especial para regularizar seu débito de R$ {{valor}}. Desconto de *{{desconto}}%* à vista ou parcelamento sem juros. Vamos conversar? 🤝',
  },
];

export const LIBRARY_CATEGORIES = [...new Set(TEMPLATE_LIBRARY.map(t => t.category))];
