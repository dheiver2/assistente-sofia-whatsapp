import { useState, useEffect, useCallback, useRef } from 'react';
import { read, utils } from 'xlsx';
import {
  Loader2, Upload, Send, Sparkles, Trash2, Database,
  RefreshCw, MessageSquare, X, Pause, Play, Plus,
  ChevronRight, Settings, Zap, BarChart3, Clock, FileText,
  CheckCircle2,
} from 'lucide-react';
import {
  sessionApi, salesApi, messageApi,
  type Session, type Campaign, type Outreach,
  type LeadSource, type SalesLead, type OptOut,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import './SalesEngine.css';

/* ── Constantes ─────────────────────────────────────────────── */

const CAMPAIGN_PRESETS = [
  { icon: '🔄', label: 'Reativação',   hint: 'Reativar clientes inativos há mais de 30 dias com oferta especial de retorno' },
  { icon: '🎁', label: 'Promoção',     hint: 'Divulgar promoção relâmpago com desconto exclusivo para clientes da base' },
  { icon: '📦', label: 'Produto novo', hint: 'Apresentar novo produto ou serviço para clientes que já compraram antes' },
  { icon: '🤝', label: 'Pós-venda',   hint: 'Follow-up pós-compra, verificar satisfação e oferecer upsell ou complemento' },
  { icon: '💳', label: 'Renovação',   hint: 'Lembrar clientes com contrato ou plano próximo do vencimento para renovar com condição especial' },
  { icon: '🎯', label: 'Recuperação', hint: 'Recuperar leads que demonstraram interesse mas não fecharam, com nova abordagem personalizada' },
];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', generating: 'Gerando…', ready: 'Pronta',
  sending: 'Disparando', paused: 'Pausada', done: 'Concluída',
};
const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', generating: '#3b82f6', ready: '#f59e0b',
  sending: '#ff7a1a', paused: '#f97316', done: '#64748b',
};
const STAGE_LABEL: Record<string, string> = {
  pending: 'Pendente', approved: 'Aprovada', sent: 'Enviada',
  replied: 'Respondeu', qualified: 'Qualificada', won: 'Ganha',
  lost: 'Perdida', opted_out: 'Opt-out', failed: 'Falha',
};

type CampaignProgress = {
  sent: number; approved: number; pending: number;
  failed: number; total: number; etaMinutes: number;
  rate: number; status: string;
};

type Tab = 'campanhas' | 'nova' | 'config';

/* ── Componente principal ────────────────────────────────────── */

export function SalesEngine() {
  useDocumentTitle('Campanhas');
  const toast = useToast();

  /* sessões */
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');

  /* dados */
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, CampaignProgress>>({});
  const [busy, setBusy] = useState(false);

  /* confirmação de ação destrutiva */
  const [confirm, setConfirm] = useState<{
    title: string; message: string; warning?: string; run: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  /* campanha selecionada (funil) */
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});

  /* aba ativa */
  const [tab, setTab] = useState<Tab>('campanhas');

  /* wizard nova campanha */
  const [wStep, setWStep] = useState(0);
  const [cName, setCName] = useState('');
  const [cOffer, setCOffer] = useState('');
  const [cRate, setCRate] = useState(6);
  const [launching, setLaunching] = useState(false);

  /* upload planilha */
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [uploadedLeads, setUploadedLeads] = useState<SalesLead[]>([]);
  const [uploadColumns, setUploadColumns] = useState<string[]>([]);
  const [nameCol, setNameCol] = useState('');
  const [phoneCol, setPhoneCol] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadPreview, setUploadPreview] = useState<Record<string, unknown>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* mídia da campanha */
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'document' | 'audio' | ''>('');

  /* agendamento */
  const [scheduledAt, setScheduledAt] = useState('');

  /* modal de relatório */
  const [reportModal, setReportModal] = useState<{ open: boolean; data: Record<string, unknown> | null }>({ open: false, data: null });

  /* postgres form */
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

  /* mensagem rápida */
  const [quickMsg, setQuickMsg] = useState(false);
  const [qmPhone, setQmPhone] = useState('');
  const [qmText, setQmText] = useState('');
  const [qmBusy, setQmBusy] = useState(false);

  /* ── carregamento inicial ── */
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

  /* progresso das campanhas ativas */
  useEffect(() => {
    const active = campaigns.filter(c => ['sending', 'paused', 'generating'].includes(c.status));
    if (!active.length) return;
    const poll = async () => {
      const res = await Promise.all(
        active.map(c =>
          salesApi.progress(c.id)
            .then(p => [c.id, p] as [string, CampaignProgress])
            .catch(() => null),
        ),
      );
      const m: Record<string, CampaignProgress> = {};
      res.forEach(r => { if (r) m[r[0]] = r[1]; });
      setProgressMap(prev => ({ ...prev, ...m }));
    };
    void poll();
    const tid = setInterval(() => void poll(), 8000);
    return () => clearInterval(tid);
  }, [campaigns]);

  /* ── funções de negócio ── */

  const loadCampaign = useCallback(async (c: Campaign) => {
    setSelected(c);
    const [o, m] = await Promise.all([salesApi.listOutreach(c.id), salesApi.metrics(c.id)]);
    setOutreach(o);
    setMetrics(m);
  }, []);

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const data = e.target?.result;
      const wb = read(data, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (!rows.length) { toast.error('Arquivo vazio', ''); return; }
      const cols = Object.keys(rows[0]);
      setUploadColumns(cols);
      setUploadPreview(rows.slice(0, 3));
      setRawRows(rows);
      const nGuess = cols.find(c => /nome|name|cliente|contact/i.test(c)) ?? cols[0];
      const pGuess = cols.find(c => /fone|tel|celular|phone|whatsapp|numero/i.test(c)) ?? cols[1] ?? cols[0];
      setNameCol(nGuess);
      setPhoneCol(pGuess);
      setUploadedLeads(rows.map(row => ({ name: String(row[nGuess] ?? ''), phone: String(row[pGuess] ?? ''), attributes: row })));
      setUploadFileName(file.name);
      toast.success(`${rows.length} contatos importados`, file.name);
    };
    reader.readAsBinaryString(file);
  };

  const remapLeads = useCallback((nCol: string, pCol: string) => {
    if (!rawRows.length) return;
    setUploadedLeads(rawRows.map(row => ({ name: String(row[nCol] ?? ''), phone: String(row[pCol] ?? ''), attributes: row })));
  }, [rawRows]);

  const autoLaunch = async () => {
    if (!sessionId || !cName.trim() || !uploadedLeads.length) return;
    setLaunching(true);
    setWStep(2);
    try {
      const leads: SalesLead[] = rawRows.map(row => ({
        name: String(row[nameCol] ?? ''), phone: String(row[phoneCol] ?? ''), attributes: row,
      }));
      const campaign = await salesApi.createCampaign({ sessionId, name: cName, offerHint: cOffer || undefined, ratePerMinute: cRate, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined } as Partial<Campaign>);
      const result = await salesApi.autoRun(campaign.id, leads) as Record<string, unknown>;
      if (mediaUrl && mediaType) {
        await salesApi.attachMedia(campaign.id, mediaUrl, mediaType);
      }
      toast.success('🚀 Campanha lançada!', `${String(result.generated ?? 0)} mensagens · ${String(result.approved ?? 0)} no disparo`);
      setCName(''); setCOffer(''); setCRate(6);
      setMediaUrl(''); setMediaType(''); setScheduledAt('');
      setUploadedLeads([]); setUploadColumns([]); setUploadFileName(''); setUploadPreview([]); setRawRows([]);
      setWStep(0);
      setTab('campanhas');
      await refresh();
      setSelected(campaign);
    } catch (e) {
      toast.error('Erro ao lançar', e instanceof Error ? e.message : 'Falha');
      setWStep(1);
    } finally {
      setLaunching(false);
    }
  };

  const generate = async (c: Campaign) => {
    setBusy(true);
    try {
      const o = await salesApi.generate(c.id);
      setSelected(c); setOutreach(o); setMetrics(await salesApi.metrics(c.id));
      toast.success('Abordagens geradas', `${o.length} lead(s)`);
    } catch (e) { toast.error('Erro', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };

  const send = async (c: Campaign) => {
    setBusy(true);
    try {
      const r = await salesApi.send(c.id);
      toast.success('Envio iniciado', `${r.approved} na fila`);
      await loadCampaign(c);
    } catch (e) { toast.error('Erro', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };

  const saveMessage = async (o: Outreach, message: string) => {
    await salesApi.updateOutreach(o.id, { message });
    setOutreach(prev => prev.map(x => (x.id === o.id ? { ...x, message } : x)));
  };

  const createPgSource = async () => {
    if (!pgName.trim() || !pgHost.trim()) return;
    setPgBusy(true);
    try {
      const src = await salesApi.createSource({ sessionId, name: pgName, type: 'postgres', config: { host: pgHost, port: Number(pgPort), database: pgDb, user: pgUser, password: pgPass, query: pgQuery, nameColumn: pgNameCol, phoneColumn: pgPhoneCol } } as Partial<LeadSource>);
      toast.success('Fonte criada', src.name);
      setPgName(''); setPgHost(''); setPgDb(''); setPgUser(''); setPgPass(''); setShowPgForm(false);
      await refresh();
    } catch (e) { toast.error('Erro', e instanceof Error ? e.message : ''); }
    finally { setPgBusy(false); }
  };

  const sendQuick = async () => {
    if (!sessionId || !qmPhone.trim() || !qmText.trim()) return;
    setQmBusy(true);
    try {
      await messageApi.sendText(sessionId, qmPhone.replace(/\D/g, '') + '@c.us', qmText);
      toast.success('Mensagem enviada!', qmPhone);
      setQuickMsg(false); setQmPhone(''); setQmText('');
    } catch (e) { toast.error('Erro', e instanceof Error ? e.message : ''); }
    finally { setQmBusy(false); }
  };

  /* ── RENDER ─────────────────────────────────────────────────── */

  return (
    <div className="se-page">

      {/* ── Barra superior ── */}
      <div className="se-topbar">
        <div className="se-topbar-left">
          <h1 className="se-title">Campanhas</h1>
          <select className="se-session-select" value={sessionId} onChange={e => setSessionId(e.target.value)}>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` · ${s.phone}` : ''}</option>)}
          </select>
        </div>
        <div className="se-topbar-right">
          <button className="se-btn-ghost" onClick={() => void refresh()} title="Atualizar"><RefreshCw size={16} /></button>
          <button className="se-btn-secondary" onClick={() => setQuickMsg(true)}><MessageSquare size={15} /> Mensagem rápida</button>
          <button className="se-btn-primary" onClick={() => { setTab('nova'); setWStep(0); }}><Zap size={15} /> Nova campanha</button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="se-tabs">
        <button className={`se-tab ${tab === 'campanhas' ? 'active' : ''}`} onClick={() => setTab('campanhas')}>
          <BarChart3 size={15} /> Campanhas
          {campaigns.length > 0 && <span className="se-tab-badge">{campaigns.length}</span>}
        </button>
        <button className={`se-tab ${tab === 'nova' ? 'active' : ''}`} onClick={() => { setTab('nova'); setWStep(0); }}>
          <Sparkles size={15} /> Nova campanha
        </button>
        <button className={`se-tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>
          <Settings size={15} /> Fontes &amp; Config
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════
          TAB 1 — CAMPANHAS
      ═══════════════════════════════════════════════════ */}
      {tab === 'campanhas' && (
        <div className="se-body">
          {campaigns.length === 0 ? (
            <div className="se-empty">
              <Sparkles size={40} className="se-empty-icon" />
              <h2>Nenhuma campanha ainda</h2>
              <p>Crie sua primeira campanha em minutos — faça upload de uma planilha e a IA personaliza cada mensagem automaticamente.</p>
              <button className="se-btn-primary" onClick={() => setTab('nova')}><Zap size={15} /> Criar primeira campanha</button>
            </div>
          ) : (
            <>
              <div className="se-kpis">
                <div className="se-kpi">
                  <div className="se-kpi-icon kpi-blue"><BarChart3 size={18} /></div>
                  <div className="se-kpi-body">
                    <span className="se-kpi-num">{campaigns.length}</span>
                    <span className="se-kpi-lbl">Campanhas</span>
                  </div>
                </div>
                <div className="se-kpi">
                  <div className="se-kpi-icon kpi-green"><Send size={18} /></div>
                  <div className="se-kpi-body">
                    <span className="se-kpi-num">{campaigns.filter(c => c.status === 'sending').length}</span>
                    <span className="se-kpi-lbl">Em disparo</span>
                  </div>
                </div>
                <div className="se-kpi">
                  <div className="se-kpi-icon kpi-amber"><Clock size={18} /></div>
                  <div className="se-kpi-body">
                    <span className="se-kpi-num">{campaigns.filter(c => c.scheduledAt && c.status === 'draft').length}</span>
                    <span className="se-kpi-lbl">Agendadas</span>
                  </div>
                </div>
                <div className="se-kpi">
                  <div className="se-kpi-icon kpi-teal"><CheckCircle2 size={18} /></div>
                  <div className="se-kpi-body">
                    <span className="se-kpi-num">{campaigns.filter(c => c.status === 'done').length}</span>
                    <span className="se-kpi-lbl">Concluídas</span>
                  </div>
                </div>
              </div>
              <div className="se-campaign-list">
              {campaigns.map(c => {
                const prog = progressMap[c.id];
                const pct = prog && prog.total > 0 ? Math.round((prog.sent / prog.total) * 100) : 0;
                const isSelected = selected?.id === c.id;
                return (
                  <div key={c.id} className={`se-camp ${isSelected ? 'selected' : ''}`}>
                    <div className="se-camp-row" onClick={() => void loadCampaign(c)}>
                      {/* status dot */}
                      <span className="se-status-dot" style={{ background: STATUS_COLOR[c.status] ?? '#94a3b8' }} />
                      <div className="se-camp-info">
                        <span className="se-camp-name">{c.name}</span>
                        <span className="se-camp-meta">
                          <span className="se-badge" style={{ background: STATUS_COLOR[c.status] + '22', color: STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status] ?? c.status}</span>
                          <span className="se-camp-rate">{c.ratePerMinute} msg/min</span>
                        </span>
                        {c.scheduledAt && c.status === 'draft' ? (
                          <div className="se-prog">
                            <span className="se-prog-txt" style={{display:'flex',alignItems:'center',gap:4}}>
                              <Clock size={12} style={{color:'var(--warning)'}} />
                              Agendado para {new Date(c.scheduledAt).toLocaleDateString('pt-BR')} às {new Date(c.scheduledAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
                            </span>
                          </div>
                        ) : prog && prog.total > 0 && (
                          <div className="se-prog">
                            <div className="se-prog-bar"><div className="se-prog-fill" style={{ width: `${pct}%` }} /></div>
                            <span className="se-prog-txt">{prog.sent}/{prog.total} enviadas{prog.status === 'sending' ? ` · ~${prog.etaMinutes}min` : prog.status === 'paused' ? ' · pausada' : ' · concluída'}</span>
                          </div>
                        )}
                      </div>
                      <ChevronRight size={16} className={`se-chevron ${isSelected ? 'open' : ''}`} />
                    </div>

                    {/* actions row */}
                    <div className="se-camp-actions">
                      {['draft', 'ready'].includes(c.status) && <>
                        <button className="se-btn-sm" onClick={() => void generate(c)} disabled={busy}><Sparkles size={13} /> Gerar mensagens</button>
                        <button className="se-btn-sm primary" onClick={() => void send(c)} disabled={busy}><Send size={13} /> Iniciar disparo</button>
                      </>}
                      {c.status === 'sending' && <button className="se-btn-sm" onClick={() => void salesApi.pause(c.id).then(refresh).catch(e => toast.error('Erro ao pausar', e instanceof Error ? e.message : ''))}><Pause size={13} /> Pausar</button>}
                      {c.status === 'paused' && <button className="se-btn-sm primary" onClick={() => void salesApi.resume(c.id).then(refresh).catch(e => toast.error('Erro ao retomar', e instanceof Error ? e.message : ''))}><Play size={13} /> Retomar</button>}
                      {['done', 'sending'].includes(c.status) && (
                        <button className="se-btn-sm" onClick={() => void salesApi.report(c.id).then(data => setReportModal({ open: true, data })).catch(() => setReportModal({ open: true, data: {} }))}>
                          <FileText size={13} /> Relatório
                        </button>
                      )}
                      <button
                        className="se-btn-icon danger"
                        aria-label="Excluir campanha"
                        title="Excluir"
                        onClick={() => setConfirm({
                          title: 'Excluir campanha',
                          message: `Excluir a campanha "${c.name}"? Todos os leads e mensagens dela serão removidos.`,
                          warning: 'Esta ação não pode ser desfeita.',
                          run: async () => {
                            await salesApi.deleteCampaign(c.id);
                            await refresh();
                            toast.success('Campanha excluída', c.name);
                          },
                        })}
                      ><Trash2 size={13} /></button>
                    </div>

                    {/* funil expandido */}
                    {isSelected && (
                      <div className="se-funnel-panel">
                        <div className="se-funnel-stats">
                          {['pending','approved','sent','replied','qualified','won','opted_out','failed'].map(st => (
                            <div key={st} className="se-fstat">
                              <span className="se-fnum">{metrics[st] ?? 0}</span>
                              <span className="se-flbl">{STAGE_LABEL[st]}</span>
                            </div>
                          ))}
                        </div>
                        {outreach.length > 0 && (
                          <div className="se-outreach-wrap">
                            <p className="se-section-label">Abordagens geradas</p>
                            <table className="se-table">
                              <thead><tr><th>Lead</th><th>Score</th><th>Necessidade</th><th>Mensagem</th><th>Estágio</th></tr></thead>
                              <tbody>
                                {outreach.map(o => (
                                  <tr key={o.id}>
                                    <td>{o.leadName || o.phone || '—'}</td>
                                    <td><span className="se-score">{o.score}</span></td>
                                    <td className="se-muted">{o.need}</td>
                                    <td><textarea rows={2} defaultValue={o.message} onBlur={e => void saveMessage(o, e.target.value)} /></td>
                                    <td><span className={`se-stage se-stage-${o.stage}`}>{STAGE_LABEL[o.stage] ?? o.stage}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          TAB 2 — NOVA CAMPANHA (wizard)
      ═══════════════════════════════════════════════════ */}
      {tab === 'nova' && (
        <div className="se-body se-wizard-body">
          {/* step indicators */}
          <div className="se-wsteps">
            {['Upload da planilha','Configurar','Lançar'].map((label, i) => (
              <div key={i} className={`se-wstep ${wStep === i ? 'active' : ''} ${wStep > i ? 'done' : ''}`}>
                <span className="se-wstep-num">{wStep > i ? '✓' : i + 1}</span>
                <span className="se-wstep-label">{label}</span>
                {i < 2 && <span className="se-wstep-arrow">›</span>}
              </div>
            ))}
          </div>

          {/* STEP 0 — Upload */}
          {wStep === 0 && (
            <div className="se-step-card">
              <h2 className="se-step-title">Upload da planilha de contatos</h2>
              <p className="se-muted" style={{marginBottom:16}}>CSV, XLSX ou XLS — a IA detecta automaticamente as colunas de nome e telefone.</p>
              <div
                className={`se-upload-zone ${uploadFileName ? 'has-file' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}} onChange={e => { if (e.target.files?.[0]) parseFile(e.target.files[0]); }} />
                {uploadFileName ? (
                  <>
                    <Upload size={36} className="se-upload-icon done" />
                    <p><strong>{uploadFileName}</strong></p>
                    <p className="se-muted">{uploadedLeads.length} contatos prontos para a campanha</p>
                  </>
                ) : (
                  <>
                    <Upload size={36} className="se-upload-icon" />
                    <p><strong>Arraste aqui</strong> ou clique para selecionar</p>
                    <p className="se-muted">Qualquer planilha com nome + telefone</p>
                  </>
                )}
              </div>

              {uploadColumns.length > 0 && (
                <div className="se-col-map">
                  <div className="se-row-2">
                    <div className="se-field">
                      <label>Coluna de nome</label>
                      <select value={nameCol} onChange={e => { setNameCol(e.target.value); remapLeads(e.target.value, phoneCol); }}>
                        {uploadColumns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="se-field">
                      <label>Coluna de telefone</label>
                      <select value={phoneCol} onChange={e => { setPhoneCol(e.target.value); remapLeads(nameCol, e.target.value); }}>
                        {uploadColumns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <p className="se-muted" style={{margin:'12px 0 6px'}}>Prévia:</p>
                  <div className="se-preview-wrap">
                    <table className="se-table compact">
                      <thead><tr>{uploadColumns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>{uploadPreview.map((row, i) => <tr key={i}>{uploadColumns.map(c => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  <div className="se-step-actions">
                    <button className="se-btn-primary" onClick={() => setWStep(1)} disabled={!uploadedLeads.length}>
                      Próximo — Configurar campanha →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 1 — Configurar */}
          {wStep === 1 && (
            <div className="se-step-card">
              <h2 className="se-step-title">Configurar a campanha</h2>
              <div className="se-field">
                <label>Nome da campanha</label>
                <input value={cName} onChange={e => setCName(e.target.value)} placeholder={`Disparo ${new Date().toLocaleDateString('pt-BR')}`} autoFocus />
              </div>
              <div className="se-field">
                <label>Objetivo / oferta <span className="se-muted">(a IA personaliza cada mensagem com base nisso)</span></label>
                <div className="se-preset-chips">
                  {CAMPAIGN_PRESETS.map(p => (
                    <button key={p.label} type="button" className={`se-chip ${cOffer === p.hint ? 'active' : ''}`} onClick={() => setCOffer(p.hint)}>
                      {p.icon} {p.label}
                    </button>
                  ))}
                </div>
                <textarea rows={2} value={cOffer} onChange={e => setCOffer(e.target.value)} placeholder="ex: reativar clientes inativos há 30 dias com 20% de desconto" />
              </div>
              <div className="se-field" style={{maxWidth:220}}>
                <label>Envios por minuto <span className="se-muted">(recomendado: 6)</span></label>
                <input type="number" min={1} max={20} value={cRate} onChange={e => setCRate(Number(e.target.value))} />
              </div>
              {/* Mídia opcional */}
              <div className="se-media-section">
                <label className="se-field" style={{marginBottom:0}}>
                  <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em'}}>
                    Mídia da campanha <span style={{fontWeight:400,textTransform:'none'}}>(opcional)</span>
                  </span>
                </label>
                <div className="se-media-types">
                  {([['image','📷 Imagem'],['video','🎬 Vídeo'],['document','📄 Documento'],['audio','🎵 Áudio']] as const).map(([type, label]) => (
                    <button
                      key={type}
                      type="button"
                      className={`se-media-type-btn${mediaType === type ? ' active' : ''}`}
                      onClick={() => { setMediaType(mediaType === type ? '' : type); if (mediaType === type) setMediaUrl(''); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {mediaType && (
                  <input
                    type="url"
                    className="se-media-url-input"
                    placeholder={`URL da mídia (${mediaType === 'image' ? 'https://…/imagem.jpg' : mediaType === 'video' ? 'https://…/video.mp4' : mediaType === 'document' ? 'https://…/arquivo.pdf' : 'https://…/audio.mp3'})`}
                    value={mediaUrl}
                    onChange={e => setMediaUrl(e.target.value)}
                    style={{background:'var(--bg-light)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-primary)',padding:'8px 12px',fontSize:13.5,width:'100%',boxSizing:'border-box'}}
                  />
                )}
              </div>

              {/* Agendamento opcional */}
              <div className="se-field" style={{marginTop:8}}>
                <label>Agendar envio <span className="se-muted">(opcional)</span></label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  style={{background:'var(--bg-light)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-primary)',padding:'8px 12px',fontSize:13.5,width:'100%',boxSizing:'border-box'}}
                />
                {scheduledAt && (
                  <p className="se-muted" style={{marginTop:6,fontSize:13}}>
                    <Clock size={12} style={{display:'inline',marginRight:4,verticalAlign:'middle'}} />
                    Será disparado em {new Date(scheduledAt).toLocaleDateString('pt-BR')} às {new Date(scheduledAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
                  </p>
                )}
              </div>

              <div className="se-summary-box">
                <span>📋</span>
                <span><strong>{uploadedLeads.length} contatos</strong> de <strong>{uploadFileName}</strong></span>
                <button className="se-btn-ghost" onClick={() => setWStep(0)}>Trocar planilha</button>
              </div>
              <div className="se-step-actions">
                <button className="se-btn-secondary" onClick={() => setWStep(0)}>← Voltar</button>
                <button className="se-btn-primary" onClick={() => void autoLaunch()} disabled={!cName.trim() || !sessionId || launching}>
                  {launching ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                  🚀 Lançar para {uploadedLeads.length} contatos
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — Lançando */}
          {wStep === 2 && (
            <div className="se-step-card se-launching">
              <Loader2 size={48} className="spin" style={{color:'var(--primary)'}} />
              <h2>Lançando campanha…</h2>
              <p className="se-muted">A IA está gerando mensagens personalizadas para {uploadedLeads.length} contatos.<br/>O disparo começa automaticamente em seguida.</p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          TAB 3 — FONTES & CONFIG
      ═══════════════════════════════════════════════════ */}
      {tab === 'config' && (
        <div className="se-body">

          {/* Fontes Postgres */}
          <div className="se-section">
            <div className="se-section-header">
              <div>
                <h2><Database size={16} /> Fontes de leads (Postgres)</h2>
                <p className="se-muted">Conecte uma base de dados para usar como origem de leads em campanhas.</p>
              </div>
              <button className="se-btn-secondary" onClick={() => setShowPgForm(v => !v)}>
                <Plus size={14} /> {showPgForm ? 'Cancelar' : 'Nova fonte'}
              </button>
            </div>

            {showPgForm && (
              <div className="se-pg-form">
                <div className="se-row-3">
                  <div className="se-field"><label>Nome</label><input value={pgName} onChange={e => setPgName(e.target.value)} placeholder="Base de clientes" /></div>
                  <div className="se-field"><label>Host</label><input value={pgHost} onChange={e => setPgHost(e.target.value)} placeholder="host.docker.internal" /></div>
                  <div className="se-field"><label>Porta</label><input value={pgPort} onChange={e => setPgPort(e.target.value)} /></div>
                </div>
                <div className="se-row-3">
                  <div className="se-field"><label>Banco</label><input value={pgDb} onChange={e => setPgDb(e.target.value)} placeholder="leads_demo" /></div>
                  <div className="se-field"><label>Usuário</label><input value={pgUser} onChange={e => setPgUser(e.target.value)} /></div>
                  <div className="se-field"><label>Senha</label><input type="password" value={pgPass} onChange={e => setPgPass(e.target.value)} /></div>
                </div>
                <div className="se-field"><label>Query (somente leitura)</label><textarea rows={2} value={pgQuery} onChange={e => setPgQuery(e.target.value)} /></div>
                <div className="se-row-2">
                  <div className="se-field"><label>Coluna nome</label><input value={pgNameCol} onChange={e => setPgNameCol(e.target.value)} /></div>
                  <div className="se-field"><label>Coluna telefone</label><input value={pgPhoneCol} onChange={e => setPgPhoneCol(e.target.value)} /></div>
                </div>
                <div className="se-pg-hint">
                  💡 Demo disponível: <code>host.docker.internal</code> porta <code>5433</code> banco <code>leads_demo</code> usuário <code>leads</code> senha <code>leads123</code>
                </div>
                <button className="se-btn-primary" onClick={() => void createPgSource()} disabled={pgBusy || !sessionId}>
                  {pgBusy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Salvar fonte
                </button>
              </div>
            )}

            {sources.filter(s => s.type === 'postgres').length === 0 && !showPgForm && (
              <p className="se-empty-inline">Nenhuma fonte configurada — adicione uma para usar em campanhas.</p>
            )}
            {sources.filter(s => s.type === 'postgres').map(s => (
              <div key={s.id} className="se-source-row">
                <Database size={15} className="se-muted" />
                <span className="se-source-name">{s.name}</span>
                <span className="se-muted">postgres</span>
                <button className="se-btn-sm" onClick={() => void salesApi.testSource(s.id).then(r => r.ok ? toast.success('OK', r.message) : toast.error('Falha', r.message))}>Testar</button>
                <button
                  className="se-btn-icon danger"
                  aria-label="Excluir fonte"
                  title="Excluir fonte"
                  onClick={() => setConfirm({
                    title: 'Excluir fonte de leads',
                    message: `Remover a fonte "${s.name}"?`,
                    run: async () => {
                      await salesApi.deleteSource(s.id);
                      await refresh();
                      toast.success('Fonte removida', s.name);
                    },
                  })}
                ><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          {/* Opt-out */}
          <div className="se-section">
            <div className="se-section-header">
              <div>
                <h2>Descadastros (opt-out)</h2>
                <p className="se-muted">{optOuts.length} contato(s) que solicitaram não receber mensagens.</p>
              </div>
            </div>
            {optOuts.length === 0 && <p className="se-empty-inline">Nenhum descadastro registrado.</p>}
            {optOuts.length > 0 && (
              <table className="se-table">
                <thead><tr><th>Telefone</th><th>Data</th><th></th></tr></thead>
                <tbody>
                  {optOuts.map(o => (
                    <tr key={o.id}>
                      <td>{o.phone}</td>
                      <td className="se-muted">{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td>
                      <td><button className="se-btn-icon danger" aria-label="Remover descadastro" title="Remover" onClick={() => void salesApi.removeOptOut(o.id).then(() => setOptOuts(p => p.filter(x => x.id !== o.id))).catch(e => toast.error('Erro ao remover', e instanceof Error ? e.message : ''))}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Modal relatório ── */}
      {reportModal.open && (
        <div className="se-overlay" onClick={() => setReportModal({ open: false, data: null })}>
          <div className="se-modal se-report-modal" onClick={e => e.stopPropagation()}>
            <div className="se-modal-header">
              <h3><FileText size={15} /> Relatório da campanha</h3>
              <button className="se-btn-icon" onClick={() => setReportModal({ open: false, data: null })}><X size={18} /></button>
            </div>
            <div className="se-modal-body">
              {reportModal.data && Object.keys(reportModal.data).length > 0 ? (
                <div className="se-report-grid">
                  <div className="se-report-stat">
                    <span className="se-report-value">{String(reportModal.data.totalSent ?? reportModal.data.sent ?? '—')}</span>
                    <span className="se-report-label">Total enviados</span>
                  </div>
                  <div className="se-report-stat">
                    <span className="se-report-value">{reportModal.data.replyRate != null ? `${String(reportModal.data.replyRate)}%` : reportModal.data.replied != null ? String(reportModal.data.replied) : '—'}</span>
                    <span className="se-report-label">Taxa de resposta</span>
                  </div>
                  <div className="se-report-stat">
                    <span className="se-report-value">{String(reportModal.data.conversions ?? reportModal.data.won ?? '—')}</span>
                    <span className="se-report-label">Conversões</span>
                  </div>
                  <div className="se-report-stat">
                    <span className="se-report-value">{reportModal.data.avgScore != null ? String(reportModal.data.avgScore) : '—'}</span>
                    <span className="se-report-label">Score médio</span>
                  </div>
                </div>
              ) : (
                <p className="se-muted" style={{textAlign:'center',padding:'24px 0'}}>Nenhum dado disponível para esta campanha.</p>
              )}
            </div>
            <div className="se-modal-footer">
              <button className="se-btn-secondary" onClick={() => setReportModal({ open: false, data: null })}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal mensagem rápida ── */}
      {quickMsg && (
        <div className="se-overlay" onClick={() => setQuickMsg(false)}>
          <div className="se-modal" onClick={e => e.stopPropagation()}>
            <div className="se-modal-header">
              <h3><Send size={15} /> Mensagem rápida</h3>
              <button className="se-btn-icon" onClick={() => setQuickMsg(false)}><X size={18} /></button>
            </div>
            <div className="se-modal-body">
              <div className="se-field"><label>Número (com código do país)</label><input type="text" placeholder="5551993153058" value={qmPhone} onChange={e => setQmPhone(e.target.value)} autoFocus /></div>
              <div className="se-field"><label>Mensagem</label><textarea rows={4} value={qmText} onChange={e => setQmText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) void sendQuick(); }} placeholder="Digite a mensagem… (Ctrl+Enter para enviar)" /></div>
            </div>
            <div className="se-modal-footer">
              <button className="se-btn-secondary" onClick={() => setQuickMsg(false)}>Cancelar</button>
              <button className="se-btn-primary" onClick={() => void sendQuick()} disabled={qmBusy || !qmPhone.trim() || !qmText.trim()}>
                {qmBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        warning={confirm?.warning}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        busy={confirmBusy}
        onCancel={() => { if (!confirmBusy) setConfirm(null); }}
        onConfirm={() => {
          if (!confirm) return;
          setConfirmBusy(true);
          void confirm.run()
            .catch(e => toast.error('Erro', e instanceof Error ? e.message : ''))
            .finally(() => { setConfirmBusy(false); setConfirm(null); });
        }}
      />
    </div>
  );
}

export default SalesEngine;
