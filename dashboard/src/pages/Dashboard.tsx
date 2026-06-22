import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Send, Webhook, Activity, Loader2, MessagesSquare, Megaphone, Smartphone, ArrowRight } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSessionsQuery, useSessionStatsQuery, useWebhooksQuery, useStopSessionMutation } from '../hooks/queries';
import { sessionApi } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import './Dashboard.css';

const USE_CASES = [
  {
    icon: '🔄',
    title: 'Reativação de clientes inativos',
    desc: 'Identifique clientes que não compram há 30+ dias e envie mensagens personalizadas com IA para reconquistar.',
    steps: [
      'Conecte sua base Postgres (host.docker.internal:5433 banco leads_demo) em Vendas → Fontes de Leads',
      'Crie campanha com objetivo "Reativar clientes inativos" — selecione modelo Reativação',
      'Faça upload da planilha ou use a fonte Postgres com query: SELECT * FROM leads_inativos',
      'Clique Lançar — a IA gera e envia mensagens personalizadas automaticamente',
    ],
    result: '15-30% de taxa de reativação com conversa contínua até o fechamento',
  },
  {
    icon: '🏥',
    title: 'Lembretes de consulta automáticos',
    desc: 'Clínicas e consultórios enviam lembretes 24h antes da consulta e confirmam presença automaticamente.',
    steps: [
      'Crie uma sessão WhatsApp em Sessões e configure a IA com persona "Clínica"',
      'Em Templates, importe da Biblioteca o modelo "lembrete-consulta"',
      'Integre via webhook POST /sessions/{id}/messages/send-template com os dados da consulta',
      'A IA responde confirmações e reagendamentos automaticamente',
    ],
    result: 'Redução de 60% no no-show e agenda mais organizada',
  },
  {
    icon: '🛒',
    title: 'Recuperação de carrinho abandonado',
    desc: 'E-commerces recuperam vendas enviando mensagens personalizadas para quem abandonou o carrinho.',
    steps: [
      'Configure webhook no seu e-commerce para disparar ao abandono de carrinho',
      'O webhook chama POST /api/sessions/{id}/messages/send-template com template "carrinho-abandonado"',
      'A IA mantém a conversa e responde dúvidas sobre o produto automaticamente',
      'Webhook recebe evento de "replied" e notifica sua equipe de vendas',
    ],
    result: 'Recuperação de 10-25% dos carrinhos abandonados',
  },
  {
    icon: '💅',
    title: 'Agendamento automático (salão/clínica)',
    desc: 'Clientes enviam mensagem pedindo horário e a IA verifica disponibilidade e confirma o agendamento.',
    steps: [
      'Configure sessão com persona "Beleza" — a IA conhece todos os serviços e preços',
      'Importe templates: confirmacao-agendamento e lembrete-beleza da Biblioteca',
      'Conecte webhook ao seu sistema de agendamento (Calendly, SimplyBook, sistema próprio)',
      'A IA agenda, confirma e lembra automaticamente — 24h antes envia lembrete',
    ],
    result: 'Agenda 100% preenchida com zero esforço manual',
  },
  {
    icon: '🏠',
    title: 'Captação e nutrição de leads imobiliários',
    desc: 'Corretores qualificam leads automaticamente e enviam imóveis compatíveis com o perfil do cliente.',
    steps: [
      'Configure sessão com persona "Imobiliária" para qualificação inicial automática',
      'A IA pergunta: localização, quartos, orçamento, compra ou aluguel',
      'Webhook envia perfil qualificado ao CRM do corretor',
      'Crie campanha com lista de imóveis para nutrição de leads inativos',
    ],
    result: 'Triagem 100% automática e mais tempo do corretor para fechar negócios',
  },
  {
    icon: '💰',
    title: 'Cobrança amigável e negociação',
    desc: 'Régua de cobrança automática com IA que negocia parcelamentos e condições especiais.',
    steps: [
      'Importe template "lembrete-vencimento" da Biblioteca em Templates',
      'Configure campanha com segmento de clientes em atraso da base Postgres',
      'Selecione modelo "Financeiro" — a IA sabe oferecer desconto e parcelamento',
      'Clientes que respondem recebem proposta automática de negociação',
    ],
    result: 'Redução de inadimplência com negociações 24/7 sem equipe',
  },
];

const AVATAR_COLORS = ['#25d366', '#3b82f6', '#f59e0b', '#14b8a6', '#8b5cf6', '#ec4899', '#ef4444', '#0ea5e9'];

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

function avatarColor(key: string): string {
  return AVATAR_COLORS[hashKey(key) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function statusDotColor(status: string): string {
  if (['ready', 'connected', 'open', 'online'].includes(status)) return '#22c55e';
  if (['connecting', 'initializing', 'qr_ready', 'pending'].includes(status)) return '#f59e0b';
  return 'var(--text-muted)';
}

function OnboardStep({ done, label, link, linkLabel, hint, onNavigate }: { done: boolean; label: string; link: string; linkLabel: string; hint?: string; onNavigate: (to: string) => void }) {
  return (
    <div className={`onboard-step ${done ? 'done' : ''}`}>
      <span className="onboard-check">{done ? '✅' : '⬜'}</span>
      <div className="onboard-step-body">
        <span className="onboard-step-label">{label}</span>
        {hint && <span className="onboard-step-hint">{hint}</span>}
      </div>
      {!done && (
        <button type="button" className="onboard-link" onClick={() => onNavigate(link)}>{linkLabel}</button>
      )}
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const navigate = useNavigate();
  const toast = useToast();
  const { data: sessions = [], isLoading: loadingSessions, error: sessionsError } = useSessionsQuery();
  const { data: stats } = useSessionStatsQuery();
  const { data: webhooks = [] } = useWebhooksQuery();
  const stopMutation = useStopSessionMutation();

  // Onboarding state — tracked in localStorage
  const [onboard, setOnboard] = useState({
    session: false,
    ai: localStorage.getItem('onboard_ai') === '1',
    message: localStorage.getItem('onboard_msg') === '1',
    campaign: localStorage.getItem('onboard_camp') === '1',
  });

  // Check session health for onboarding
  useEffect(() => {
    sessionApi.getStats().then(s => {
      if (s.ready > 0) setOnboard(o => ({ ...o, session: true }));
    }).catch(() => {});
  }, []);

  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  const onboardDone = Object.values(onboard).every(Boolean);
  const loading = loadingSessions;
  const error = sessionsError instanceof Error
    ? sessionsError.message
    : sessionsError
      ? t('dashboard.loadError')
      : null;
  const webhookCount = webhooks.length;

  const handleDisconnect = async (id: string) => {
    try {
      await stopMutation.mutateAsync(id);
      toast.success('Sessão desconectada');
    } catch (err) {
      console.error('Failed to disconnect:', err);
      toast.error('Erro ao desconectar', err instanceof Error ? err.message : undefined);
    } finally {
      setDisconnectId(null);
    }
  };

  const statsCards = [
    {
      label: t('dashboard.stats.activeSessions'),
      value: stats?.active ?? 0,
      icon: MessageSquare,
      color: 'var(--primary)',
      hint: `${stats?.ready ?? 0} ${t('common.connected').toLowerCase()}`,
    },
    { label: t('dashboard.stats.messagesToday'), value: '—', icon: Send, color: '#3b82f6', hint: null },
    { label: t('dashboard.stats.webhooksConfigured'), value: webhookCount, icon: Webhook, color: '#f59e0b', hint: null },
    { label: t('dashboard.stats.apiCalls'), value: '—', icon: Activity, color: '#14b8a6', hint: null },
  ];

  const quickActions = [
    { label: t('nav.conversations', { defaultValue: 'Conversas' }), icon: MessagesSquare, to: '/conversas', color: '#3b82f6' },
    { label: t('nav.campaigns', { defaultValue: 'Campanhas' }), icon: Megaphone, to: '/campanhas', color: '#f59e0b' },
    { label: t('nav.sessions', { defaultValue: 'Sessões' }), icon: Smartphone, to: '/sessoes', color: 'var(--primary)' },
  ];

  const formatLastActive = (date?: string) => {
    if (!date) return t('common.never');
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return t('common.justNow');
    if (diff < 3600000) return t('common.minAgo', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('common.hoursAgo', { count: Math.floor(diff / 3600000) });
    return new Date(date).toLocaleDateString();
  };

  const formatStatus = (status: string) => t(`sessionStatus.${status}`, { defaultValue: status });

  if (loading) {
    return (
      <div
        className="dashboard"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard" style={{ padding: '2rem' }}>
        <div style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', padding: '1rem', borderRadius: '8px', color: 'var(--error)', border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)' }}>
          {t('dashboard.errorPrefix', { message: error })}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        badge={
          <span className={`status-badge ${stats && stats.ready > 0 ? 'connected' : 'disconnected'}`}>
            {stats && stats.ready > 0 ? t('common.connected') : t('common.disconnected')}
          </span>
        }
      />

      <div className="stats-grid">
        {statsCards.map(({ label, value, icon: Icon, color, hint }) => (
          <div key={label} className="stat-card">
            <div
              className="stat-chip"
              style={{
                background: `color-mix(in srgb, ${color} 14%, transparent)`,
                color,
              }}
            >
              <Icon size={20} />
            </div>
            <div className="stat-body">
              <div className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
              <span className="stat-label">{label}</span>
              {hint && <span className="stat-hint">{hint}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="quick-actions">
        {quickActions.map(({ label, icon: Icon, to, color }) => (
          <button key={to} className="quick-action" onClick={() => navigate(to)}>
            <span
              className="qa-chip"
              style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
            >
              <Icon size={18} />
            </span>
            <span className="qa-label">{label}</span>
            <ArrowRight size={16} className="qa-arrow" />
          </button>
        ))}
      </div>

      {!onboardDone && (
        <div className="onboard-card">
          <div className="onboard-header">
            <span className="onboard-title">🚀 Primeiros passos — configure em minutos</span>
            <span className="onboard-sub">{Object.values(onboard).filter(Boolean).length} de 4 concluídos</span>
          </div>
          <div className="onboard-steps">
            <OnboardStep done={onboard.session} label="Conectar sessão WhatsApp" link="/sessoes" linkLabel="Criar sessão →" onNavigate={navigate} />
            <OnboardStep done={onboard.ai} label="Configurar assistente de IA" link="/sessoes" linkLabel="Configurar →" hint="Aba IA na sessão criada" onNavigate={navigate} />
            <OnboardStep done={onboard.message} label="Enviar primeira mensagem" link="/conversas" linkLabel="Ir para Conversas →" onNavigate={navigate} />
            <OnboardStep done={onboard.campaign} label="Lançar primeira campanha" link="/campanhas" linkLabel="Ir para Campanhas →" onNavigate={navigate} />
          </div>
        </div>
      )}

      <section className="sessions-section">
        <div className="section-header">
          <h2>{t('dashboard.sessionsOverview')}</h2>
          <span className="section-subtitle">
            {t('dashboard.showingSessions', { shown: sessions.length, total: stats?.total ?? 0 })}
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Smartphone size={28} />
            </div>
            <p className="empty-title">{t('dashboard.noSessions')}</p>
            <button className="empty-cta" onClick={() => navigate('/sessoes')}>
              {t('dashboard.view')}
              <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <div className="session-list">
            {sessions.map(session => (
              <div key={session.id} className="session-row">
                <div className="session-avatar-wrap">
                  <span className="session-avatar" style={{ background: avatarColor(session.id) }}>
                    {initials(session.name || session.id)}
                  </span>
                  <span className="session-status-dot" style={{ background: statusDotColor(session.status) }} />
                </div>
                <div className="session-main">
                  <span className="session-name" title={session.name}>{session.name || session.id.substring(0, 12)}</span>
                  <span className="session-meta">
                    {session.phone || session.id.substring(0, 12)} · {formatLastActive(session.lastActive)}
                  </span>
                </div>
                <span
                  className="status-pill"
                  style={{
                    background: `color-mix(in srgb, ${statusDotColor(session.status)} 14%, transparent)`,
                    color: statusDotColor(session.status),
                  }}
                >
                  {formatStatus(session.status)}
                </span>
                <div className="actions">
                  <button className="btn-sm" onClick={() => navigate('/sessoes')}>
                    {t('dashboard.view')}
                  </button>
                  {['ready', 'initializing', 'connecting', 'qr_ready'].includes(session.status) && (
                    <button
                      className="btn-sm danger"
                      onClick={() => setDisconnectId(session.id)}
                      disabled={stopMutation.isPending}
                    >
                      {stopMutation.isPending && disconnectId === session.id
                        ? t('common.loading')
                        : t('dashboard.disconnect')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Casos de uso reais ── */}
      <div className="use-cases-section">
        <h2 className="use-cases-title">🚀 Casos de uso reais — comece em 3 passos</h2>
        <div className="use-cases-grid">
          {USE_CASES.map(uc => (
            <div key={uc.title} className="use-case-card">
              <div className="uc-icon">{uc.icon}</div>
              <div className="uc-content">
                <h3>{uc.title}</h3>
                <p>{uc.desc}</p>
                <ol className="uc-steps">
                  {uc.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <div className="uc-result">
                  <span className="uc-result-label">Resultado esperado:</span> {uc.result}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={disconnectId !== null}
        title={t('dashboard.disconnect')}
        message="Tem certeza que deseja desconectar esta sessão do WhatsApp?"
        warning="A sessão ativa será encerrada e será necessário escanear o QR Code novamente para reconectar."
        confirmLabel={t('dashboard.disconnect')}
        cancelLabel={t('common.cancel')}
        danger
        busy={stopMutation.isPending}
        onConfirm={() => disconnectId && handleDisconnect(disconnectId)}
        onCancel={() => setDisconnectId(null)}
      />
    </div>
  );
}
