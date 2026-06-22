import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Send, Webhook, Activity, Loader2, MessagesSquare, Megaphone, Smartphone, ArrowRight } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSessionsQuery, useSessionStatsQuery, useWebhooksQuery, useStopSessionMutation } from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import './Dashboard.css';

const AVATAR_COLORS = ['#ff7a1a', '#3b82f6', '#f59e0b', '#14b8a6', '#8b5cf6', '#ec4899', '#ef4444', '#0ea5e9'];

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

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const navigate = useNavigate();
  const toast = useToast();
  const { data: sessions = [], isLoading: loadingSessions, error: sessionsError } = useSessionsQuery();
  const { data: stats } = useSessionStatsQuery();
  const { data: webhooks = [] } = useWebhooksQuery();
  const stopMutation = useStopSessionMutation();

  const [disconnectId, setDisconnectId] = useState<string | null>(null);

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
