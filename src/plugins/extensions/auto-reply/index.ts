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

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS ?? 8);
// Janela para agrupar mensagens em rajada (responde uma vez quando o cliente para de digitar).
const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 3500);
const PERSONAS_FILE = process.env.AI_PERSONAS_FILE ?? '/app/data/personas.json';
const DEFAULT_PROMPT =
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
  return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
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

  constructor(private readonly resolveSession?: SessionResolver) {}

  onEnable(context: PluginContext): Promise<void> {
    context.registerHook('message:received', ctx =>
      Promise.resolve(this.onMessage(context, ctx as HookContext<IncomingMessage>)),
    );
    context.logger.log(
      `AI auto-reply enabled (model=${OLLAMA_MODEL}, memória=${HISTORY_TURNS} turnos, personas=${PERSONAS_FILE})`,
    );
    return Promise.resolve();
  }

  /** Lê o personas.json (fallback) com cache por mtime. */
  private loadPersonas(): PersonasFile {
    try {
      const stat = fs.statSync(PERSONAS_FILE);
      if (!this.personasCache || this.personasCache.mtimeMs !== stat.mtimeMs) {
        const parsed = JSON.parse(fs.readFileSync(PERSONAS_FILE, 'utf-8')) as PersonasFile;
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

    let systemPrompt = ai?.persona?.trim() || fromFile || personas.default || DEFAULT_PROMPT;
    if (ai?.knowledge?.trim()) {
      systemPrompt += `\n\nInformações e conhecimento da empresa (use para responder com precisão; não invente o que não estiver aqui):\n${ai.knowledge.trim()}`;
    }

    return {
      systemPrompt,
      model: ai?.model?.trim() || OLLAMA_MODEL,
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
    await context.storage.set(key, history.slice(-HISTORY_TURNS * 2));
  }

  private async generate(model: string, systemPrompt: string, history: ChatTurn[], userText: string): Promise<string> {
    const text = (await ollamaChat({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userText }],
      temperature: 0.7,
      numPredict: 140,
      url: OLLAMA_URL,
      timeoutMs: TIMEOUT_MS,
    })).trim();
    if (!text) throw new Error('empty AI response');
    return text;
  }

  private onMessage(context: PluginContext, ctx: HookContext<IncomingMessage>): HookResult {
    const message = ctx.data;

    // Reply only to inbound, non-group, engine-originated messages; never to our own sends.
    if (ctx.source !== 'Engine' || !ctx.sessionId || message.fromMe || message.isGroup) {
      return { continue: true };
    }

    const body = (message.body ?? '').trim();
    if (!body) {
      return { continue: true };
    }

    // Agrupa mensagens em rajada por conversa: reinicia o timer a cada nova mensagem e só
    // responde quando o cliente "para de digitar" por DEBOUNCE_MS — uma resposta por rajada.
    const sessionId = ctx.sessionId;
    const chatId = message.chatId;
    const key = this.historyKey(sessionId, chatId);
    const existing = this.bursts.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(body);
      existing.lastMessageId = message.id;
      existing.timer = setTimeout(() => void this.flush(context, sessionId, chatId, key), DEBOUNCE_MS);
    } else {
      const burst: PendingBurst = {
        texts: [body],
        lastMessageId: message.id,
        timer: setTimeout(() => void this.flush(context, sessionId, chatId, key), DEBOUNCE_MS),
      };
      this.bursts.set(key, burst);
    }

    // Keep the inbound message in history + webhooks + ws (do not swallow).
    return { continue: true };
  }

  /** Processa a rajada acumulada de uma conversa: gera UMA resposta com todo o contexto. */
  private async flush(context: PluginContext, sessionId: string, chatId: string, key: string): Promise<void> {
    const burst = this.bursts.get(key);
    if (!burst) return;
    this.bursts.delete(key);
    const userText = burst.texts.join('\n').trim();
    if (!userText) return;

    try {
      const profile = await this.resolveProfile(sessionId);
      if (!profile.enabled) return; // IA desligada para esta empresa/sessão

      // Business hours check
      if (profile.ai?.businessHours?.enabled && !isWithinBusinessHours(profile.ai.businessHours)) {
        const outsideMsg = profile.ai.businessHours.outsideMessage ?? 'Nosso atendimento está fora do horário. Retornaremos em breve!';
        await context.messages.reply(sessionId, chatId, burst.lastMessageId, outsideMsg);
        return;
      }

      const history = await this.loadHistory(context, key);
      const firstContact = history.length === 0;

      let reply: string;
      try {
        reply = await this.generate(profile.model, profile.systemPrompt, history, userText);
      } catch (aiErr) {
        context.logger.warn('AI generation failed; sending fallback', { error: String(aiErr) });
        await context.messages.reply(sessionId, chatId, burst.lastMessageId, FALLBACK);
        return; // não grava fallback no histórico
      }

      // Saudação inicial fixa: prefixa a primeira resposta da conversa.
      const outbound = firstContact && profile.greeting ? `${profile.greeting}\n\n${reply}` : reply;
      await context.messages.reply(sessionId, chatId, burst.lastMessageId, outbound);

      history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
      await this.saveHistory(context, key, history);
    } catch (error) {
      context.logger.error('Auto-reply failed', error);
    }
  }
}

export default AutoReplyPlugin;
