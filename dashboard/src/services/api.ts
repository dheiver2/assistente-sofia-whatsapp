// API Service Layer for OpenWA Dashboard
// Centralized API client with TypeScript types

// Resolve the API base URL. By default this is the same-origin relative path '/api',
// correct when the dashboard and API are served from the same origin (the default
// single-container setup). For a split-origin deployment (dashboard hosted separately
// from the API), set VITE_API_URL at build time to the API ORIGIN — e.g.
// `VITE_API_URL=https://gateway.example.com` — and the '/api' prefix is appended here.
// Previously VITE_API_URL was documented but never read, so the dashboard always called
// same-origin '/api' and a split deployment failed with "Invalid API Key" (#91).
// Exported so direct fetches (e.g. auth/validate in Login.tsx / App.tsx) honor VITE_API_URL
// too — otherwise split-origin deployments break. Empty VITE_API_URL → '/api'.
export const API_BASE_URL = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api`;

// =============================================================================
// Types
// =============================================================================

export interface Session {
  id: string;
  name: string;
  status: 'created' | 'idle' | 'initializing' | 'connecting' | 'qr_ready' | 'ready' | 'disconnected' | 'failed';
  phone?: string;
  pushName?: string;
  lastActive?: string;
  createdAt: string;
  updatedAt: string;
  /** Human-readable reason for the most recent terminal engine failure (set only when status is 'failed'). */
  lastError?: string | null;
}

export interface SessionStats {
  total: number;
  active: number;
  ready: number;
  disconnected: number;
  byStatus: Record<string, number>;
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
}

export interface Webhook {
  id: string;
  sessionId: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplate {
  id: string;
  sessionId: string;
  name: string;
  body: string;
  header?: string | null;
  footer?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplatePayload {
  name: string;
  body: string;
  header?: string | null;
  footer?: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  role: 'admin' | 'operator' | 'viewer';
  allowedIps?: string[];
  allowedSessions?: string[];
  isActive: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  createdAt: string;
  apiKey?: string; // Only returned on creation
}

export interface AuditLog {
  id: string;
  action: string;
  severity: 'info' | 'warn' | 'error';
  apiKeyId?: string;
  apiKeyName?: string;
  sessionId?: string;
  sessionName?: string;
  ipAddress?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  errorMessage?: string;
  createdAt: string;
}

export interface MessageResponse {
  messageId: string;
  timestamp: number;
}

// Chat summary returned by GET /sessions/:id/chats (mirrors the backend ChatSummary).
export interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  lastMessage?: string;
}

// Engine-neutral message types (mirrors the backend's IWhatsAppEngine MessageType). The backend
// normalizes raw engine tokens at the adapter boundary (#265/#270), so persisted rows, the
// message.received/sent payloads, and the websocket all use these values.
export const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'revoked',
  'unknown',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Coerce an arbitrary string (e.g. a raw websocket payload field) to a known MessageType. */
export function asMessageType(value: string | undefined): MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(value ?? '') ? (value as MessageType) : 'unknown';
}

export interface ChatMessage {
  id: string;
  waMessageId?: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  type: MessageType;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: number;
  createdAt: string;
  metadata?: {
    media?: { mimetype: string; filename?: string; data?: string };
    quotedMessage?: { id: string; body: string };
    reactions?: Record<string, string>;
  };
}

export interface SendMediaPayload {
  base64?: string;
  url?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp?: string;
  details?: {
    database?: { status: string };
    redis?: { status: string };
    queue?: { status: string };
  };
}

export interface InfraStatus {
  database: { connected: boolean; type: string; host: string };
  redis: { connected: boolean; host: string; port: number };
  queue: {
    enabled: boolean;
    messages: { pending: number; completed: number; failed: number };
    webhooks: { pending: number; completed: number; failed: number };
  };
  storage: { type: 'local' | 's3'; path?: string; bucket?: string };
  engine: { type: string; headless: boolean };
}

// Saved infrastructure config (from data/.env.generated) used to hydrate the form.
// Secrets are never returned — `*Set` flags indicate whether a value is stored.
export interface SavedConfig {
  database: {
    type: 'sqlite' | 'postgres';
    builtIn: boolean;
    host: string;
    port: string;
    username: string;
    database: string;
    poolSize: number;
    sslEnabled: boolean;
    sslRejectUnauthorized: boolean;
    passwordSet: boolean;
  };
  redis: { enabled: boolean; builtIn: boolean; host: string; port: string; passwordSet: boolean };
  queue: { enabled: boolean };
  storage: {
    type: 'local' | 's3';
    builtIn: boolean;
    localPath: string;
    s3Bucket: string;
    s3Region: string;
    s3Endpoint: string;
    s3CredentialsSet: boolean;
  };
  engine: { headless: boolean; sessionDataPath: string; browserArgs: string };
}

export interface SaveConfigPayload {
  database?: {
    type: 'sqlite' | 'postgres';
    builtIn?: boolean;
    host?: string;
    port?: string;
    username?: string;
    password?: string;
    database?: string;
    poolSize?: number;
    sslEnabled?: boolean;
    sslRejectUnauthorized?: boolean;
  };
  redis?: {
    enabled?: boolean;
    builtIn?: boolean;
    host?: string;
    port?: string;
    password?: string;
  };
  queue?: {
    enabled?: boolean;
  };
  storage?: {
    type: 'local' | 's3';
    builtIn?: boolean;
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3Endpoint?: string;
  };
  engine?: {
    headless?: boolean;
    sessionDataPath?: string;
    browserArgs?: string;
  };
}

export interface Settings {
  general: { apiBaseUrl: string; sessionTimeout: number; autoReconnect: boolean; debugMode: boolean };
  api: { rateLimit: number; rateLimitWindow: number; enableDocs: boolean };
  notifications: { emailEnabled: boolean; notificationEmail: string; webhookAlerts: boolean };
}

// =============================================================================
// API Client
// =============================================================================

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Get API key from sessionStorage for authentication
  const apiKey = sessionStorage.getItem('openwa_api_key');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // The stored API key is invalid/expired/revoked — clear it and return to login
    // so the user isn't stuck on a dashboard that 401s every request.
    sessionStorage.removeItem('openwa_api_key');
    if (typeof window !== 'undefined') {
      window.location.assign('/');
      // The page is navigating away — halt this request's promise chain so callers neither
      // throw the generic error below (flashing a toast) nor receive an undefined payload.
      return new Promise<T>(() => {});
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// =============================================================================
// Session API
// =============================================================================

export const sessionApi = {
  list: () => request<Session[]>('/sessions'),
  get: (id: string) => request<Session>(`/sessions/${id}`),
  create: (name: string) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  start: (id: string) => request<Session>(`/sessions/${id}/start`, { method: 'POST' }),
  stop: (id: string) => request<Session>(`/sessions/${id}/stop`, { method: 'POST' }),
  logout: (id: string) => request<Session>(`/sessions/${id}/logout`, { method: 'POST' }),
  forceKill: (id: string) => request<Session>(`/sessions/${id}/force-kill`, { method: 'POST' }),
  getQR: (id: string) => request<{ qrCode: string; status: string }>(`/sessions/${id}/qr`),
  getStats: () => request<SessionStats>('/sessions/stats/overview'),
  getGroups: (id: string) =>
    request<{ id: string; name: string; linkedParentJID?: string | null }[]>(`/sessions/${id}/groups`),
  getChats: (id: string) => request<Chat[]>(`/sessions/${id}/chats`),
  markChatRead: (id: string, chatId: string) =>
    request<{ success: boolean }>(`/sessions/${id}/chats/read`, {
      method: 'POST',
      body: JSON.stringify({ chatId }),
    }),
  getChatMessages: (id: string, chatId: string, limit = 100) =>
    request<{ messages: ChatMessage[]; total: number }>(
      `/sessions/${id}/messages?chatId=${encodeURIComponent(chatId)}&limit=${limit}`,
    ),
  setChatStatus: (sessionId: string, chatId: string, status: 'open' | 'pending' | 'resolved') =>
    request<{ success: boolean }>(`/sessions/${sessionId}/chats/${encodeURIComponent(chatId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }).catch(() => null),
  getAi: (id: string) => request<AiConfig>(`/sessions/${id}/ai`),
  updateAi: (id: string, config: AiConfig) =>
    request<AiConfig>(`/sessions/${id}/ai`, { method: 'PUT', body: JSON.stringify(config) }),
};

// AI attendant config per session (one company = one session).
export interface BusinessHours {
  enabled?: boolean;
  timezone?: string;
  /** day (mon..sun) -> { start, end } in "HH:MM", or false when closed that day. */
  schedule?: Record<string, { start: string; end: string } | false>;
  outsideMessage?: string;
}

export interface AiConfig {
  enabled?: boolean;
  persona?: string;
  knowledge?: string;
  model?: string;
  greeting?: string;
  businessHours?: BusinessHours;
}

// ===== Sales Engine (Motor de Vendas) =====
export interface SalesLead {
  name?: string;
  phone?: string;
  attributes: Record<string, unknown>;
}
export interface LeadSource {
  id: string;
  sessionId: string;
  name: string;
  type: 'postgres' | 'inline';
  config: Record<string, unknown>;
  createdAt: string;
}
export interface Campaign {
  id: string;
  sessionId: string;
  name: string;
  offerHint: string | null;
  leadSourceId: string | null;
  status: string;
  ratePerMinute: number;
  crmWebhookUrl: string | null;
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | 'document' | 'audio' | null;
  scheduledAt?: string;
  createdAt: string;
}
export interface Outreach {
  id: string;
  campaignId: string;
  sessionId: string;
  leadName: string | null;
  phone: string | null;
  attributes: Record<string, unknown>;
  need: string;
  score: number;
  message: string;
  stage: string;
  error: string | null;
}

export interface OptOut {
  id: string;
  sessionId: string;
  phone: string;
  createdAt: string;
}

export const salesApi = {
  listSources: (sessionId: string) => request<LeadSource[]>(`/sales/sources?sessionId=${sessionId}`),
  createSource: (body: Partial<LeadSource>) =>
    request<LeadSource>('/sales/sources', { method: 'POST', body: JSON.stringify(body) }),
  testSource: (id: string) => request<{ ok: boolean; message: string }>(`/sales/sources/${id}/test`, { method: 'POST' }),
  deleteSource: (id: string) => request<void>(`/sales/sources/${id}`, { method: 'DELETE' }),

  listCampaigns: (sessionId: string) => request<Campaign[]>(`/sales/campaigns?sessionId=${sessionId}`),
  createCampaign: (body: Partial<Campaign>) =>
    request<Campaign>('/sales/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  deleteCampaign: (id: string) => request<void>(`/sales/campaigns/${id}`, { method: 'DELETE' }),
  generate: (id: string, leads?: SalesLead[]) =>
    request<Outreach[]>(`/sales/campaigns/${id}/generate`, { method: 'POST', body: JSON.stringify({ leads }) }),
  listOutreach: (id: string) => request<Outreach[]>(`/sales/campaigns/${id}/outreach`),
  updateOutreach: (id: string, body: { message?: string; stage?: string }) =>
    request<Outreach>(`/sales/outreach/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  send: (id: string) => request<{ approved: number }>(`/sales/campaigns/${id}/send`, { method: 'POST' }),
  metrics: (id: string) => request<Record<string, number>>(`/sales/campaigns/${id}/metrics`),

  listOptOuts: (sessionId: string) => request<OptOut[]>(`/sales/opt-out?sessionId=${sessionId}`),
  removeOptOut: (id: string) => request<{ ok: boolean }>(`/sales/opt-out/${id}`, { method: 'DELETE' }),

  autoRun: (id: string, leads?: SalesLead[]) =>
    request<{ generated: number; approved: number }>(`/sales/campaigns/${id}/auto-run`, {
      method: 'POST',
      body: JSON.stringify({ leads }),
    }),
  attachMedia: (id: string, mediaUrl: string, mediaType: string) =>
    request<Campaign>(`/sales/campaigns/${id}/media`, { method: 'PUT', body: JSON.stringify({ mediaUrl, mediaType }) }),
  pause: (id: string) => request<{ ok: boolean }>(`/sales/campaigns/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => request<{ ok: boolean }>(`/sales/campaigns/${id}/resume`, { method: 'POST' }),
  progress: (id: string) =>
    request<{ sent: number; approved: number; pending: number; failed: number; total: number; etaMinutes: number; rate: number; status: string }>(
      `/sales/campaigns/${id}/progress`,
    ),
  report: (id: string) => request<Record<string, unknown>>(`/sales/campaigns/${id}/report`),
};

// =============================================================================
// Webhook API
// =============================================================================

export const webhookApi = {
  listBySession: (sessionId: string) => request<Webhook[]>(`/sessions/${sessionId}/webhooks`),
  listAll: () => request<Webhook[]>('/webhooks'),
  get: (sessionId: string, id: string) => request<Webhook>(`/sessions/${sessionId}/webhooks/${id}`),
  create: (sessionId: string, data: { url: string; events: string[] }) =>
    request<Webhook>(`/sessions/${sessionId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (sessionId: string, id: string, data: Partial<Webhook>) =>
    request<Webhook>(`/sessions/${sessionId}/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (sessionId: string, id: string) =>
    request<void>(`/sessions/${sessionId}/webhooks/${id}`, { method: 'DELETE' }),
  test: (sessionId: string, id: string) =>
    request<{ success: boolean; statusCode?: number; error?: string }>(`/sessions/${sessionId}/webhooks/${id}/test`, {
      method: 'POST',
    }),
};

// =============================================================================
// Template API
// =============================================================================

export const templateApi = {
  list: (sessionId: string) => request<MessageTemplate[]>(`/sessions/${sessionId}/templates`),
  get: (sessionId: string, id: string) => request<MessageTemplate>(`/sessions/${sessionId}/templates/${id}`),
  create: (sessionId: string, data: TemplatePayload) =>
    request<MessageTemplate>(`/sessions/${sessionId}/templates`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (sessionId: string, id: string, data: Partial<TemplatePayload>) =>
    request<MessageTemplate>(`/sessions/${sessionId}/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (sessionId: string, id: string) =>
    request<void>(`/sessions/${sessionId}/templates/${id}`, { method: 'DELETE' }),
};

// =============================================================================
// Contact API
// =============================================================================

export interface CheckNumberResponse {
  number: string;
  exists: boolean;
  /** Engine-canonical WhatsApp id for the number (e.g. `…@c.us` or `…@lid`), or null if unregistered. */
  whatsappId: string | null;
}

export const contactApi = {
  checkNumber: (sessionId: string, number: string) =>
    request<CheckNumberResponse>(`/sessions/${sessionId}/contacts/check/${encodeURIComponent(number)}`),
};

// =============================================================================
// Orders API (Pedidos)
// =============================================================================

export interface OrderItem {
  produto: string;
  qtd: number;
  preco: number;
  origem?: 'pedido' | 'recomendacao';
}

export type OrderStatus = 'novo' | 'confirmado' | 'concluido' | 'cancelado';

export interface Order {
  id: string;
  sessionId: string;
  phone: string;
  customerName: string | null;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  source: 'conversa' | 'historico-bi' | 'manual';
  reference: string | null;
  notes: string | null;
  placedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ordersApi = {
  list: (
    sessionId: string,
    params: { status?: string; source?: string; search?: string; sort?: string; order?: string; take?: number } = {},
  ) =>
    request<Order[]>(
      `/orders?${new URLSearchParams({
        sessionId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.search ? { search: params.search } : {}),
        ...(params.sort ? { sort: params.sort } : {}),
        ...(params.order ? { order: params.order } : {}),
        ...(params.take ? { take: String(params.take) } : {}),
      }).toString()}`,
    ),
  stats: (sessionId: string) =>
    request<Record<string, number>>(`/orders/stats?sessionId=${encodeURIComponent(sessionId)}`),
  byPhone: (sessionId: string, phone: string) =>
    request<Order[]>(`/orders/phone/${encodeURIComponent(phone)}?sessionId=${encodeURIComponent(sessionId)}`),
  create: (data: { sessionId: string; phone: string; customerName?: string; items: OrderItem[]; notes?: string }) =>
    request<Order>('/orders', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { status?: OrderStatus; items?: OrderItem[]; notes?: string }) =>
    request<Order>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/orders/${id}`, { method: 'DELETE' }),
};

// =============================================================================
// API Key API
// =============================================================================

export const apiKeyApi = {
  list: () => request<ApiKey[]>('/auth/api-keys'),
  get: (id: string) => request<ApiKey>(`/auth/api-keys/${id}`),
  create: (data: {
    name: string;
    role: string;
    allowedIps?: string[];
    allowedSessions?: string[];
    expiresAt?: string;
  }) =>
    request<ApiKey>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<ApiKey>) =>
    request<ApiKey>(`/auth/api-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/auth/api-keys/${id}`, { method: 'DELETE' }),
  revoke: (id: string) => request<ApiKey>(`/auth/api-keys/${id}/revoke`, { method: 'POST' }),
};

// =============================================================================
// Audit/Logs API
// =============================================================================

export const auditApi = {
  list: (params?: { action?: string; severity?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const queryStr = query.toString();
    return request<{ data: AuditLog[]; total: number }>(`/audit${queryStr ? `?${queryStr}` : ''}`);
  },
};

// =============================================================================
// Message API
// =============================================================================

export const messageApi = {
  sendText: (sessionId: string, chatId: string, text: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-text`, {
      method: 'POST',
      body: JSON.stringify({ chatId, text }),
    }),
  sendImage: (sessionId: string, chatId: string, url: string, caption?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-image`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, caption }),
    }),
  sendVideo: (sessionId: string, chatId: string, url: string, caption?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-video`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, caption }),
    }),
  sendAudio: (sessionId: string, chatId: string, url: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-audio`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url }),
    }),
  sendDocument: (sessionId: string, chatId: string, url: string, filename?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-document`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, filename }),
    }),
  sendMedia: (
    sessionId: string,
    chatId: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    payload: SendMediaPayload,
  ) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-${mediaType}`, {
      method: 'POST',
      body: JSON.stringify({ chatId, ...payload }),
    }),
  reply: (sessionId: string, data: { chatId: string; quotedMessageId: string; text: string }) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/reply`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  react: (sessionId: string, data: { chatId: string; messageId: string; emoji: string }) =>
    request<void>(`/sessions/${sessionId}/messages/react`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendTemplate: (
    sessionId: string,
    data: { chatId: string; templateId?: string; templateName?: string; variables?: Record<string, string> },
  ) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-template`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (sessionId: string, data: { chatId: string; messageId: string; forEveryone?: boolean }) =>
    request<void>(`/sessions/${sessionId}/messages/delete`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// =============================================================================
// Health & Infrastructure API
// =============================================================================

export const healthApi = {
  check: () => request<HealthStatus>('/health'),
  ready: () => request<HealthStatus>('/health/ready'),
};

export const infraApi = {
  getStatus: () => request<InfraStatus>('/infra/status'),
  getConfig: () => request<SavedConfig>('/infra/config'),
  updateConfig: (config: Partial<InfraStatus>) =>
    request<InfraStatus>('/infra/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  saveConfig: (config: SaveConfigPayload) =>
    request<{ message: string; saved: boolean; envPath: string; profiles: string[] }>('/infra/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  restart: (profiles?: string[], profilesToRemove?: string[]) =>
    request<{
      message: string;
      restarting: boolean;
      profiles: string[];
      profilesToRemove: string[];
      estimatedTime: number;
    }>('/infra/restart', {
      method: 'POST',
      body: JSON.stringify({ profiles: profiles || [], profilesToRemove: profilesToRemove || [] }),
    }),
  healthCheck: () => request<{ status: string; timestamp: string }>('/infra/health'),
};

// =============================================================================
// Settings API
// =============================================================================

export const settingsApi = {
  get: () => request<Settings>('/settings'),
  update: (settings: Partial<Settings>) =>
    request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};

// =============================================================================
// Plugin Types
// =============================================================================

/** Field definition within a plugin's config schema (mirrors the backend PluginConfigSchema). */
export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  required?: boolean;
  secret?: boolean;
}

export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigField>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  type: 'engine' | 'storage' | 'queue' | 'auth' | 'extension';
  description?: string;
  author?: string;
  status: 'installed' | 'enabled' | 'disabled' | 'error';
  config: Record<string, unknown>;
  builtIn: boolean;
  provides: string[];
  /** Declared config fields, when the plugin exposes a schema (drives the dashboard config form). */
  configSchema?: PluginConfigSchema;
  loadedAt?: string;
  enabledAt?: string;
  error?: string;
}

export interface Engine {
  id: string;
  name: string;
  enabled: boolean;
  features: string[];
  /** Underlying engine library (e.g. whatsapp-web.js 1.34.7), distinct from the adapter version. */
  library?: { name: string; version: string };
}

// =============================================================================
// Plugins API
// =============================================================================

export const pluginsApi = {
  list: () => request<Plugin[]>('/plugins'),
  get: (id: string) => request<Plugin>(`/plugins/${id}`),
  enable: (id: string) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/enable`, {
      method: 'POST',
    }),
  disable: (id: string) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/disable`, {
      method: 'POST',
    }),
  updateConfig: (id: string, config: Record<string, unknown>) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  healthCheck: (id: string) => request<{ healthy: boolean; message?: string }>(`/plugins/${id}/health`),
  getEngines: () => request<Engine[]>('/infra/engines'),
  getCurrentEngine: () => request<{ engineType: string }>('/infra/engines/current'),
};

// =============================================================================
// Contacts API
// =============================================================================

export interface Contact {
  id: string;
  sessionId: string;
  phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  status: 'active' | 'blocked' | 'opted_out';
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Recommendations API
// =============================================================================

export interface CatalogProduct {
  id: string;
  sessionId?: string;
  name: string;
  category?: string;
  description?: string;
  price?: number;
  keywords?: string[];
  tags?: string[];
  imageUrl?: string;
  videoUrl?: string;
  documentUrl?: string;
  thumbnailUrl?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProductPayload {
  name: string;
  category?: string;
  description?: string;
  price?: number;
  keywords?: string[];
  tags?: string[];
  imageUrl?: string;
  videoUrl?: string;
  documentUrl?: string;
  thumbnailUrl?: string;
  active?: boolean;
}

export interface CustomerInsight {
  summary: string;
  interests?: string[];
  intent?: string;
}

export interface ProductRecommendation {
  id: string;
  sessionId: string;
  phone: string;
  productId: string;
  productName: string;
  score: number;
  message: string;
  mediaType?: 'image' | 'video' | 'document' | null;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
}

export interface AnalyzeResult {
  customerInsight: CustomerInsight;
  recommendations: ProductRecommendation[];
}

export interface BatchResult {
  generated: number;
  details?: ProductRecommendation[];
}

export const recommendationsApi = {
  // Catalog
  listProducts: () => request<CatalogProduct[]>('/recommendations/catalog'),
  createProduct: (data: CatalogProductPayload) =>
    request<CatalogProduct>('/recommendations/catalog', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: string, data: Partial<CatalogProductPayload>) =>
    request<CatalogProduct>(`/recommendations/catalog/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id: string) => request<void>(`/recommendations/catalog/${id}`, { method: 'DELETE' }),

  // Analysis
  analyze: (sessionId: string, phone: string, topN = 3) =>
    request<AnalyzeResult>('/recommendations/analyze', {
      method: 'POST',
      body: JSON.stringify({ sessionId, phone, topN }),
    }),
  batch: (sessionId: string, phones: string[], topN = 3) =>
    request<BatchResult>('/recommendations/batch', {
      method: 'POST',
      body: JSON.stringify({ sessionId, phones, topN }),
    }),

  // Pending recommendations
  listPending: (sessionId: string) =>
    request<ProductRecommendation[]>(`/recommendations/pending?sessionId=${encodeURIComponent(sessionId)}`),
  deliver: (id: string) =>
    request<{ ok: boolean }>(`/recommendations/${id}/deliver`, { method: 'POST' }),
  deliverBatch: (sessionId: string, phone: string) =>
    request<{ sent: number }>('/recommendations/deliver-batch', {
      method: 'POST',
      body: JSON.stringify({ sessionId, phone }),
    }),
  deletePending: (id: string) => request<void>(`/recommendations/${id}`, { method: 'DELETE' }),
  deliverAll: (sessionId: string) =>
    request<{ sent: number }>('/recommendations/deliver-all', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
};

export const contactsApi = {
  list: (sessionId: string, tag?: string, search?: string) =>
    request<Contact[]>(`/contacts?${new URLSearchParams({
      sessionId,
      ...(tag ? { tag } : {}),
      ...(search ? { search } : {}),
    }).toString()}`),
  upsert: (data: { sessionId: string; phone: string; name?: string; tags?: string[]; notes?: string }) =>
    request<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  addTag: (id: string, tag: string) =>
    request<Contact>(`/contacts/${id}/tags/${encodeURIComponent(tag)}`, { method: 'PUT' }),
  removeTag: (id: string, tag: string) =>
    request<Contact>(`/contacts/${id}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),
  delete: (id: string) =>
    request<void>(`/contacts/${id}`, { method: 'DELETE' }),
};
