import { AutoReplyPlugin } from './index';
import { PluginContext } from '../../../core/plugins';
import { HookContext, HookEvent, HookHandler } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';

function makeContext(reply: jest.Mock): { context: PluginContext; getHandler: () => HookHandler } {
  let captured: HookHandler | undefined;
  const context = {
    pluginId: 'auto-reply',
    registerHook: (_event: HookEvent, handler: HookHandler) => {
      captured = handler;
    },
    messages: { reply, sendText: jest.fn() },
    storage: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    },
    logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as PluginContext;
  return { context, getHandler: () => captured as HookHandler };
}

function inbound(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg-1',
    from: '628@c.us',
    to: 'me',
    chatId: '628@c.us',
    body: 'ping',
    type: 'text',
    timestamp: 1,
    fromMe: false,
    isGroup: false,
    ...overrides,
  };
}

function ctxFor(data: IncomingMessage): HookContext<IncomingMessage> {
  return { event: 'message:received', data, sessionId: 'sess-1', timestamp: new Date(), source: 'Engine' };
}

/** Mocka o Ollama (a resposta da IA usada pelo plugin). */
function mockOllama(content: string): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message: { content } }),
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('AutoReplyPlugin', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('responde uma vez (após o debounce) usando a resposta da IA e guarda no histórico', async () => {
    jest.useFakeTimers();
    mockOllama('Olá! Como posso ajudar?');
    const reply = jest.fn().mockResolvedValue({ messageId: 'x', timestamp: 1 });
    const { context, getHandler } = makeContext(reply);
    await new AutoReplyPlugin().onEnable(context);

    const result = await getHandler()(ctxFor(inbound()));

    // Resposta é adiada (debounce): não envia de imediato.
    expect(result).toEqual({ continue: true });
    expect(reply).not.toHaveBeenCalled();

    // Passado o tempo de agrupamento, envia UMA resposta.
    await jest.advanceTimersByTimeAsync(4000);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith('sess-1', '628@c.us', 'msg-1', 'Olá! Como posso ajudar?');
    expect((context.storage.set as jest.Mock)).toHaveBeenCalled();
  });

  it('agrupa mensagens em rajada e responde apenas UMA vez', async () => {
    jest.useFakeTimers();
    mockOllama('uma resposta só');
    const reply = jest.fn().mockResolvedValue({ messageId: 'x', timestamp: 1 });
    const { context, getHandler } = makeContext(reply);
    await new AutoReplyPlugin().onEnable(context);

    await getHandler()(ctxFor(inbound({ id: 'm1', body: 'oi' })));
    await getHandler()(ctxFor(inbound({ id: 'm2', body: 'boa tarde' })));
    await getHandler()(ctxFor(inbound({ id: 'm3', body: 'tudo bem?' })));

    await jest.advanceTimersByTimeAsync(4000);

    expect(reply).toHaveBeenCalledTimes(1);
    // Responde ao id da última mensagem da rajada.
    expect(reply).toHaveBeenCalledWith('sess-1', '628@c.us', 'm3', 'uma resposta só');
  });

  it('does NOT reply to its own outgoing messages (fromMe)', async () => {
    const reply = jest.fn();
    const { context, getHandler } = makeContext(reply);
    await new AutoReplyPlugin().onEnable(context);

    const result = await getHandler()(ctxFor(inbound({ fromMe: true })));

    expect(reply).not.toHaveBeenCalled();
    expect(result).toEqual({ continue: true });
  });

  it('does NOT reply to group messages', async () => {
    const reply = jest.fn();
    const { context, getHandler } = makeContext(reply);
    await new AutoReplyPlugin().onEnable(context);

    const result = await getHandler()(ctxFor(inbound({ isGroup: true })));

    expect(reply).not.toHaveBeenCalled();
    expect(result).toEqual({ continue: true });
  });

  it('does NOT reply when the message did not originate from the engine', async () => {
    const reply = jest.fn();
    const { context, getHandler } = makeContext(reply);
    await new AutoReplyPlugin().onEnable(context);

    const result = await getHandler()({ ...ctxFor(inbound()), source: 'API' });

    expect(reply).not.toHaveBeenCalled();
    expect(result).toEqual({ continue: true });
  });
});
