import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { read, utils } from 'xlsx';
import {
  Loader2,
  Upload,
  Send,
  Sparkles,
  Trash2,
  Database,
  RefreshCw,
  MessageSquare,
  X,
  Pause,
  Play,
  Plus,
} from 'lucide-react';
import {
  sessionApi,
  salesApi,
  messageApi,
  type Session,
  type Campaign,
  type Outreach,
  type LeadSource,
  type SalesLead,
  type OptOut,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import './SalesEngine.css';

const CAMPAIGN_PRESETS = [
  { icon: '🔄', label: 'Reativação', hint: 'Reativar clientes inativos há mais de 30 dias com oferta especial de retorno' },
  { icon: '🎁', label: 'Promoção', hint: 'Divulgar promoção relâmpago com desconto exclusivo para clientes da base' },
  { icon: '📦', label: 'Produto novo', hint: 'Apresentar novo produto ou serviço para clientes que já compraram antes' },
  { icon: '🤝', label: 'Pós-venda', hint: 'Follow-up pós-compra, verificar satisfação e oferecer upsell ou complemento' },
  { icon: '💳', label: 'Renovação', hint: 'Lembrar clientes com contrato ou plano próximo do vencimento para renovar com condição especial' },
  { icon: '🎯', label: 'Recuperação', hint: 'Recuperar leads que demonstraram interesse mas não fecharam, com nova abordagem personalizada' },
];

const STAGE_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  sent: 'Enviada',
  replied: 'Respondeu',
  qualified: 'Qualificada',
  won: 'Ganha',
  lost: 'Perdida',
  opted_out: 'Opt-out',
  failed: 'Falha',
};

type CampaignProgress = {
  sent: number;
  approved: number;
  pending: number;
  failed: number;
  total: number;
  etaMinutes: number;
  rate: number;
  status: string;
};

export function SalesEngine() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.sales'));
  const toast = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);

  // Progress polling
  const [progressMap, setProgressMap] = useState<Record<string, CampaignProgress>>({});

  // Quick message modal
  const [quickMsg, setQuickMsg] = useState(false);
  const [qmPhone, setQmPhone] = useState('');
  const [qmText, setQmText] = useState('');
  const [qmBusy, setQmBusy] = useState(false);

  // Postgres source form
  const [pgName, setPgName] = useState('');
  const [pgHost, setPgHost] = useState('');
  const [pgPort, setPgPort] = useState('5432');
  const [pgDb, setPgDb] = useState('');
  const [pgUser, setPgUser] = useState('');
  const [pgPass, setPgPass] = useState('');
  const [pgQuery, setPgQuery] = useState('SELECT * FROM clientes LIMIT 100');
  const [pgNameCol, setPgNameCol] = useState('nome');
  const [pgPhoneCol, setPgPhoneCol] = useState('telefone');
  const [pgBusy, setPgBusy] = useState(false);
  const [showPgForm, setShowPgForm] = useState(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState(0);
  const [cName, setCName] = useState('');
  const [cOffer, setCOffer] = useState('');
  const [cRate, setCRate] = useState(6);
  const [launching, setLaunching] = useState(false);

  // File upload state
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [uploadedLeads, setUploadedLeads] = useState<SalesLead[]>([]);
  const [uploadColumns, setUploadColumns] = useState<string[]>([]);
  const [nameCol, setNameCol] = useState('');
  const [phoneCol, setPhoneCol] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadPreview, setUploadPreview] = useState<Record<string, unknown>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void sessionApi.list().then(s => {
      setSessions(s);
      if (s.length && !sessionId) setSessionId(s[0].id);
    });
  }, [sessionId]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const [src, camp, outs] = await Promise.all([
      salesApi.listSources(sessionId),
      salesApi.listCampaigns(sessionId),
      salesApi.listOptOuts(sessionId),
    ]);
    setSources(src);
    setCampaigns(camp);
    setOptOuts(outs);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    setSelected(null);
    setOutreach([]);
    setMetrics({});
  }, [refresh]);

  // Poll progress for active campaigns
  useEffect(() => {
    const activeCampaigns = campaigns.filter(c =>
      ['sending', 'paused', 'generating'].includes(c.status),
    );
    if (!activeCampaigns.length) return;
    const poll = async () => {
      const results = await Promise.all(
        activeCampaigns.map(c =>
          salesApi
            .progress(c.id)
            .then(p => [c.id, p] as [string, CampaignProgress])
            .catch(() => null),
        ),
      );
      const map: Record<string, CampaignProgress> = {};
      results.forEach(r => {
        if (r) map[r[0]] = r[1];
      });
      setProgressMap(prev => ({ ...prev, ...map }));
    };
    void poll();
    const tid = setInterval(() => void poll(), 8000);
    return () => clearInterval(tid);
  }, [campaigns]);

  const loadCampaign = useCallback(async (c: Campaign) => {
    setSelected(c);
    const [o, m] = await Promise.all([salesApi.listOutreach(c.id), salesApi.metrics(c.id)]);
    setOutreach(o);
    setMetrics(m);
  }, []);

  // File parser
  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const data = e.target?.result;
      const wb = read(data, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (!rows.length) {
        toast.error('Arquivo vazio', '');
        return;
      }
      const cols = Object.keys(rows[0]);
      setUploadColumns(cols);
      setUploadPreview(rows.slice(0, 3));
      setRawRows(rows);

      const nameGuess =
        cols.find(c => /nome|name|cliente|contact/i.test(c)) ?? cols[0];
      const phoneGuess =
        cols.find(c => /fone|tel|celular|phone|whatsapp|numero/i.test(c)) ??
        cols[1] ??
        cols[0];
      setNameCol(nameGuess);
      setPhoneCol(phoneGuess);

      const leads: SalesLead[] = rows.map(row => ({
        name: String(row[nameGuess] ?? ''),
        phone: String(row[phoneGuess] ?? ''),
        attributes: row,
      }));
      setUploadedLeads(leads);
      setUploadFileName(file.name);
      toast.success(`${rows.length} contatos importados`, file.name);
    };
    reader.readAsBinaryString(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  // Re-derive leads when columns change
  const remapLeads = useCallback(
    (nCol: string, pCol: string) => {
      if (!rawRows.length) return;
      const leads: SalesLead[] = rawRows.map(row => ({
        name: String(row[nCol] ?? ''),
        phone: String(row[pCol] ?? ''),
        attributes: row,
      }));
      setUploadedLeads(leads);
    },
    [rawRows],
  );

  const handleNameColChange = (col: string) => {
    setNameCol(col);
    remapLeads(col, phoneCol);
  };

  const handlePhoneColChange = (col: string) => {
    setPhoneCol(col);
    remapLeads(nameCol, col);
  };

  // Auto-launch campaign
  const autoLaunch = async () => {
    if (!sessionId || !cName.trim() || uploadedLeads.length === 0) return;
    setLaunching(true);
    setWizardStep(2);
    try {
      const leads: SalesLead[] = rawRows.map(row => ({
        name: String(row[nameCol] ?? ''),
        phone: String(row[phoneCol] ?? ''),
        attributes: row,
      }));

      const campaign = await salesApi.createCampaign({
        sessionId,
        name: cName,
        offerHint: cOffer || undefined,
        ratePerMinute: cRate,
      } as Partial<Campaign>);

      const result = await salesApi.autoRun(campaign.id, leads);
      toast.success(
        '🚀 Campanha lançada!',
        `${String((result as Record<string, unknown>).generated ?? 0)} mensagens geradas · ${String((result as Record<string, unknown>).approved ?? 0)} no disparo`,
      );
      setCName('');
      setCOffer('');
      setCRate(6);
      setUploadedLeads([]);
      setUploadColumns([]);
      setUploadFileName('');
      setUploadPreview([]);
      setRawRows([]);
      setNameCol('');
      setPhoneCol('');
      setWizardStep(0);
      await refresh();
      setSelected(campaign);
    } catch (e) {
      toast.error('Erro ao lançar', e instanceof Error ? e.message : 'Falha');
      setWizardStep(1);
    } finally {
      setLaunching(false);
    }
  };

  const generate = async (c: Campaign) => {
    setBusy(true);
    try {
      const o = await salesApi.generate(c.id);
      setSelected(c);
      setOutreach(o);
      setMetrics(await salesApi.metrics(c.id));
      toast.success('Abordagens geradas', `${o.length} lead(s)`);
    } catch (e) {
      toast.error('Erro ao gerar', e instanceof Error ? e.message : 'Verifique os leads/fonte');
    } finally {
      setBusy(false);
    }
  };

  const saveMessage = async (o: Outreach, message: string) => {
    await salesApi.updateOutreach(o.id, { message });
    setOutreach(prev => prev.map(x => (x.id === o.id ? { ...x, message } : x)));
  };

  const createPgSource = async () => {
    if (!pgName.trim() || !pgHost.trim()) return;
    setPgBusy(true);
    try {
      const src = await salesApi.createSource({
        sessionId,
        name: pgName,
        type: 'postgres',
        config: {
          host: pgHost,
          port: Number(pgPort),
          database: pgDb,
          user: pgUser,
          password: pgPass,
          query: pgQuery,
          nameColumn: pgNameCol,
          phoneColumn: pgPhoneCol,
        },
      } as Partial<LeadSource>);
      toast.success('Fonte criada', src.name);
      setPgName('');
      setPgHost('');
      setPgDb('');
      setPgUser('');
      setPgPass('');
      setShowPgForm(false);
      await refresh();
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : 'Falha ao criar fonte');
    } finally {
      setPgBusy(false);
    }
  };

  const testSource = async (id: string) => {
    const r = await salesApi.testSource(id);
    if (r.ok) toast.success('Conexão OK', r.message);
    else toast.error('Falha', r.message);
  };

  const sendQuick = async () => {
    if (!sessionId || !qmPhone.trim() || !qmText.trim()) return;
    setQmBusy(true);
    try {
      const chatId = qmPhone.replace(/\D/g, '') + '@c.us';
      await messageApi.sendText(sessionId, chatId, qmText);
      toast.success('Mensagem enviada!', qmPhone);
      setQuickMsg(false);
      setQmPhone('');
      setQmText('');
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : 'Falha ao enviar');
    } finally {
      setQmBusy(false);
    }
  };

  const removeOptOut = async (id: string) => {
    await salesApi.removeOptOut(id);
    setOptOuts(prev => prev.filter(o => o.id !== id));
  };

  const send = async (c: Campaign) => {
    setBusy(true);
    try {
      const r = await salesApi.send(c.id);
      toast.success(
        'Envio iniciado',
        `${r.approved} abordagem(ns) na fila (cadência ${c.ratePerMinute}/min)`,
      );
      await loadCampaign(c);
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : 'Falha ao enviar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sales-page">
      <PageHeader
        title={t('nav.sales')}
        subtitle="Upload de planilha → IA gera mensagens personalizadas → disparo automático com cadência"
        actions={
          sessionId && (
            <button className="btn-primary" onClick={() => setQuickMsg(true)}>
              <MessageSquare size={16} /> Mensagem rápida
            </button>
          )
        }
      />

      {/* Modal mensagem rápida */}
      {quickMsg && (
        <div className="modal-overlay" onClick={() => setQuickMsg(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <Send size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                Mensagem rápida
              </h2>
              <button className="btn-icon" onClick={() => setQuickMsg(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Número (com código do país)</label>
                <input
                  type="text"
                  placeholder="5551993153058"
                  value={qmPhone}
                  onChange={e => setQmPhone(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Mensagem</label>
                <textarea
                  rows={5}
                  placeholder="Digite a mensagem..."
                  value={qmText}
                  onChange={e => setQmText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.ctrlKey) void sendQuick();
                  }}
                />
                <small>
                  Ctrl+Enter para enviar · Via sessão:{' '}
                  {sessions.find(s => s.id === sessionId)?.name}
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setQuickMsg(false)}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={() => void sendQuick()}
                disabled={qmBusy || !qmPhone.trim() || !qmText.trim()}
              >
                {qmBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="form-group">
        <label>Empresa (sessão)</label>
        <select value={sessionId} onChange={e => setSessionId(e.target.value)}>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} {s.phone ? `· ${s.phone}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Wizard card — Nova campanha automática */}
      <div className="sales-card wide wizard-card">
        <h3>
          <Sparkles size={16} /> Nova campanha automática
        </h3>

        {/* Step indicators */}
        <div className="wizard-steps">
          <div
            className={`wstep ${wizardStep >= 0 ? 'active' : ''} ${wizardStep > 0 ? 'done' : ''}`}
          >
            1 · Upload da planilha
          </div>
          <div className="wstep-arrow">→</div>
          <div
            className={`wstep ${wizardStep >= 1 ? 'active' : ''} ${wizardStep > 1 ? 'done' : ''}`}
          >
            2 · Configurar campanha
          </div>
          <div className="wstep-arrow">→</div>
          <div className={`wstep ${wizardStep >= 2 ? 'active' : ''}`}>3 · Lançar</div>
        </div>

        {/* Step 0: Upload */}
        {wizardStep === 0 && (
          <div>
            <div
              className={`upload-zone ${uploadFileName ? 'has-file' : ''}`}
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files?.[0]) parseFile(e.target.files[0]);
                }}
              />
              {uploadFileName ? (
                <>
                  <Upload size={32} className="upload-icon done" />
                  <p>
                    <strong>{uploadFileName}</strong>
                  </p>
                  <p className="muted">{uploadedLeads.length} contatos importados</p>
                </>
              ) : (
                <>
                  <Upload size={32} className="upload-icon" />
                  <p>
                    Arraste a planilha aqui ou <strong>clique para selecionar</strong>
                  </p>
                  <p className="muted">CSV, XLSX ou XLS · colunas: nome + telefone</p>
                </>
              )}
            </div>

            {uploadColumns.length > 0 && (
              <div className="col-map">
                <div className="sales-row">
                  <div className="form-group">
                    <label>Coluna de nome</label>
                    <select
                      value={nameCol}
                      onChange={e => handleNameColChange(e.target.value)}
                    >
                      {uploadColumns.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Coluna de telefone</label>
                    <select
                      value={phoneCol}
                      onChange={e => handlePhoneColChange(e.target.value)}
                    >
                      {uploadColumns.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Preview table */}
                <div className="preview-table-wrap">
                  <p className="muted" style={{ marginBottom: 6 }}>
                    Prévia (primeiras 3 linhas):
                  </p>
                  <table className="sales-table">
                    <thead>
                      <tr>
                        {uploadColumns.map(c => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadPreview.map((row, i) => (
                        <tr key={i}>
                          {uploadColumns.map(c => (
                            <td key={c}>{String(row[c] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => setWizardStep(1)}
                  disabled={!uploadedLeads.length}
                >
                  Próximo →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 1: Configure */}
        {wizardStep === 1 && (
          <div>
            <div className="form-group">
              <label>Nome da campanha</label>
              <input
                value={cName}
                onChange={e => setCName(e.target.value)}
                placeholder={`Disparo ${new Date().toLocaleDateString('pt-BR')}`}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Objetivo / oferta (a IA usa isso para personalizar cada mensagem e continuar a conversa)</label>
              <div className="preset-chips">
                {CAMPAIGN_PRESETS.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`preset-chip ${cOffer === p.hint ? 'active' : ''}`}
                    onClick={() => setCOffer(p.hint)}
                  >
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={cOffer}
                onChange={e => setCOffer(e.target.value)}
                placeholder="ex: reativar clientes inativos há 30 dias com oferta de 20% de desconto"
              />
            </div>
            <div className="form-group" style={{ maxWidth: 200 }}>
              <label>Envios por minuto</label>
              <input
                type="number"
                min={1}
                max={20}
                value={cRate}
                onChange={e => setCRate(Number(e.target.value))}
              />
              <small>Recomendado: 6/min para segurança do número</small>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-secondary" onClick={() => setWizardStep(0)}>
                ← Voltar
              </button>
              <button
                className="btn-primary"
                onClick={() => void autoLaunch()}
                disabled={!cName.trim() || !sessionId || launching}
              >
                {launching ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                🚀 Lançar campanha para {uploadedLeads.length} contatos
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Launching */}
        {wizardStep === 2 && (
          <div className="launching-state">
            <Loader2 size={32} className="spin" />
            <p>
              A IA está gerando mensagens personalizadas para {uploadedLeads.length} contatos...
            </p>
            <p className="muted">
              Isso pode levar alguns segundos. O disparo começa automaticamente.
            </p>
          </div>
        )}
      </div>

      {/* Campaigns grid */}
      <div className="sales-grid">
        {/* Campanhas */}
        <div className="sales-card">
          <h3>
            Campanhas{' '}
            <button className="btn-icon-sm" onClick={() => void refresh()}>
              <RefreshCw size={14} />
            </button>
          </h3>
          {campaigns.length === 0 && <p className="muted">Nenhuma campanha ainda.</p>}
          {campaigns.map(c => {
            const prog = progressMap[c.id];
            const pct =
              prog && prog.total > 0 ? Math.round((prog.sent / prog.total) * 100) : 0;
            return (
              <div
                key={c.id}
                className={`camp-item ${selected?.id === c.id ? 'active' : ''}`}
              >
                <div className="camp-info" onClick={() => void loadCampaign(c)}>
                  <strong>{c.name}</strong>
                  <span className="muted">
                    {c.status} · {c.ratePerMinute}/min
                  </span>
                  {prog && prog.total > 0 && (
                    <div className="prog-wrap">
                      <div className="prog-bar">
                        <div className="prog-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="prog-label">
                        {prog.sent}/{prog.total} enviadas ·{' '}
                        {prog.status === 'sending'
                          ? `~${prog.etaMinutes}min`
                          : prog.status === 'paused'
                            ? '⏸ pausada'
                            : 'concluída'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="camp-actions">
                  {['draft', 'ready'].includes(c.status) && (
                    <>
                      <button
                        className="btn-sm"
                        onClick={() => void generate(c)}
                        disabled={busy}
                        title="Gerar abordagens"
                      >
                        <Sparkles size={14} /> Gerar
                      </button>
                      <button
                        className="btn-sm primary"
                        onClick={() => void send(c)}
                        disabled={busy}
                      >
                        <Send size={14} /> Enviar
                      </button>
                    </>
                  )}
                  {c.status === 'sending' && (
                    <button
                      className="btn-sm"
                      onClick={() => void salesApi.pause(c.id).then(refresh)}
                      title="Pausar"
                    >
                      <Pause size={14} /> Pausar
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button
                      className="btn-sm primary"
                      onClick={() => void salesApi.resume(c.id).then(refresh)}
                      title="Retomar"
                    >
                      <Play size={14} /> Retomar
                    </button>
                  )}
                  <button
                    className="btn-icon-sm danger"
                    onClick={() => void salesApi.deleteCampaign(c.id).then(refresh)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fontes Postgres */}
      <div className="sales-card wide">
        <h3>
          <Database size={16} /> Fontes de leads (Postgres)
          <button
            className="btn-sm"
            style={{ marginLeft: 8 }}
            onClick={() => setShowPgForm(v => !v)}
          >
            {showPgForm ? 'Cancelar' : '+ Adicionar fonte'}
          </button>
        </h3>
        {showPgForm && (
          <div className="pg-form">
            <div className="sales-row">
              <div className="form-group">
                <label>Nome</label>
                <input
                  value={pgName}
                  onChange={e => setPgName(e.target.value)}
                  placeholder="Base de clientes"
                />
              </div>
              <div className="form-group">
                <label>Host</label>
                <input
                  value={pgHost}
                  onChange={e => setPgHost(e.target.value)}
                  placeholder="db.empresa.com"
                />
              </div>
              <div className="form-group">
                <label>Porta</label>
                <input value={pgPort} onChange={e => setPgPort(e.target.value)} />
              </div>
            </div>
            <div className="sales-row">
              <div className="form-group">
                <label>Banco</label>
                <input
                  value={pgDb}
                  onChange={e => setPgDb(e.target.value)}
                  placeholder="producao"
                />
              </div>
              <div className="form-group">
                <label>Usuário</label>
                <input value={pgUser} onChange={e => setPgUser(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Senha</label>
                <input
                  type="password"
                  value={pgPass}
                  onChange={e => setPgPass(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Query (somente leitura)</label>
              <textarea rows={3} value={pgQuery} onChange={e => setPgQuery(e.target.value)} />
            </div>
            <div className="sales-row">
              <div className="form-group">
                <label>Coluna nome</label>
                <input value={pgNameCol} onChange={e => setPgNameCol(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Coluna telefone</label>
                <input value={pgPhoneCol} onChange={e => setPgPhoneCol(e.target.value)} />
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={() => void createPgSource()}
              disabled={pgBusy || !sessionId}
            >
              {pgBusy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Salvar
              fonte
            </button>
          </div>
        )}
        {sources.filter(s => s.type === 'postgres').length === 0 && !showPgForm && (
          <p className="muted">Nenhuma fonte Postgres configurada.</p>
        )}
        {sources
          .filter(s => s.type === 'postgres')
          .map(s => (
            <div key={s.id} className="camp-item">
              <div className="camp-info">
                <strong>{s.name}</strong>
                <span className="muted">postgres</span>
              </div>
              <div className="camp-actions">
                <button className="btn-sm" onClick={() => void testSource(s.id)}>
                  Testar
                </button>
                <button
                  className="btn-icon-sm danger"
                  onClick={() => void salesApi.deleteSource(s.id).then(refresh)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* Opt-out */}
      <div className="sales-card wide">
        <h3>
          Descadastros (opt-out){' '}
          <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
            — {optOuts.length} contato(s)
          </span>
        </h3>
        {optOuts.length === 0 && <p className="muted">Nenhum contato descadastrado.</p>}
        {optOuts.length > 0 && (
          <table className="sales-table">
            <thead>
              <tr>
                <th>Telefone</th>
                <th>Data</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {optOuts.map(o => (
                <tr key={o.id}>
                  <td>{o.phone}</td>
                  <td className="muted">
                    {new Date(o.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td>
                    <button
                      className="btn-icon-sm danger"
                      onClick={() => void removeOptOut(o.id)}
                      title="Remover opt-out"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Funil + revisão */}
      {selected && (
        <div className="sales-card wide">
          <h3>Funil — {selected.name}</h3>
          <div className="funnel">
            {[
              'pending',
              'approved',
              'sent',
              'replied',
              'qualified',
              'won',
              'opted_out',
              'failed',
            ].map(st => (
              <div key={st} className="funnel-stat">
                <span className="fn">{metrics[st] ?? 0}</span>
                <span className="fl">{STAGE_LABEL[st]}</span>
              </div>
            ))}
          </div>

          <h4>Abordagens (revise antes de enviar)</h4>
          <table className="sales-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Score</th>
                <th>Necessidade</th>
                <th>Mensagem (editável)</th>
                <th>Estágio</th>
              </tr>
            </thead>
            <tbody>
              {outreach.map(o => (
                <tr key={o.id}>
                  <td>{o.leadName || o.phone || '—'}</td>
                  <td>
                    <span className="score">{o.score}</span>
                  </td>
                  <td className="muted">{o.need}</td>
                  <td>
                    <textarea
                      rows={3}
                      defaultValue={o.message}
                      onBlur={e => void saveMessage(o, e.target.value)}
                    />
                  </td>
                  <td>
                    <span className={`stage stage-${o.stage}`}>
                      {STAGE_LABEL[o.stage] ?? o.stage}
                    </span>
                  </td>
                </tr>
              ))}
              {outreach.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Clique em &quot;Gerar&quot; para criar as abordagens.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SalesEngine;
