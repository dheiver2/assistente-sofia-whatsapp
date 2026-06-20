/**
 * AI auto-reply extension plugin — multi-persona + memória de conversa.
 *
 * Responde mensagens diretas (1:1) com um LLM open-source local (Ollama). Cada SESSÃO/número
 * pode ter sua própria identidade de IA: um arquivo JSON (default /app/data/personas.json) mapeia
 * o nome da sessão (o que você escolhe ao criar no QR) para o system prompt daquela IA. Sem entrada
 * definida, usa a persona padrão (AI_SYSTEM_PROMPT). Mantém histórico por sessão+contato, persistido
 * via context.storage (sobrevive a reinícios), dando contexto/memória ao modelo.
 *
 * personas.json:
 *   {
 *     "default": "(opcional) sobrescreve a persona padrão para sessões sem entrada própria",
 *     "sessions": {
 *       "vendas":  "Você é a Bia, consultora comercial ...",
 *       "suporte": "Você é o Téo, suporte técnico ..."
 *     }
 *   }
 * As chaves de "sessions" podem ser o NOME da sessão ou o UUID dela.
 *
 * Config via env (with defaults):
 *   OLLAMA_URL / OLLAMA_MODEL / OLLAMA_TIMEOUT_MS — conexão ao modelo
 *   AI_HISTORY_TURNS   nº de turnos lembrados por conversa (default 8)
 *   AI_PERSONAS_FILE   caminho do mapa de personas (default /app/data/personas.json)
 *   AI_SYSTEM_PROMPT   persona padrão (fallback global)
 */
import * as fs from 'fs';
import { PluginContext, IPlugin } from '../../../core/plugins';
import { HookContext, HookResult } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS ?? 8);
const PERSONAS_FILE = process.env.AI_PERSONAS_FILE ?? '/app/data/personas.json';
const DEFAULT_PROMPT =
  process.env.AI_SYSTEM_PROMPT ??
  'Você é uma assistente de atendimento via WhatsApp, simpática e prestativa. ' +
    'Responda de forma curta, clara e natural, em português brasileiro. Não use markdown.';
const FALLBACK = 'Desculpe, estou com dificuldade para responder agora. Pode tentar novamente em instantes?';

type ChatTurn = { role: 'user' | 'assistant'; content: string };
type PersonasFile = { default?: string; sessions?: Record<string, string> };

/** Resolve o nome da sessão a partir do seu id (UUID). Injetado pelo registrar. */
export type SessionNameResolver = (sessionId: string) => Promise<string | null>;

export class AutoReplyPlugin implements IPlugin {
  private personasCache: { mtimeMs: number; data: PersonasFile } | null = null;
  private readonly nameCache = new Map<string, string | null>();

  constructor(private readonly resolveSessionName?: SessionNameResolver) {}

  onEnable(context: PluginContext): Promise<void> {
    context.registerHook('message:received', ctx => this.onMessage(context, ctx as HookContext<IncomingMessage>));
    context.logger.log(
      `AI auto-reply enabled (model=${OLLAMA_MODEL}, memória=${HISTORY_TURNS} turnos, personas=${PERSONAS_FILE})`,
    );
    return Promise.resolve();
  }

  /** Lê o personas.json com cache por mtime (recarrega quando o arquivo muda). */
  private loadPersonas(): PersonasFile {
    try {
      const stat = fs.statSync(PERSONAS_FILE);
      if (!this.personasCache || this.personasCache.mtimeMs !== stat.mtimeMs) {
        const parsed = JSON.parse(fs.readFileSync(PERSONAS_FILE, 'utf-8')) as PersonasFile;
        this.personasCache = { mtimeMs: stat.mtimeMs, data: parsed ?? {} };
      }
      return this.personasCache.data;
    } catch {
      // Arquivo ausente/ inválido → sem personas por sessão; usa o padrão.
      return {};
    }
  }

  private async sessionName(sessionId: string): Promise<string | null> {
    if (this.nameCache.has(sessionId)) {
      return this.nameCache.get(sessionId) ?? null;
    }
    let name: string | null = null;
    try {
      name = this.resolveSessionName ? await this.resolveSessionName(sessionId) : null;
    } catch {
      name = null;
    }
    this.nameCache.set(sessionId, name);
    return name;
  }

  /** Persona desta sessão: sessions[nome] → sessions[uuid] → default do arquivo → AI_SYSTEM_PROMPT. */
  private async resolvePersona(sessionId: string): Promise<string> {
    const personas = this.loadPersonas();
    const byId = personas.sessions?.[sessionId];
    if (byId) {
      return byId;
    }
    const name = await this.sessionName(sessionId);
    if (name && personas.sessions?.[name]) {
      return personas.sessions[name];
    }
    return personas.default ?? DEFAULT_PROMPT;
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

  private async generate(systemPrompt: string, history: ChatTurn[], userText: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userText }],
          options: { temperature: 0.7, num_predict: 320 },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const text = data.message?.content?.trim();
      if (!text) {
        throw new Error('empty AI response');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private async onMessage(context: PluginContext, ctx: HookContext<IncomingMessage>): Promise<HookResult> {
    const message = ctx.data;

    // Reply only to inbound, non-group, engine-originated messages; never to our own sends.
    if (ctx.source !== 'Engine' || !ctx.sessionId || message.fromMe || message.isGroup) {
      return { continue: true };
    }

    const body = (message.body ?? '').trim();
    if (!body) {
      return { continue: true };
    }

    const sessionId = ctx.sessionId;
    const chatId = message.chatId;
    const key = this.historyKey(sessionId, chatId);
    try {
      const persona = await this.resolvePersona(sessionId);
      const history = await this.loadHistory(context, key);

      let reply: string;
      try {
        reply = await this.generate(persona, history, body);
      } catch (aiErr) {
        context.logger.warn('AI generation failed; sending fallback', { error: String(aiErr) });
        await context.messages.reply(sessionId, chatId, message.id, FALLBACK);
        return { continue: true }; // não grava fallback no histórico
      }

      await context.messages.reply(sessionId, chatId, message.id, reply);

      history.push({ role: 'user', content: body }, { role: 'assistant', content: reply });
      await this.saveHistory(context, key, history);
    } catch (error) {
      context.logger.error('Auto-reply failed', error);
    }

    return { continue: true };
  }
}

export default AutoReplyPlugin;
