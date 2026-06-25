/**
 * AI auto-reply extension plugin — multi-empresa (uma empresa = uma sessão).
 *
 * Responde mensagens diretas (1:1) com um LLM open-source local (Ollama). Cada SESSÃO/número
 * tem a sua própria IA de atendimento, configurada no dashboard e persistida em Session.config.ai
 * (personalidade, conhecimento da empresa, modelo e saudação). Mantém histórico por sessão+contato
 * (persistido via context.storage, sobrevive a reinícios), dando contexto/memória ao modelo.
 *
 * Fontes da persona, em ordem:
 *   1. Session.config.ai.persona  (configurado no dashboard, por empresa)
 *   2. data/personas.json         (mapa por nome/uuid de sessão — fallback opcional)
 *   3. AI_SYSTEM_PROMPT           (persona global padrão)
 *
 * Config via env (with defaults):
 *   OLLAMA_URL / OLLAMA_MODEL / OLLAMA_TIMEOUT_MS — conexão ao modelo
 *   AI_HISTORY_TURNS   nº de turnos lembrados por conversa (default 8)
 *   AI_PERSONAS_FILE   caminho do mapa de personas de fallback (default /app/data/personas.json)
 *   AI_SYSTEM_PROMPT   persona global padrão
 */
import * as fs from 'fs';
import { PluginContext, IPlugin } from '../../../core/plugins';
import { HookContext, HookResult } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';
import { ollamaChat } from '../../../common/ollama/ollama.client';

// IMPORTANT: read env LAZILY (functions, not module-level constants). This plugin module is imported
// before main.ts runs dotenv.config(), so evaluating process.env at import time would capture the
// Docker default 'host.docker.internal' instead of the .env value, breaking Ollama on host installs.
const OLLAMA_URL = () => process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
const OLLAMA_MODEL = () => process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const TIMEOUT_MS = () => Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);
const HISTORY_TURNS = () => Number(process.env.AI_HISTORY_TURNS ?? 8);
// Janela para agrupar mensagens em rajada (responde uma vez quando o cliente para de digitar).
const DEBOUNCE_MS = () => Number(process.env.AI_DEBOUNCE_MS ?? 3500);
const PERSONAS_FILE = () => process.env.AI_PERSONAS_FILE ?? '/app/data/personas.json';
// Handoff humano: por quanto tempo a IA fica em silêncio numa conversa depois que um humano
// respondeu manualmente (renovado a cada mensagem do humano). Default 10 min.
const HANDOFF_PAUSE_MS = () => Number(process.env.AI_HANDOFF_PAUSE_MS ?? 600_000);
// Janela para reconhecer o "eco" de uma mensagem que a própria IA enviou (fromMe) e não
// confundir com um humano assumindo a conversa.
const AI_ECHO_WINDOW_MS = 25_000;
// Normaliza texto para o match de eco ser robusto a diferenças de espaço/quebra de linha
// (\r\n vs \n, espaços à toa) que o engine possa introduzir no body ecoado.
const normText = (s: string): string => s.replace(/\s+/g, ' ').trim();
const DEFAULT_PROMPT = () =>
  process.env.AI_SYSTEM_PROMPT ??
  'Você é uma assistente de atendimento via WhatsApp, simpática e prestativa. ' +
    'Responda de forma curta, clara e natural, em português brasileiro. Não use markdown.';
const FALLBACK = 'Desculpe, estou com dificuldade para responder agora. Pode tentar novamente em instantes?';

type ChatTurn = { role: 'user' | 'assistant'; content: string };
type PersonasFile = { default?: string; sessions?: Record<string, string> };

/** Config da IA de uma sessão (espelha Session.config.ai). */
export interface SessionAi {
  enabled?: boolean;
  persona?: string;
  knowledge?: string;
  model?: string;
  greeting?: string;
  businessHours?: {
    enabled: boolean;
    timezone?: string; // e.g. 'America/Sao_Paulo'
    schedule: {
      [day: string]: { start: string; end: string } | false; // day = 'mon','tue','wed','thu','fri','sat','sun'; false = closed
    };
    outsideMessage?: string; // message sent when outside hours
  };
}
/** Resolve a sessão (nome + config de IA) a partir do seu id (UUID). Injetado pelo registrar. */
export type SessionResolver = (sessionId: string) => Promise<{ name: string | null; ai: SessionAi | null }>;

/** Resolve o contexto do cliente (histórico/perfil/cadência) por sessão+telefone, para a IA
 *  personalizar a conversa e recomendar com base no que a pessoa já comprou. */
export type ContactResolver = (sessionId: string, phone: string) => Promise<{ name: string | null; aiContext: string } | null>;

/** Item descrito pela IA no bloco <pedido> (linguagem natural — o backend resolve no catálogo). */
export interface OrderItemDescriptor {
  descricao: string;
  categoria?: string;
  marca?: string;
  qtd?: number;
}
/** Item já resolvido no catálogo (nome canônico + preço da base — fonte da verdade). */
export interface ResolvedOrderItem {
  produto: string;
  qtd: number;
  preco: number;
}

/**
 * Hooks de comércio injetados pelo registrar (acesso ao catálogo e ao módulo de pedidos). Mantêm o
 * plugin desacoplado: a IA descreve o que o cliente quer, o BACKEND resolve preço/nome e cria o pedido.
 */
export interface CommerceHooks {
  /** A sessão é de comércio? (tem catálogo de produtos). Liga o fluxo de pedidos só onde faz sentido. */
  isEnabled(sessionId: string): Promise<boolean>;
  /** Resolve descrições da IA contra o catálogo da sessão (nome canônico + preço). */
  resolveProducts(sessionId: string, items: OrderItemDescriptor[]): Promise<ResolvedOrderItem[]>;
  /** Cria o pedido (status 'novo' → emite order.created). Retorna id + total. */
  placeOrder(input: {
    sessionId: string;
    phone: string;
    customerName?: string | null;
    items: ResolvedOrderItem[];
  }): Promise<{ id: string; total: number }>;
  /** Soma itens a um pedido existente (upsell aceito após a recomendação). Retorna id + total. */
  appendOrder(orderId: string, items: ResolvedOrderItem[]): Promise<{ id: string; total: number }>;
  /** Salva o perfil do pet descoberto na conversa (espécie/porte) no contato — enriquece o lead novo. */
  saveContactProfile(sessionId: string, phone: string, profile: { especie?: string; porte?: string }): Promise<void>;
}

/** Bloco estruturado que a IA emite ao fim de cada resposta (removido antes de enviar ao cliente). */
interface PedidoBlock {
  intent?: string;
  itens?: OrderItemDescriptor[];
  confirmado?: boolean;
  sentimento?: string; // 'neutro' | 'negativo'
  perfilPet?: { especie?: string; porte?: string };
  handoff?: { necessario?: boolean; motivo?: string };
}

/** Estado do carrinho por conversa (persistido junto do histórico). */
interface CartState {
  items: ResolvedOrderItem[];
  lastHash: string;
  lastAt: number;
  lastOrderId?: string; // último pedido criado nesta conversa (para somar upsell aceito)
}

// Confirmação explícita do cliente no texto (dupla checagem além do confirmado:true do LLM).
const CONFIRM_RE = /\b(confirm[ao]|pode\s+(mandar|separar|ser|fechar|enviar)|isso\s*mesmo|fechado|quero\s+sim|é\s+isso|pode\s+sim|fecha)\b/i;
const HANDOFF_INTENTS = new Set(['emergencia_saude', 'reclamacao', 'falar_com_humano', 'opt_out']);
// Janela em que um novo "fechado" some no MESMO pedido (ex.: upsell aceito após a recomendação).
const ORDER_MERGE_WINDOW_MS = 10 * 60_000;

// Diretrizes do fluxo de venda consultiva em 3 estágios (anexadas ao system prompt em sessões de comércio).
const ORDER_FLOW_DIRECTIVES = `

COMO ATENDER (loja — venda consultiva em 3 estágios, sem menu "digite 1"):
1) ENTENDER: descubra a necessidade com o MÍNIMO de perguntas. Aproveite o que já sabe do cliente/pet — CONFIRME em vez de perguntar (ex.: "é a Golden 15kg de sempre pro Thor, né?"). Máx. 1 pergunta por vez.
2) FECHAR: monte o pedido e confirme itens e quantidades. Você NUNCA inventa preço nem nome exato de produto — descreva o item no bloco <pedido> e só fale o valor DEPOIS que o sistema confirmar; se ainda não souber, diga "já te confirmo o valor certinho".
3) RECOMENDAR: só DEPOIS que o cliente confirmar o pedido, ofereça UM complemento que combine e lembre a próxima reposição. Não insista se ele recusar.

PREÇO E PRODUTO: NUNCA invente preço, nome exato de produto nem código — descreva o item no bloco e deixe o sistema confirmar. Ofereça no máximo UMA sugestão por mensagem e não insista se a pessoa recusar.

SAÚDE (regra rígida): você NÃO dá conselho clínico nem diagnóstico. Sintoma, doença, urgência, dúvida sobre vacina/vermífugo/medicação → apenas acolha, ajude a AGENDAR e marque handoff. Jamais minimize um problema de saúde.

HANDOFF: saúde, reclamação séria, cliente irritado/insatisfeito, negociação de preço ou pedido de falar com humano — não tente vender; diga com empatia que vai passar para a equipe (que já tem todo o contexto, o cliente não repete nada) e marque handoff no bloco.

Ao FINAL de CADA resposta, acrescente UM bloco <pedido>...</pedido> em JSON (o cliente NÃO vê). Use SEMPRE exatamente estas chaves:
<pedido>{"intent":"repor_consumivel|comprar_produto|agendar_banho_tosa|agendar_vet_vacina|confirmar_pedido|ajustar_carrinho|duvida|falar_com_humano|nenhum","itens":[{"descricao":"","categoria":"","marca":"","qtd":1}],"confirmado":false,"sentimento":"neutro","perfilPet":{"especie":"","porte":""},"handoff":{"necessario":false,"motivo":""}}</pedido>
- "confirmado" só é true quando o cliente confirmar claramente ("confirma","pode mandar","isso","fechado").
- "sentimento": use "negativo" se o cliente estiver irritado, frustrado ou insatisfeito; senão "neutro".
- "perfilPet": preencha quando descobrir a espécie (cão/gato) e/ou porte (pequeno/médio/grande) do pet; senão deixe vazio.
- Sem ação, use "intent":"nenhum" e "itens":[].
Exemplo — cliente: "quero 2 sacos da golden 15kg pro thor" → <pedido>{"intent":"repor_consumivel","itens":[{"descricao":"Ração Golden 15kg","categoria":"RACAO","marca":"Golden","qtd":2}],"confirmado":false,"sentimento":"neutro","perfilPet":{"especie":"cão","porte":"grande"},"handoff":{"necessario":false,"motivo":""}}</pedido>`;

// Anexada no PRIMEIRO contato de quem ainda não conhecemos (lead novo, sem histórico).
const FIRST_CONTACT_DIRECTIVE = `

PRIMEIRO CONTATO: você ainda não conhece este cliente nem o pet dele. Acolha com calor e, de forma natural, faça UMA única pergunta leve para conhecer o bichinho (qual é o pet, nome, porte) — sem interrogatório. Assim que souber, preencha "perfilPet" no bloco.`;

function isWithinBusinessHours(bh: NonNullable<SessionAi['businessHours']>): boolean {
  if (!bh.enabled) return true;
  const tz = bh.timezone ?? 'America/Sao_Paulo';
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(now);
  const dayMap: Record<string, string> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };
  const dayKey = dayMap[parts.find(p => p.type === 'weekday')?.value ?? ''] ?? '';
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minStr = parts.find(p => p.type === 'minute')?.value ?? '00';
  const currentMinutes = parseInt(hourStr) * 60 + parseInt(minStr);
  const rule = bh.schedule[dayKey];
  if (!rule) return false; // closed today
  const [sh, sm] = rule.start.split(':').map(Number);
  const [eh, em] = rule.end.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  // Malformed "HH:MM" → NaN comparisons silently treat the business as closed all day. Fail open
  // (treat as within hours) so a bad config doesn't silence the assistant without any signal.
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) return true;
  // Overnight range (e.g. 18:00–02:00): the window wraps past midnight.
  if (endMinutes <= startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

interface ResolvedProfile {
  systemPrompt: string;
  model: string;
  greeting?: string;
  enabled: boolean;
  ai: SessionAi | null;
}

interface PendingBurst {
  texts: string[];
  lastMessageId: string;
  timer: ReturnType<typeof setTimeout>;
}

export class AutoReplyPlugin implements IPlugin {
  private personasCache: { mtimeMs: number; data: PersonasFile } | null = null;
  // Buffer por conversa: agrupa mensagens em rajada e responde UMA vez (evita respostas duplicadas
  // e apresentações repetidas quando o cliente manda várias mensagens seguidas).
  private readonly bursts = new Map<string, PendingBurst>();
  // Handoff humano: enquanto Date.now() < valor, a IA fica em silêncio nessa conversa (key).
  private readonly humanPausedUntil = new Map<string, number>();
  // Textos enviados recentemente pela própria IA, por conversa — usados para reconhecer o "eco"
  // fromMe da IA e NÃO confundir com um humano respondendo manualmente.
  private readonly aiSentRecent = new Map<string, { text: string; at: number }[]>();
  // Conversas que a IA está de fato atendendo (key -> timestamp do último envio da IA). O handoff só
  // pausa conversas AQUI — uma mensagem fromMe num chat que a IA nunca tocou é uso normal, não takeover.
  private readonly aiEngaged = new Map<string, number>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  // Cache de "a sessão é de comércio?" (evita consultar o catálogo a cada mensagem).
  private readonly commerceCache = new Map<string, { v: boolean; at: number }>();

  constructor(
    private readonly resolveSession?: SessionResolver,
    private readonly resolveContact?: ContactResolver,
    private readonly commerce?: CommerceHooks,
  ) {}

  /** Registra um texto enviado pela própria IA (para distinguir do humano no eco fromMe). */
  private recordAiSent(key: string, text: string): void {
    const now = Date.now();
    const list = (this.aiSentRecent.get(key) ?? []).filter(r => now - r.at < AI_ECHO_WINDOW_MS);
    list.push({ text: normText(text), at: now });
    this.aiSentRecent.set(key, list);
    this.aiEngaged.set(key, now); // a IA está atendendo esta conversa
  }

  /** Remove pausas expiradas e ecos antigos — evita crescimento ilimitado dos mapas. */
  private pruneState(): void {
    const now = Date.now();
    for (const [k, until] of this.humanPausedUntil) {
      if (until <= now) this.humanPausedUntil.delete(k);
    }
    for (const [k, list] of this.aiSentRecent) {
      const fresh = list.filter(r => now - r.at < AI_ECHO_WINDOW_MS);
      if (fresh.length) this.aiSentRecent.set(k, fresh);
      else this.aiSentRecent.delete(k);
    }
    for (const [k, at] of this.aiEngaged) {
      if (now - at > 30 * 60_000) this.aiEngaged.delete(k);
    }
  }

  onEnable(context: PluginContext): Promise<void> {
    context.registerHook('message:received', ctx =>
      Promise.resolve(this.onMessage(context, ctx as HookContext<IncomingMessage>)),
    );
    // Mensagens fromMe (inclusive compostas no celular) chegam por este hook — usado para o
    // handoff humano (pausar a IA quando um humano responde manualmente).
    context.registerHook('message:sent', ctx =>
      Promise.resolve(this.onOutgoing(context, ctx as HookContext<IncomingMessage>)),
    );
    context.logger.log(
      `AI auto-reply enabled (model=${OLLAMA_MODEL()}, memória=${HISTORY_TURNS()} turnos, personas=${PERSONAS_FILE()})`,
    );
    // Sweep periódico das pausas/ecos expirados (limita a memória num servidor multi-empresa).
    this.cleanupTimer = setInterval(() => this.pruneState(), 300_000);
    return Promise.resolve();
  }

  /** Clear pending burst timers so a disable/reload doesn't leak timers or fire against a torn-down context. */
  onDisable(context: PluginContext): Promise<void> {
    for (const burst of this.bursts.values()) {
      clearTimeout(burst.timer);
    }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = undefined; }
    this.bursts.clear();
    this.humanPausedUntil.clear();
    this.aiSentRecent.clear();
    this.aiEngaged.clear();
    context.logger.log('AI auto-reply disabled — pending burst timers cleared');
    return Promise.resolve();
  }

  /** Lê o personas.json (fallback) com cache por mtime. */
  private loadPersonas(): PersonasFile {
    try {
      const file = PERSONAS_FILE();
      const stat = fs.statSync(file);
      if (!this.personasCache || this.personasCache.mtimeMs !== stat.mtimeMs) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as PersonasFile;
        this.personasCache = { mtimeMs: stat.mtimeMs, data: parsed ?? {} };
      }
      return this.personasCache.data;
    } catch {
      return {};
    }
  }

  /** Monta o perfil de IA efetivo desta sessão (empresa). */
  private async resolveProfile(sessionId: string): Promise<ResolvedProfile> {
    let name: string | null = null;
    let ai: SessionAi | null = null;
    try {
      if (this.resolveSession) {
        const r = await this.resolveSession(sessionId);
        name = r.name;
        ai = r.ai;
      }
    } catch {
      /* segue com fallbacks */
    }

    const personas = this.loadPersonas();
    const fromFile = personas.sessions?.[sessionId] ?? (name ? personas.sessions?.[name] : undefined);

    let systemPrompt = ai?.persona?.trim() || fromFile || personas.default || DEFAULT_PROMPT();
    if (ai?.knowledge?.trim()) {
      systemPrompt += `\n\nInformações e conhecimento da empresa (use para responder com precisão; não invente o que não estiver aqui):\n${ai.knowledge.trim()}`;
    }

    return {
      systemPrompt,
      model: ai?.model?.trim() || OLLAMA_MODEL(),
      greeting: ai?.greeting?.trim() || undefined,
      enabled: ai?.enabled !== false, // default: ligado
      ai,
    };
  }

  private historyKey(sessionId: string, chatId: string): string {
    const safe = (s: string): string => s.replace(/[^a-zA-Z0-9@:._-]/g, '_');
    return `hist-${safe(sessionId)}-${safe(chatId)}`;
  }

  private async loadHistory(context: PluginContext, key: string): Promise<ChatTurn[]> {
    const saved = await context.storage.get<ChatTurn[]>(key);
    return Array.isArray(saved) ? saved : [];
  }

  private async saveHistory(context: PluginContext, key: string, history: ChatTurn[]): Promise<void> {
    await context.storage.set(key, history.slice(-HISTORY_TURNS() * 2));
  }

  // ── Fluxo de pedidos (3 estágios) ────────────────────────────────────────────
  /** A sessão é de comércio? (tem catálogo). Cacheado por 5 min. */
  private async commerceEnabled(sessionId: string): Promise<boolean> {
    if (!this.commerce) return false;
    const c = this.commerceCache.get(sessionId);
    if (c && Date.now() - c.at < 300_000) return c.v;
    const v = await this.commerce.isEnabled(sessionId).catch(() => false);
    this.commerceCache.set(sessionId, { v, at: Date.now() });
    return v;
  }

  private cartKey(sessionId: string, chatId: string): string {
    const safe = (s: string): string => s.replace(/[^a-zA-Z0-9@:._-]/g, '_');
    return `cart-${safe(sessionId)}-${safe(chatId)}`;
  }

  private cartHash(items: ResolvedOrderItem[]): string {
    return items.map(i => `${normText(i.produto)}x${i.qtd}`).sort().join('|');
  }

  /** Extrai o bloco <pedido>{...}</pedido> (ou ```json) e devolve o texto limpo + o objeto. */
  private parsePedido(text: string): { clean: string; pedido: PedidoBlock | null } {
    const m = text.match(/<pedido>\s*([\s\S]*?)<\/pedido>/i) || text.match(/```json\s*([\s\S]*?)```/i);
    let pedido: PedidoBlock | null = null;
    if (m) {
      try { pedido = JSON.parse(m[1].trim()) as PedidoBlock; } catch { /* bloco inválido: ignora */ }
    }
    const clean = text
      .replace(/<pedido>[\s\S]*?<\/pedido>/gi, '')
      .replace(/```json[\s\S]*?```/gi, '')
      .trim();
    return { clean, pedido };
  }

  /** Processa o bloco de pedido: handoff, resolução no catálogo, montagem do carrinho e fechamento. */
  private async processPedido(
    context: PluginContext,
    sessionId: string,
    chatId: string,
    key: string,
    phone: string,
    customerName: string | null,
    userText: string,
    pedido: PedidoBlock,
  ): Promise<void> {
    if (!this.commerce) return;

    // Perfil do pet descoberto na conversa → enriquece o contato (lead novo ganha espécie/porte).
    const perfil = pedido.perfilPet;
    if (perfil && (perfil.especie || perfil.porte)) {
      void this.commerce.saveContactProfile(sessionId, phone, perfil).catch(() => {});
    }

    // Handoff: sinalizado pela IA, intent de escalonamento, OU sentimento negativo (protege a marca).
    const negativo = String(pedido.sentimento).toLowerCase() === 'negativo';
    if (pedido.handoff?.necessario || (pedido.intent && HANDOFF_INTENTS.has(pedido.intent)) || negativo) {
      this.humanPausedUntil.set(key, Date.now() + HANDOFF_PAUSE_MS());
      context.logger.log('Handoff acionado', {
        sessionId,
        chatId,
        motivo: pedido.handoff?.motivo ?? (negativo ? 'sentimento negativo' : pedido.intent),
      });
      return;
    }

    const ckey = this.cartKey(sessionId, chatId);
    const cart: CartState = (await context.storage.get<CartState>(ckey)) ?? { items: [], lastHash: '', lastAt: 0 };

    // Resolve as descrições da IA contra o catálogo e mescla no carrinho.
    const descritos = Array.isArray(pedido.itens) ? pedido.itens.filter(i => i && i.descricao) : [];
    if (descritos.length) {
      const resolved = await this.commerce.resolveProducts(sessionId, descritos).catch(() => [] as ResolvedOrderItem[]);
      for (const r of resolved) {
        const ex = cart.items.find(c => normText(c.produto) === normText(r.produto));
        if (ex) { ex.qtd = r.qtd; ex.preco = r.preco; } else cart.items.push(r);
      }
    }

    // Fechamento: confirmado pela IA E confirmação explícita no texto do cliente (dupla checagem).
    const confirmar = pedido.confirmado === true && CONFIRM_RE.test(userText) && cart.items.length > 0;
    if (confirmar) {
      const hash = this.cartHash(cart.items);
      if (cart.lastHash === hash && Date.now() - cart.lastAt < 60_000) {
        // Idempotência: mesma cesta dentro de 60s (burst/retry) — não duplica o pedido.
      } else {
        try {
          // Se já há um pedido recente nesta conversa (ex.: cliente aceitou o upsell logo após fechar),
          // SOMA os itens nesse pedido em vez de criar um novo. Senão, cria um pedido novo.
          const merge = cart.lastOrderId && Date.now() - cart.lastAt < ORDER_MERGE_WINDOW_MS;
          if (merge) {
            const order = await this.commerce.appendOrder(cart.lastOrderId as string, cart.items);
            context.logger.log('Itens somados ao pedido (upsell aceito)', { sessionId, phone, orderId: order.id, total: order.total });
          } else {
            const order = await this.commerce.placeOrder({ sessionId, phone, customerName, items: cart.items });
            context.logger.log('Pedido criado pela conversa', { sessionId, phone, orderId: order.id, total: order.total, itens: cart.items.length });
            cart.lastOrderId = order.id;
          }
          cart.items = [];
          cart.lastHash = hash;
          cart.lastAt = Date.now();
        } catch (e) {
          context.logger.error('Falha ao registrar pedido', e);
        }
      }
    }

    await context.storage.set(ckey, cart);
  }

  private async generate(model: string, systemPrompt: string, history: ChatTurn[], userText: string): Promise<string> {
    // Retry once: the first message after an idle period can fail while Ollama cold-loads the model
    // (transient "fetch failed"). A single retry turns that into a normal reply instead of a fallback.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = (await ollamaChat({
          model,
          messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userText }],
          temperature: 0.7,
          numPredict: 140,
          url: OLLAMA_URL(),
          timeoutMs: TIMEOUT_MS(),
        })).trim();
        if (!text) throw new Error('empty AI response');
        return text;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500)); // brief pause before retry
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('AI generation failed');
  }

  private onMessage(context: PluginContext, ctx: HookContext<IncomingMessage>): HookResult {
    const message = ctx.data;

    if (ctx.source !== 'Engine' || !ctx.sessionId) {
      return { continue: true };
    }

    // Mensagens fromMe chegam pelo hook `message:sent` (onOutgoing), não aqui.
    if (message.fromMe) {
      return { continue: true };
    }

    const chatId = message.chatId ?? '';
    // Only individual 1:1 chats matter for auto-reply. `isGroup` doesn't catch
    // channels/newsletters/broadcasts, so gate on the chat JID suffix.
    const isIndividual = /@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId);
    const sessionId = ctx.sessionId;
    const key = this.historyKey(sessionId, chatId);

    if (message.isGroup || !isIndividual) {
      return { continue: true };
    }

    const body = (message.body ?? '').trim();
    if (!body) {
      return { continue: true };
    }

    // Não responde a histórico sincronizado no connect: ignora mensagens claramente antigas (>2 min).
    // (Se não houver timestamp, prossegue — mensagens ao vivo trazem timestamp.)
    if (message.timestamp && Date.now() - message.timestamp * 1000 > 120_000) {
      return { continue: true };
    }

    // Se um humano está conduzindo esta conversa, a IA fica em silêncio.
    if (Date.now() < (this.humanPausedUntil.get(key) ?? 0)) {
      return { continue: true };
    }

    // Agrupa mensagens em rajada por conversa: reinicia o timer a cada nova mensagem e só
    // responde quando o cliente "para de digitar" por DEBOUNCE_MS — uma resposta por rajada.
    const existing = this.bursts.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(body);
      existing.lastMessageId = message.id;
      existing.timer = setTimeout(() => void this.flush(context, sessionId, chatId, key), DEBOUNCE_MS());
    } else {
      const burst: PendingBurst = {
        texts: [body],
        lastMessageId: message.id,
        timer: setTimeout(() => void this.flush(context, sessionId, chatId, key), DEBOUNCE_MS()),
      };
      this.bursts.set(key, burst);
    }

    // Keep the inbound message in history + webhooks + ws (do not swallow).
    return { continue: true };
  }

  /**
   * Hook `message:sent` — toda mensagem fromMe da conta (inclusive composta no celular/linked device).
   * É AQUI que detectamos o handoff humano: uma mensagem fromMe que a IA não enviou = um humano
   * respondeu manualmente → pausa a IA nessa conversa. (As respostas da própria IA também passam por
   * aqui, mas são reconhecidas pelo eco em aiSentRecent e ignoradas.)
   */
  private onOutgoing(context: PluginContext, ctx: HookContext<IncomingMessage>): HookResult {
    const message = ctx.data;
    if (ctx.source !== 'Engine' || !ctx.sessionId || !message.fromMe) {
      return { continue: true };
    }
    const chatId = message.chatId ?? '';
    if (!/@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId)) {
      return { continue: true }; // só conversas 1:1
    }
    // CRÍTICO: só um envio RECENTE ao vivo é handoff. No connect, o Baileys sincroniza o histórico
    // de mensagens enviadas (fromMe) — sem este guard, cada mensagem antiga pausaria a IA em todas
    // as conversas. Mensagens sem timestamp ou antigas (>2 min) são ignoradas (não são handoff vivo).
    const tsMs = message.timestamp ? message.timestamp * 1000 : 0;
    if (!tsMs || Date.now() - tsMs > 120_000) {
      return { continue: true };
    }
    const key = this.historyKey(ctx.sessionId, chatId);
    const body = normText(message.body ?? '');
    const recents = this.aiSentRecent.get(key) ?? [];
    const idx = recents.findIndex(r => r.text === body && Date.now() - r.at < AI_ECHO_WINDOW_MS);
    if (idx >= 0) {
      recents.splice(idx, 1); // é o eco da própria IA — ignora
      if (recents.length === 0) this.aiSentRecent.delete(key);
      return { continue: true };
    }

    // Não é eco da IA. Só é "handoff" se a IA estava de fato atendendo esta conversa (enviou algo nos
    // últimos 30 min). Caso contrário é uso normal / histórico sincronizado — nada a pausar.
    const engagedAt = this.aiEngaged.get(key) ?? 0;
    if (Date.now() - engagedAt > 30 * 60_000) {
      return { continue: true };
    }

    // Humano assumiu uma conversa que a IA atendia: silencia a IA e cancela qualquer resposta pendente.
    this.humanPausedUntil.set(key, Date.now() + HANDOFF_PAUSE_MS());
    const pending = this.bursts.get(key);
    if (pending) { clearTimeout(pending.timer); this.bursts.delete(key); }
    context.logger.log('Auto-reply pausado (humano assumiu a conversa)', { sessionId: ctx.sessionId, chatId });
    return { continue: true };
  }

  /** Processa a rajada acumulada de uma conversa: gera UMA resposta com todo o contexto. */
  private async flush(context: PluginContext, sessionId: string, chatId: string, key: string): Promise<void> {
    const burst = this.bursts.get(key);
    if (!burst) return;
    this.bursts.delete(key);
    const userText = burst.texts.join('\n').trim();
    if (!userText) return;

    // Um humano pode ter assumido durante a janela de debounce — não fale por cima dele.
    if (Date.now() < (this.humanPausedUntil.get(key) ?? 0)) return;

    try {
      const profile = await this.resolveProfile(sessionId);
      if (!profile.enabled) return; // IA desligada para esta empresa/sessão

      // Business hours check
      if (profile.ai?.businessHours?.enabled && !isWithinBusinessHours(profile.ai.businessHours)) {
        const outsideMsg = profile.ai.businessHours.outsideMessage ?? 'Nosso atendimento está fora do horário. Retornaremos em breve!';
        this.recordAiSent(key, outsideMsg);
        await context.messages.reply(sessionId, chatId, burst.lastMessageId, outsideMsg);
        return;
      }

      const history = await this.loadHistory(context, key);
      const firstContact = history.length === 0;
      const phone = chatId.split('@')[0].replace(/\D/g, '');

      // Cliente conhecido: injeta o histórico/perfil para a IA personalizar e recomendar na conversa.
      let systemPrompt = profile.systemPrompt;
      let custName: string | null = null;
      let hasContext = false;
      try {
        const cust = this.resolveContact && phone ? await this.resolveContact(sessionId, phone) : null;
        custName = cust?.name ?? null;
        if (cust?.aiContext) {
          hasContext = true;
          systemPrompt +=
            `\n\nCLIENTE QUE ESTÁ FALANDO AGORA (dados reais do histórico — use com naturalidade para ` +
            `personalizar o atendimento e recomendar o que faz sentido; NÃO despeje tudo de uma vez, ` +
            `traga no máximo UMA sugestão por mensagem e só quando vier a propósito):\n${cust.aiContext}`;
        }
      } catch {
        /* segue sem contexto do cliente */
      }

      // Sessão de comércio (tem catálogo): liga o fluxo de venda consultiva em 3 estágios.
      const commerceOn = await this.commerceEnabled(sessionId);
      if (commerceOn) {
        systemPrompt += ORDER_FLOW_DIRECTIVES;
        // Lead novo (primeiro contato, sem histórico): boas-vindas com micro-qualificação do pet.
        if (firstContact && !hasContext) systemPrompt += FIRST_CONTACT_DIRECTIVE;
      }

      let reply: string;
      try {
        reply = await this.generate(profile.model, systemPrompt, history, userText);
      } catch (aiErr) {
        context.logger.warn('AI generation failed; sending fallback', { error: String(aiErr) });
        this.recordAiSent(key, FALLBACK);
        await context.messages.reply(sessionId, chatId, burst.lastMessageId, FALLBACK);
        return; // não grava fallback no histórico
      }

      // Extrai e REMOVE o bloco <pedido> antes de enviar ao cliente (ele não vê o JSON).
      let pedido: PedidoBlock | null = null;
      if (commerceOn) {
        const parsed = this.parsePedido(reply);
        pedido = parsed.pedido;
        if (parsed.clean) reply = parsed.clean;
      }

      // Recheca o pause logo antes do envio (a geração no LLM pode levar segundos).
      if (Date.now() < (this.humanPausedUntil.get(key) ?? 0)) return;

      // Saudação inicial fixa: prefixa a primeira resposta da conversa.
      const outbound = firstContact && profile.greeting ? `${profile.greeting}\n\n${reply}` : reply;
      this.recordAiSent(key, outbound);
      await context.messages.reply(sessionId, chatId, burst.lastMessageId, outbound);

      history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
      await this.saveHistory(context, key, history);

      // Processa o pedido (resolve catálogo, monta carrinho, fecha + notifica, ou faz handoff).
      if (commerceOn && pedido) {
        try {
          await this.processPedido(context, sessionId, chatId, key, phone, custName, userText, pedido);
        } catch (e) {
          context.logger.warn('processPedido falhou', { error: String(e) });
        }
      }
    } catch (error) {
      context.logger.error('Auto-reply failed', error);
    }
  }
}

export default AutoReplyPlugin;
