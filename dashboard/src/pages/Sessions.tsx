import { useState, useEffect, useCallback, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Plus, QrCode, RefreshCw, Trash2, Eye, Loader2, Play, Square, X, Search, Filter, Skull, Bot, Send, CheckCircle2, Circle } from 'lucide-react';
import { sessionApi, messageApi, type Session, type AiConfig } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { useWebSocket } from '../hooks/useWebSocket';
import { useRole } from '../hooks/useRole';
import { PageHeader } from '../components/PageHeader';
import { PERSONA_PRESETS } from '../data/personaLibrary';
import './Sessions.css';

// Avatar palette — hash the session id to pick a stable color.
const AVATAR_COLORS = ['#ff7a1a', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#10b981'];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.replace(/[-_]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Map a raw session status to a semantic visual tone.
function statusTone(status: string): 'success' | 'warning' | 'error' | 'muted' {
  if (status === 'ready') return 'success';
  if (['initializing', 'connecting', 'qr_ready'].includes(status)) return 'warning';
  if (['disconnected', 'failed'].includes(status)) return 'error';
  return 'muted';
}

// Business-hours weekly grid (keys match the auto-reply plugin's schedule map).
const BH_DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Seg' }, { key: 'tue', label: 'Ter' }, { key: 'wed', label: 'Qua' },
  { key: 'thu', label: 'Qui' }, { key: 'fri', label: 'Sex' }, { key: 'sat', label: 'Sáb' }, { key: 'sun', label: 'Dom' },
];
const DEFAULT_BH_SCHEDULE: Record<string, { start: string; end: string } | false> = {
  mon: { start: '09:00', end: '18:00' }, tue: { start: '09:00', end: '18:00' },
  wed: { start: '09:00', end: '18:00' }, thu: { start: '09:00', end: '18:00' },
  fri: { start: '09:00', end: '18:00' }, sat: false, sun: false,
};

export function Sessions() {
  const { t } = useTranslation();
  useDocumentTitle(t('sessions.title'));
  const toast = useToast();
  const { canWrite } = useRole();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [qrData, setQrData] = useState<{ sessionId: string; sessionName: string; qrCode: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [killConfirmId, setKillConfirmId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Envio rápido de mensagem
  const [quickSendSession, setQuickSendSession] = useState<Session | null>(null);
  const [quickSendTo, setQuickSendTo] = useState('');
  const [quickSendText, setQuickSendText] = useState('');
  const [quickSending, setQuickSending] = useState(false);

  // Onboarding após criar sessão
  const [onboardingSession, setOnboardingSession] = useState<Session | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // IA de atendimento por sessão (uma empresa = uma sessão)
  const [aiSession, setAiSession] = useState<Session | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);

  const openAiModal = useCallback(
    async (session: Session) => {
      setAiSession(session);
      setAiConfig({});
      setAiLoading(true);
      try {
        const cfg = await sessionApi.getAi(session.id);
        setAiConfig(cfg ?? {});
      } catch {
        setAiConfig({});
      } finally {
        setAiLoading(false);
      }
    },
    [],
  );

  const handleQuickSend = async () => {
    if (!quickSendSession || !quickSendTo.trim() || !quickSendText.trim()) return;
    setQuickSending(true);
    try {
      const chatId = quickSendTo.replace(/\D/g, '') + '@c.us';
      await messageApi.sendText(quickSendSession.id, chatId, quickSendText);
      toast.success('Mensagem enviada!', `Para ${quickSendTo}`);
      setQuickSendSession(null);
      setQuickSendTo('');
      setQuickSendText('');
    } catch (e) {
      toast.error('Erro ao enviar', e instanceof Error ? e.message : 'Falha');
    } finally {
      setQuickSending(false);
    }
  };

  const setBhDayTime = (day: string, field: 'start' | 'end', value: string) =>
    setAiConfig(c => {
      const sched = { ...(c.businessHours?.schedule ?? {}) };
      const cur = sched[day];
      const rule = cur ? cur : { start: '09:00', end: '18:00' };
      sched[day] = { ...rule, [field]: value };
      return { ...c, businessHours: { ...c.businessHours, schedule: sched } };
    });

  const saveAiConfig = useCallback(async () => {
    if (!aiSession) return;
    setAiSaving(true);
    try {
      await sessionApi.updateAi(aiSession.id, {
        enabled: aiConfig.enabled !== false,
        persona: aiConfig.persona ?? '',
        knowledge: aiConfig.knowledge ?? '',
        model: aiConfig.model ?? '',
        greeting: aiConfig.greeting ?? '',
        ...(aiConfig.businessHours ? { businessHours: aiConfig.businessHours } : {}),
      });
      toast.success(t('sessions.ai.savedTitle'), t('sessions.ai.savedDesc', { name: aiSession.name }));
      setAiSession(null);
    } catch (err) {
      toast.error(t('sessions.ai.errorTitle'), err instanceof Error ? err.message : t('sessions.ai.errorDesc'));
    } finally {
      setAiSaving(false);
    }
  }, [aiSession, aiConfig, toast, t]);

  const fetchSessions = useCallback(async (): Promise<Session[]> => {
    try {
      setLoading(true);
      const data = await sessionApi.list();
      setSessions(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sessions.create.errorDefault'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [t]);

  const { isConnected, subscribe } = useWebSocket({
    onSessionStatus: useCallback(
      (event: { sessionId: string; status: string }) => {
        setSessions(prev =>
          prev.map(s => (s.id === event.sessionId ? { ...s, status: event.status as Session['status'] } : s)),
        );
        if (event.status === 'ready') {
          toast.success(t('sessions.toasts.readyTitle'), t('sessions.toasts.readyDesc'));
        } else if (event.status === 'disconnected') {
          toast.warning(t('sessions.toasts.disconnectedTitle'), t('sessions.toasts.disconnectedDesc'));
        } else if (event.status === 'failed') {
          // Refresh so the card picks up the lastError reason from the API.
          void fetchSessions();
          toast.error(t('sessions.toasts.failedTitle'), t('sessions.toasts.failedDesc'));
        }
      },
      [toast, t, fetchSessions],
    ),
  });

  // The gateway delivers events only to subscribed rooms; join the wildcard
  // session.status room so status changes for every session are received live.
  useEffect(() => {
    if (isConnected) {
      subscribe('*', ['session.status', 'session.qr']);
    }
  }, [isConnected, subscribe]);

  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qrRefreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSessionName = useRef<string>('');

  const fetchQR = useCallback(async (sessionId: string) => {
    // Guard: if session is already connected, stop polling immediately.
    const currentSession = sessions.find(s => s.id === sessionId);
    if (currentSession?.status === 'ready') {
      setQrData(null);
      currentSessionName.current = '';
      return;
    }
    try {
      const qr = await sessionApi.getQR(sessionId);
      setQrData({ sessionId, sessionName: currentSessionName.current, qrCode: qr.qrCode });
      if (qr.status === 'ready') {
        setQrData(null);
        currentSessionName.current = '';
        fetchSessions();
      }
    } catch {
      // Keep qrData alive so the polling interval keeps retrying until the QR
      // is ready. Only stop polling if the session itself has failed.
      const updated = await sessionApi.get(sessionId).catch(() => null);
      const stillInitializing = updated &&
        ['initializing', 'connecting', 'qr_ready'].includes(updated.status);
      if (!stillInitializing) {
        setQrData(null);
        currentSessionName.current = '';
        fetchSessions();
      }
    }
  }, [sessions]);

  useEffect(() => {
    if (qrData) {
      currentSessionName.current = qrData.sessionName;
      qrRefreshInterval.current = setInterval(() => {
        fetchQR(qrData.sessionId);
      }, 5000);
    }
    return () => {
      if (qrRefreshInterval.current) clearInterval(qrRefreshInterval.current);
    };
  }, [qrData, fetchQR]);

  const handleCreate = async () => {
    if (!newSessionName.trim()) return;
    try {
      setCreating(true);
      const newSession = await sessionApi.create(newSessionName);
      setSessions([...sessions, newSession]);
      setNewSessionName('');
      setShowCreateModal(false);
      setOnboardingSession(newSession);
      setOnboardingStep(0);
      toast.success(t('sessions.create.successTitle'), t('sessions.create.successDesc', { name: newSession.name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sessions.create.errorDefault');
      setError(msg);
      toast.error(t('sessions.create.errorTitle'), msg);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    try {
      await sessionApi.delete(id);
      setSessions(sessions.filter(s => s.id !== id));
      toast.success(
        t('sessions.delete.successTitle'),
        session ? t('sessions.delete.successDescNamed', { name: session.name }) : t('sessions.delete.successDescGeneric'),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sessions.delete.errorDefault');
      console.error('Failed to delete:', err);
      toast.error(t('sessions.delete.errorTitle'), msg);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleStart = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session && ['initializing', 'connecting', 'qr_ready'].includes(session.status)) {
      handleShowQR(id);
      return;
    }

    setActionBusy(id);
    try {
      await sessionApi.start(id);
      setSessions(sessions.map(s => (s.id === id ? { ...s, status: 'connecting' } : s)));
      await fetchSessions();
      handleShowQR(id);
    } catch (err) {
      console.error('Failed to start:', err);
      toast.error(t('sessions.start.errorTitle', { defaultValue: 'Erro ao iniciar sessão' }), err instanceof Error ? err.message : undefined);
      const fresh = await fetchSessions();
      const current = fresh.find(s => s.id === id);
      if (current?.status !== 'ready') handleShowQR(id);
    } finally {
      setActionBusy(null);
    }
  };

  const handleShowQR = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    // Nothing to show for an already-connected session.
    if (session?.status === 'ready') return;
    const sessionName = session?.name || '';
    // Show loading state immediately so the modal opens and polling starts
    // even before Chromium has finished initializing.
    setQrData({ sessionId: id, sessionName, qrCode: '' });
    currentSessionName.current = sessionName;
    try {
      const qr = await sessionApi.getQR(id);
      setQrData({ sessionId: id, sessionName, qrCode: qr.qrCode });
    } catch (err) {
      console.error('Failed to get QR:', err);
      toast.error(t('sessions.qr.errorTitle', { defaultValue: 'Erro ao gerar QR' }), err instanceof Error ? err.message : undefined);
      // Do not clear qrData here — keep the loading modal open so the
      // polling interval (every 5 s) retries until the QR becomes available.
    }
  };

  const handleStop = async (id: string) => {
    setActionBusy(id);
    try {
      await sessionApi.stop(id);
      setSessions(sessions.map(s => (s.id === id ? { ...s, status: 'disconnected' } : s)));
      if (qrData?.sessionId === id) setQrData(null);
    } catch (err) {
      console.error('Failed to stop:', err);
      toast.error(t('sessions.stop.errorTitle', { defaultValue: 'Erro ao parar sessão' }), err instanceof Error ? err.message : undefined);
      fetchSessions();
    } finally {
      setActionBusy(null);
    }
  };

  // Trocar número: faz logout (desvincula + limpa credenciais) e inicia para gerar um QR NOVO.
  // Um "Desconectar" comum mantém as credenciais e reconecta o MESMO número.
  const handleSwitchNumber = async (id: string) => {
    setActionBusy(id);
    try {
      await sessionApi.logout(id);
      if (qrData?.sessionId === id) setQrData(null);
    } catch (err) {
      toast.error(
        t('sessions.switchNumber.errorTitle', { defaultValue: 'Erro ao trocar número' }),
        err instanceof Error ? err.message : undefined,
      );
      fetchSessions();
      setActionBusy(null);
      return;
    }
    setActionBusy(null);
    toast.success(
      t('sessions.switchNumber.successTitle', { defaultValue: 'Número desvinculado' }),
      t('sessions.switchNumber.success', { defaultValue: 'Gerando um novo QR para conectar outro número…' }),
    );
    await handleStart(id); // abre o modal com o QR novo
  };

  const handleForceKill = async (id: string) => {
    try {
      await sessionApi.forceKill(id);
      setSessions(sessions.map(s => (s.id === id ? { ...s, status: 'disconnected' } : s)));
      toast.success(t('sessions.forceKill.successTitle'), t('sessions.forceKill.success'));
    } catch (err) {
      console.error('Failed to force-kill:', err);
      toast.error(t('sessions.forceKill.failedTitle'), t('sessions.forceKill.failed'));
      fetchSessions();
    } finally {
      setKillConfirmId(null);
    }
  };

  const formatLastActive = (date?: string) => {
    if (!date) return t('common.never');
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return t('common.justNow');
    if (diff < 3600000) return t('common.minAgo', { count: Math.floor(diff / 60000) });
    return new Date(date).toLocaleDateString();
  };

  const formatStatus = (status: string) => t(`sessionStatus.${status}`, { defaultValue: status });

  const filteredSessions = sessions.filter(s => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && s.status === 'ready') ||
      (statusFilter === 'inactive' && ['created', 'idle', 'disconnected'].includes(s.status)) ||
      (statusFilter === 'connecting' && ['initializing', 'connecting', 'qr_ready'].includes(s.status));
    return matchesSearch && matchesStatus;
  });

  const totalCount = sessions.length;
  const connectedCount = sessions.filter(s => s.status === 'ready').length;
  const offlineCount = sessions.filter(s => ['disconnected', 'failed'].includes(s.status)).length;

  if (loading) {
    return (
      <div
        className="sessions-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="sessions-page">
      <PageHeader
        title={t('sessions.title')}
        subtitle={t('sessions.subtitle')}
        actions={
          canWrite && (
            <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={18} />
              {t('sessions.newSession')}
            </button>
          )
        }
      />

      {totalCount > 0 && (
        <div className="kpi-row">
          <div className="kpi-card">
            <div className="kpi-icon kpi-icon-green"><QrCode size={20} /></div>
            <div className="kpi-meta">
              <span className="kpi-value">{totalCount}</span>
              <span className="kpi-label">{t('sessions.kpi.total', { defaultValue: 'Total de sessões' })}</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon kpi-icon-blue"><CheckCircle2 size={20} /></div>
            <div className="kpi-meta">
              <span className="kpi-value">{connectedCount}</span>
              <span className="kpi-label">{t('sessions.kpi.connected', { defaultValue: 'Conectadas' })}</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon kpi-icon-amber"><Circle size={20} /></div>
            <div className="kpi-meta">
              <span className="kpi-value">{offlineCount}</span>
              <span className="kpi-label">{t('sessions.kpi.offline', { defaultValue: 'Desconectadas / erro' })}</span>
            </div>
          </div>
        </div>
      )}

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('sessions.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <Filter size={16} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">{t('sessions.filter.all')}</option>
            <option value="active">{t('sessions.filter.active')}</option>
            <option value="inactive">{t('sessions.filter.inactive')}</option>
            <option value="connecting">{t('sessions.filter.connecting')}</option>
          </select>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'color-mix(in srgb, var(--error) 12%, transparent)',
            padding: '1rem',
            borderRadius: '8px',
            color: 'var(--error)',
            border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('sessions.create.title')}</h2>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <label>{t('sessions.create.label')}</label>
              <input
                type="text"
                placeholder={t('sessions.create.placeholder')}
                value={newSessionName}
                onChange={e => {
                  const value = e.target.value.toLowerCase().replace(/\s+/g, '-');
                  setNewSessionName(value);
                }}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
              <p className="input-hint">
                <Trans i18nKey="sessions.create.hint" components={{ code: <code /> }} />
              </p>
              {newSessionName && !/^[a-z0-9-]+$/.test(newSessionName) && (
                <p className="input-error">{t('sessions.create.invalidChars')}</p>
              )}
              {newSessionName && newSessionName.length > 50 && (
                <p className="input-error">{t('sessions.create.tooLong', { length: newSessionName.length })}</p>
              )}
              {newSessionName &&
                /^[a-z0-9-]+$/.test(newSessionName) &&
                newSessionName.length <= 50 &&
                sessions.some(s => s.name === newSessionName) && (
                  <p className="input-error">{t('sessions.create.duplicate')}</p>
                )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={
                  creating ||
                  !newSessionName.trim() ||
                  !/^[a-z0-9-]+$/.test(newSessionName) ||
                  newSessionName.length > 50 ||
                  sessions.some(s => s.name === newSessionName)
                }
              >
                {creating ? <Loader2 className="animate-spin" size={16} /> : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {qrData && (
        <div className="modal-overlay" onClick={() => setQrData(null)}>
          <div className="modal qr-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h2>{t('sessions.qr.title')}</h2>
                <span className="session-name">{qrData.sessionName}</span>
              </div>
              <button className="btn-close" onClick={() => setQrData(null)} aria-label={t('common.close')}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              {qrData.qrCode ? (
                <>
                  <img src={qrData.qrCode} alt="QR" style={{ maxWidth: '280px', borderRadius: '12px' }} />
                  <div className="qr-instructions">
                    <p className="qr-step"><Trans i18nKey="sessions.qr.step1" components={{ strong: <strong /> }} /></p>
                    <p className="qr-step"><Trans i18nKey="sessions.qr.step2" components={{ strong: <strong /> }} /></p>
                    <p className="qr-step"><Trans i18nKey="sessions.qr.step3" components={{ strong: <strong /> }} /></p>
                  </div>
                  <p className="qr-auto-refresh">
                    <RefreshCw size={14} className="spin-slow" /> {t('sessions.qr.autoRefresh')}
                  </p>
                </>
              ) : (
                <div style={{ padding: '2rem' }}>
                  <Loader2 className="animate-spin" size={48} />
                  <p>{t('sessions.qr.generating')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedSession && (
        <div className="modal-overlay" onClick={() => setSelectedSession(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('sessions.details.title')}</h2>
              <button className="btn-icon" onClick={() => setSelectedSession(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">{t('sessions.details.name')}</span>
                  <span className="detail-value">{selectedSession.name}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('sessions.details.status')}</span>
                  <span className={`status-badge ${selectedSession.status}`}>{formatStatus(selectedSession.status)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('sessions.details.sessionId')}</span>
                  <span className="detail-value mono">{selectedSession.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('sessions.details.phone')}</span>
                  <span className="detail-value">{selectedSession.phone || t('sessions.details.phoneNone')}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('sessions.details.created')}</span>
                  <span className="detail-value">{new Date(selectedSession.createdAt).toLocaleString()}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('sessions.details.lastActive')}</span>
                  <span className="detail-value">
                    {selectedSession.lastActive ? new Date(selectedSession.lastActive).toLocaleString() : t('common.never')}
                  </span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setSelectedSession(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('sessions.delete.title')}</h2>
              <button className="btn-icon" onClick={() => setDeleteConfirmId(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                <Trans
                  i18nKey="sessions.delete.message"
                  values={{ name: sessions.find(s => s.id === deleteConfirmId)?.name }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="text-muted">{t('sessions.delete.warning')}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteConfirmId(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={() => handleDelete(deleteConfirmId)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {killConfirmId && (
        <div className="modal-overlay" onClick={() => setKillConfirmId(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('sessions.forceKill.title')}</h2>
              <button className="btn-icon" onClick={() => setKillConfirmId(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                <Trans
                  i18nKey="sessions.forceKill.message"
                  values={{ name: sessions.find(s => s.id === killConfirmId)?.name }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="text-muted">{t('sessions.forceKill.warning')}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setKillConfirmId(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={() => handleForceKill(killConfirmId)}>
                {t('sessions.forceKill.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configuração da IA de atendimento (uma empresa = uma sessão) */}
      {aiSession && (
        <div className="modal-overlay" onClick={() => setAiSession(null)}>
          <div className="modal ai-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <Bot size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                {t('sessions.ai.modalTitle', { name: aiSession.name })}
              </h2>
              <button className="btn-icon" onClick={() => setAiSession(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {aiLoading ? (
                <div className="ai-loading">
                  <Loader2 size={20} className="spin" /> {t('sessions.ai.loading')}
                </div>
              ) : (
                <>
                  <label className="ai-toggle">
                    <input
                      type="checkbox"
                      checked={aiConfig.enabled !== false}
                      onChange={e => setAiConfig(c => ({ ...c, enabled: e.target.checked }))}
                    />
                    <span>{t('sessions.ai.enabled')}</span>
                  </label>

                  <div className="form-group">
                    <label>Modelos de persona</label>
                    <div className="preset-chips" style={{ marginBottom: 10 }}>
                      {PERSONA_PRESETS.map(p => (
                        <button
                          key={p.label}
                          type="button"
                          className="preset-chip"
                          onClick={() => {
                            setAiConfig(c => ({ ...c, persona: p.persona, knowledge: p.knowledge, greeting: p.greeting }));
                          }}
                        >
                          {p.icon} {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>{t('sessions.ai.personaLabel')}</label>
                    <textarea
                      rows={6}
                      placeholder={t('sessions.ai.personaPlaceholder')}
                      value={aiConfig.persona ?? ''}
                      onChange={e => setAiConfig(c => ({ ...c, persona: e.target.value }))}
                    />
                    <small>{t('sessions.ai.personaHint')}</small>
                  </div>

                  <div className="form-group">
                    <label>{t('sessions.ai.knowledgeLabel')}</label>
                    <textarea
                      rows={6}
                      placeholder={t('sessions.ai.knowledgePlaceholder')}
                      value={aiConfig.knowledge ?? ''}
                      onChange={e => setAiConfig(c => ({ ...c, knowledge: e.target.value }))}
                    />
                    <small>{t('sessions.ai.knowledgeHint')}</small>
                  </div>

                  <div className="form-group">
                    <label>{t('sessions.ai.greetingLabel')}</label>
                    <textarea
                      rows={2}
                      placeholder={t('sessions.ai.greetingPlaceholder')}
                      value={aiConfig.greeting ?? ''}
                      onChange={e => setAiConfig(c => ({ ...c, greeting: e.target.value }))}
                    />
                    <small>{t('sessions.ai.greetingHint')}</small>
                  </div>

                  <div className="form-group">
                    <label>{t('sessions.ai.modelLabel')}</label>
                    <input
                      type="text"
                      placeholder="qwen2.5:7b-instruct"
                      value={aiConfig.model ?? ''}
                      onChange={e => setAiConfig(c => ({ ...c, model: e.target.value }))}
                    />
                    <small>{t('sessions.ai.modelHint')}</small>
                  </div>

                  <div className="form-group">
                    <label className="ai-bh-toggle">
                      <input
                        type="checkbox"
                        checked={!!aiConfig.businessHours?.enabled}
                        onChange={e => setAiConfig(c => ({
                          ...c,
                          businessHours: {
                            timezone: 'America/Sao_Paulo',
                            outsideMessage: 'Nosso atendimento está fora do horário. Retornaremos assim que possível!',
                            schedule: DEFAULT_BH_SCHEDULE,
                            ...c.businessHours,
                            enabled: e.target.checked,
                          },
                        }))}
                      />
                      {t('sessions.ai.businessHoursLabel', 'Horário comercial')}
                    </label>
                    <small>{t('sessions.ai.businessHoursHint', 'Quando ativo, a IA só responde dentro da agenda; fora, envia a mensagem abaixo.')}</small>

                    {aiConfig.businessHours?.enabled && (
                      <div className="ai-bh-panel">
                        <div className="ai-bh-tz">
                          <label>{t('sessions.ai.timezoneLabel', 'Fuso horário')}</label>
                          <input
                            type="text"
                            value={aiConfig.businessHours.timezone ?? 'America/Sao_Paulo'}
                            onChange={e => setAiConfig(c => ({ ...c, businessHours: { ...c.businessHours, timezone: e.target.value } }))}
                          />
                        </div>
                        {BH_DAYS.map(d => {
                          const rule = aiConfig.businessHours?.schedule?.[d.key];
                          const open = rule ? rule : null;
                          return (
                            <div key={d.key} className="ai-bh-day">
                              <label className="ai-bh-dayname">
                                <input
                                  type="checkbox"
                                  checked={!!open}
                                  onChange={e => setAiConfig(c => {
                                    const sched = { ...(c.businessHours?.schedule ?? {}) };
                                    sched[d.key] = e.target.checked ? { start: '09:00', end: '18:00' } : false;
                                    return { ...c, businessHours: { ...c.businessHours, schedule: sched } };
                                  })}
                                />
                                {d.label}
                              </label>
                              {open ? (
                                <div className="ai-bh-times">
                                  <input type="time" value={open.start} onChange={e => setBhDayTime(d.key, 'start', e.target.value)} />
                                  <span>—</span>
                                  <input type="time" value={open.end} onChange={e => setBhDayTime(d.key, 'end', e.target.value)} />
                                </div>
                              ) : (
                                <span className="ai-bh-closed">{t('sessions.ai.closed', 'Fechado')}</span>
                              )}
                            </div>
                          );
                        })}
                        <div className="ai-bh-outside">
                          <label>{t('sessions.ai.outsideMessageLabel', 'Mensagem fora do horário')}</label>
                          <textarea
                            rows={2}
                            value={aiConfig.businessHours.outsideMessage ?? ''}
                            onChange={e => setAiConfig(c => ({ ...c, businessHours: { ...c.businessHours, outsideMessage: e.target.value } }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setAiSession(null)} disabled={aiSaving}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={() => void saveAiConfig()} disabled={aiSaving || aiLoading}>
                {aiSaving ? <Loader2 size={16} className="spin" /> : null} {t('sessions.ai.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de envio rápido */}
      {quickSendSession && (
        <div className="modal-overlay" onClick={() => setQuickSendSession(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Send size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Enviar mensagem — {quickSendSession.name}</h2>
              <button className="btn-icon" onClick={() => setQuickSendSession(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Número (com DDD)</label>
                <input
                  type="text"
                  placeholder="5511999990001"
                  value={quickSendTo}
                  onChange={e => setQuickSendTo(e.target.value)}
                  autoFocus
                />
                <small>Somente dígitos ou com + e traços — o sistema normaliza automaticamente.</small>
              </div>
              <div className="form-group">
                <label>Mensagem</label>
                <textarea
                  rows={4}
                  placeholder="Digite a mensagem aqui..."
                  value={quickSendText}
                  onChange={e => setQuickSendText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) void handleQuickSend(); }}
                />
                <small>Ctrl+Enter para enviar</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setQuickSendSession(null)}>Cancelar</button>
              <button
                className="btn-primary"
                onClick={() => void handleQuickSend()}
                disabled={quickSending || !quickSendTo.trim() || !quickSendText.trim()}
              >
                {quickSending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de onboarding após criar sessão */}
      {onboardingSession && (
        <div className="modal-overlay" onClick={() => setOnboardingSession(null)}>
          <div className="modal onboarding-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🎉 Sessão <strong>{onboardingSession.name}</strong> criada!</h2>
              <button className="btn-icon" onClick={() => setOnboardingSession(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                Siga os 3 passos para colocar o bot no ar:
              </p>
              {[
                { label: 'Conectar o WhatsApp (escanear QR Code)', action: () => { setOnboardingStep(1); handleShowQR(onboardingSession.id); } },
                { label: 'Configurar a IA de atendimento (persona, conhecimento, saudação)', action: () => { setOnboardingStep(2); void openAiModal(onboardingSession); } },
                { label: 'Criar primeira campanha de vendas em Vendas', action: () => { setOnboardingSession(null); window.location.href = '/sales'; } },
              ].map((step, i) => (
                <div key={i} className={`onboarding-step ${onboardingStep > i ? 'done' : i === onboardingStep ? 'active' : ''}`}>
                  {onboardingStep > i ? <CheckCircle2 size={18} className="step-icon done" /> : <Circle size={18} className="step-icon" />}
                  <div className="step-body">
                    <span className="step-label">{i + 1}. {step.label}</span>
                    {i === onboardingStep && (
                      <button className="btn-sm primary step-btn" onClick={step.action}>Fazer agora</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setOnboardingSession(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      <div className="sessions-grid">
        {filteredSessions.length === 0 ? (
          <div className="empty-state">
            <QrCode size={48} />
            <h3>{t('sessions.empty.title')}</h3>
            <p>{t('sessions.empty.description')}</p>
          </div>
        ) : (
          filteredSessions.map(session => (
            <div key={session.id} className="session-card">
              <div className="card-header">
                <div className="card-identity">
                  <div className="session-avatar" style={{ background: avatarColor(session.id) }}>
                    {getInitials(session.name)}
                  </div>
                  <div className="card-identity-text">
                    <h3 title={session.name}>{session.name}</h3>
                    <span className="card-phone">{session.phone || t('sessions.card.phoneNone', { defaultValue: 'Sem número' })}</span>
                  </div>
                </div>
                <span className={`status-badge tone-${statusTone(session.status)}`}>
                  {formatStatus(session.status)}
                </span>
              </div>

              {session.status === 'initializing' || session.status === 'connecting' || session.status === 'qr_ready' ? (
                <div className="qr-placeholder">
                  <QrCode size={80} className="qr-icon" />
                  <p>{session.status === 'qr_ready' ? t('sessions.qr.scanToConnect') : t('sessions.qr.preparing')}</p>
                  <button
                    className="btn-sm"
                    onClick={() => handleShowQR(session.id)}
                    disabled={session.status !== 'qr_ready'}
                  >
                    {session.status === 'qr_ready' ? t('sessions.qr.showQr') : t('sessions.qr.loading')}
                  </button>
                </div>
              ) : (
                <div className="session-info">
                  <div className="info-row">
                    <span className="info-label">{t('sessions.card.phone')}</span>
                    <span className="info-value">{session.phone || '—'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">{t('sessions.card.sessionId')}</span>
                    <span className="info-value mono" title={session.id}>
                      {session.id.slice(0, 8)}…{session.id.slice(-4)}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">{t('sessions.card.lastActive')}</span>
                    <span className="info-value">{formatLastActive(session.lastActive)}</span>
                  </div>
                  {session.status === 'failed' && session.lastError ? (
                    <div className="info-row session-error">
                      <span className="info-label">{t('sessions.card.error')}</span>
                      <span className="info-value error-text" title={session.lastError}>
                        {session.lastError}
                      </span>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="card-actions">
                <button className="btn-action" onClick={() => setSelectedSession(session)}>
                  <Eye size={16} />
                  {t('sessions.actions.view')}
                </button>
                {canWrite && session.status === 'ready' && (
                  <button className="btn-action" onClick={() => { setQuickSendSession(session); setQuickSendTo(''); setQuickSendText(''); }} title="Enviar mensagem">
                    <Send size={16} />
                    Enviar
                  </button>
                )}
                {canWrite && (
                  <button className="btn-action" onClick={() => void openAiModal(session)} title={t('sessions.ai.configureTitle')}>
                    <Bot size={16} />
                    {t('sessions.ai.button')}
                  </button>
                )}
                {canWrite &&
                (session.status === 'created' || session.status === 'idle' || session.status === 'disconnected') ? (
                  <button className="btn-action" onClick={() => handleStart(session.id)} disabled={actionBusy === session.id}>
                    {actionBusy === session.id ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                    {t('sessions.actions.start')}
                  </button>
                ) : canWrite && ['ready', 'initializing', 'connecting', 'qr_ready'].includes(session.status) ? (
                  <button className="btn-action" onClick={() => handleStop(session.id)} disabled={actionBusy === session.id}>
                    {actionBusy === session.id ? <Loader2 size={16} className="spin" /> : <Square size={16} />}
                    {t('sessions.actions.stop')}
                  </button>
                ) : canWrite ? (
                  <button className="btn-action" onClick={() => handleStart(session.id)} disabled={actionBusy === session.id}>
                    {actionBusy === session.id ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                    {t('sessions.actions.reconnect')}
                  </button>
                ) : null}
                {canWrite && ['ready', 'connecting', 'qr_ready', 'disconnected', 'failed'].includes(session.status) && (
                  <button
                    className="btn-action"
                    title="Desvincula o número atual e gera um novo QR para conectar outro número"
                    onClick={() => handleSwitchNumber(session.id)}
                    disabled={actionBusy === session.id}
                  >
                    <QrCode size={16} />
                    {t('sessions.actions.switchNumber', { defaultValue: 'Trocar número' })}
                  </button>
                )}
                {canWrite && (
                  <button className="btn-action danger" onClick={() => setDeleteConfirmId(session.id)}>
                    <Trash2 size={16} />
                    {t('sessions.actions.delete')}
                  </button>
                )}
                {canWrite && session.status === 'failed' && (
                  <button className="btn-action danger" onClick={() => setKillConfirmId(session.id)}>
                    <Skull size={16} />
                    {t('sessions.actions.killStuck')}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
