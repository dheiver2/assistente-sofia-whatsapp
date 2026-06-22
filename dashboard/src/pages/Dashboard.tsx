import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Send, Webhook, Activity, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
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

function OnboardStep({ done, label, link, linkLabel, hint }: { done: boolean; label: string; link: string; linkLabel: string; hint?: string }) {
  return (
    <div className={`onboard-step ${done ? 'done' : ''}`}>
      <span className="onboard-check">{done ? '✅' : '⬜'}</span>
      <div className="onboard-step-body">
        <span className="onboard-step-label">{label}</span>
        {hint && <span className="onboard-step-hint">{hint}</span>}
      </div>
      {!done && (
        <a href={link} className="onboard-link">{linkLabel}</a>
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
      trend: `+${stats?.ready ?? 0}`,
      trendUp: true,
    },
    { label: t('dashboard.stats.messagesToday'), value: '—', icon: Send, trend: '0', trendUp: null },
    { label: t('dashboard.stats.webhooksConfigured'), value: webhookCount, icon: Webhook, trend: '0', trendUp: null },
    { label: t('dashboard.stats.apiCalls'), value: '—', icon: Activity, trend: '0', trendUp: null },
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
        {statsCards.map(({ label, value, icon: Icon, trend, trendUp }) => (
          <div key={label} className="stat-card">
            <Icon className="stat-watermark" />
            <div className="stat-header">
              <span className="stat-label">{label}</span>
              <Icon size={20} className="stat-icon" />
            </div>
            <div className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
            {trend !== '0' && (
              <div className={`stat-trend ${trendUp ? 'up' : 'down'}`}>
                {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {trend}
              </div>
            )}
          </div>
        ))}
      </div>

      {!onboardDone && (
        <div className="onboard-card">
          <div className="onboard-header">
            <span className="onboard-title">🚀 Primeiros passos — configure em minutos</span>
            <span className="onboard-sub">{Object.values(onboard).filter(Boolean).length} de 4 concluídos</span>
          </div>
          <div className="onboard-steps">
            <OnboardStep done={onboard.session} label="Conectar sessão WhatsApp" link="/sessoes" linkLabel="Criar sessão →" />
            <OnboardStep done={onboard.ai} label="Configurar assistente de IA" link="/sessoes" linkLabel="Configurar →" hint="Aba IA na sessão criada" />
            <OnboardStep done={onboard.message} label="Enviar primeira mensagem" link="/conversas" linkLabel="Ir para Conversas →" />
            <OnboardStep done={onboard.campaign} label="Lançar primeira campanha" link="/campanhas" linkLabel="Ir para Campanhas →" />
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

        <div className="sessions-table">
          <div className="table-header">
            <span>{t('dashboard.columns.sessionId')}</span>
            <span>{t('dashboard.columns.phone')}</span>
            <span>{t('dashboard.columns.status')}</span>
            <span>{t('dashboard.columns.lastActive')}</span>
            <span>{t('dashboard.columns.actions')}</span>
          </div>
          {sessions.length === 0 ? (
            <div className="table-row" style={{ justifyContent: 'center', color: 'var(--text-muted)' }}>
              {t('dashboard.noSessions')}
            </div>
          ) : (
            sessions.map(session => (
              <div key={session.id} className="table-row">
                <div className="session-info-cell">
                  <span className="session-id">{session.id.substring(0, 12)}</span>
                  <span className="session-name" title={session.name}>
                    {session.name}
                  </span>
                </div>
                <span className="phone">{session.phone || '—'}</span>
                <span className={`status-pill ${session.status}`}>{formatStatus(session.status)}</span>
                <span className="last-active">{formatLastActive(session.lastActive)}</span>
                <div className="actions">
                  <button className="btn-sm" onClick={() => navigate('/sessions')}>
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
            ))
          )}
        </div>
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
