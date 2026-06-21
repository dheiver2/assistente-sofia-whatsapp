export interface OllamaMessage {
  role: string;
  content: string;
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  /** When true, sends format:'json' to force JSON output */
  json?: boolean;
  temperature?: number;
  numPredict?: number;
  timeoutMs?: number;
  url?: string;
}

const DEFAULT_URL = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const DEFAULT_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);

export const OLLAMA_DEFAULTS = { url: DEFAULT_URL, model: DEFAULT_MODEL, timeoutMs: DEFAULT_TIMEOUT };

/**
 * Single source of truth for talking to Ollama's /api/chat endpoint.
 * Returns the assistant message content (trimmed), or throws on HTTP error / timeout.
 */
export async function ollamaChat(opts: OllamaChatOptions): Promise<string> {
  const url = opts.url ?? DEFAULT_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      stream: false,
      messages: opts.messages,
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.numPredict ?? 250,
      },
    };
    if (opts.json) body.format = 'json';
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() ?? '';
  } finally {
    clearTimeout(timer);
  }
}
