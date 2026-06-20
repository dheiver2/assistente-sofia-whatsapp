import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Send, Sparkles, Trash2, Database, RefreshCw, MessageSquare, X } from 'lucide-react';
import { sessionApi, salesApi, messageApi, type Session, type Campaign, type Outreach, type LeadSource, type SalesLead, type OptOut } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import './SalesEngine.css';

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

  // Mensagem rápida
  const [quickMsg, setQuickMsg] = useState(false);
  const [qmPhone, setQmPhone] = useState('');
  const [qmText, setQmText] = useState('');
  const [qmBusy, setQmBusy] = useState(false);

  // formulários — fonte Postgres
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

  // formulários — campanha
  const [cName, setCName] = useState('');
  const [cOffer, setCOffer] = useState('');
  const [cRate, setCRate] = useState(6);
  const [cCrm, setCCrm] = useState('');
  const [cSource, setCSource] = useState('');
  const [leadsJson, setLeadsJson] = useState(
    '[\n  { "name": "Marcos", "phone": "5511999990001", "attributes": { "plano": "Mensal", "dias_sem_treinar": 30 } }\n]',
  );

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

  const loadCampaign = useCallback(async (c: Campaign) => {
    setSelected(c);
    const [o, m] = await Promise.all([salesApi.listOutreach(c.id), salesApi.metrics(c.id)]);
    setOutreach(o);
    setMetrics(m);
  }, []);

  const createCampaign = async () => {
    if (!cName.trim()) return;
    setBusy(true);
    try {
      const c = await salesApi.createCampaign({
        sessionId,
        name: cName,
        offerHint: cOffer || undefined,
        ratePerMinute: cRate,
        crmWebhookUrl: cCrm || undefined,
        leadSourceId: cSource || undefined,
      } as Partial<Campaign>);
      setCName('');
      setCOffer('');
      setCCrm('');
      await refresh();
      toast.success('Campanha criada', c.name);
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : 'Falha ao criar');
    } finally {
      setBusy(false);
    }
  };

  const generate = async (c: Campaign) => {
    setBusy(true);
    try {
      let leads: SalesLead[] | undefined;
      if (!c.leadSourceId) {
        leads = JSON.parse(leadsJson) as SalesLead[];
      }
      const o = await salesApi.generate(c.id, leads);
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
          host: pgHost, port: Number(pgPort), database: pgDb, user: pgUser, password: pgPass,
          query: pgQuery, nameColumn: pgNameCol, phoneColumn: pgPhoneCol,
        },
      } as Partial<LeadSource>);
      toast.success('Fonte criada', src.name);
      setPgName(''); setPgHost(''); setPgDb(''); setPgUser(''); setPgPass('');
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
      toast.success('Envio iniciado', `${r.approved} abordagem(ns) na fila (cadência ${c.ratePerMinute}/min)`);
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
        subtitle="Vendas ativas: a IA lê a base, gera a abordagem e conduz a conversa"
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
              <h2><Send size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Mensagem rápida</h2>
              <button className="btn-icon" onClick={() => setQuickMsg(false)}><X size={20} /></button>
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
                  onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) void sendQuick(); }}
                />
                <small>Ctrl+Enter para enviar · Via sessão: {sessions.find(s => s.id === sessionId)?.name}</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setQuickMsg(false)}>Cancelar</button>
              <button className="btn-primary" onClick={() => void sendQuick()} disabled={qmBusy || !qmPhone.trim() || !qmText.trim()}>
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

      <div className="sales-grid">
        {/* Criar campanha */}
        <div className="sales-card">
          <h3><Plus size={16} /> Nova campanha</h3>
          <div className="form-group">
            <label>Nome</label>
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Reativação de inativos" />
          </div>
          <div className="form-group">
            <label>Objetivo / oferta</label>
            <input value={cOffer} onChange={e => setCOffer(e.target.value)} placeholder="trazer de volta quem parou de treinar" />
          </div>
          <div className="sales-row">
            <div className="form-group">
              <label>Envios por minuto</label>
              <input type="number" min={1} max={60} value={cRate} onChange={e => setCRate(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label>Fonte de leads</label>
              <select value={cSource} onChange={e => setCSource(e.target.value)}>
                <option value="">Leads inline (abaixo)</option>
                {sources.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>CRM webhook (opcional)</label>
            <input value={cCrm} onChange={e => setCCrm(e.target.value)} placeholder="https://seu-crm/webhook" />
          </div>
          {!cSource && (
            <div className="form-group">
              <label><Database size={13} /> Leads inline (JSON)</label>
              <textarea rows={6} value={leadsJson} onChange={e => setLeadsJson(e.target.value)} />
            </div>
          )}
          <button className="btn-primary" onClick={() => void createCampaign()} disabled={busy || !sessionId}>
            {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Criar campanha
          </button>
        </div>

        {/* Campanhas */}
        <div className="sales-card">
          <h3>Campanhas <button className="btn-icon-sm" onClick={() => void refresh()}><RefreshCw size={14} /></button></h3>
          {campaigns.length === 0 && <p className="muted">Nenhuma campanha ainda.</p>}
          {campaigns.map(c => (
            <div key={c.id} className={`camp-item ${selected?.id === c.id ? 'active' : ''}`}>
              <div className="camp-info" onClick={() => void loadCampaign(c)}>
                <strong>{c.name}</strong>
                <span className="muted">{c.status} · {c.ratePerMinute}/min</span>
              </div>
              <div className="camp-actions">
                <button className="btn-sm" onClick={() => void generate(c)} disabled={busy} title="Gerar abordagens">
                  <Sparkles size={14} /> Gerar
                </button>
                <button className="btn-sm primary" onClick={() => void send(c)} disabled={busy} title="Aprovar e enviar">
                  <Send size={14} /> Enviar
                </button>
                <button className="btn-icon-sm danger" onClick={() => void salesApi.deleteCampaign(c.id).then(refresh)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fontes Postgres */}
      <div className="sales-card wide">
        <h3>
          <Database size={16} /> Fontes de leads (Postgres)
          <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setShowPgForm(v => !v)}>
            {showPgForm ? 'Cancelar' : '+ Adicionar fonte'}
          </button>
        </h3>
        {showPgForm && (
          <div className="pg-form">
            <div className="sales-row">
              <div className="form-group"><label>Nome</label><input value={pgName} onChange={e => setPgName(e.target.value)} placeholder="Base de clientes" /></div>
              <div className="form-group"><label>Host</label><input value={pgHost} onChange={e => setPgHost(e.target.value)} placeholder="db.empresa.com" /></div>
              <div className="form-group"><label>Porta</label><input value={pgPort} onChange={e => setPgPort(e.target.value)} /></div>
            </div>
            <div className="sales-row">
              <div className="form-group"><label>Banco</label><input value={pgDb} onChange={e => setPgDb(e.target.value)} placeholder="producao" /></div>
              <div className="form-group"><label>Usuário</label><input value={pgUser} onChange={e => setPgUser(e.target.value)} /></div>
              <div className="form-group"><label>Senha</label><input type="password" value={pgPass} onChange={e => setPgPass(e.target.value)} /></div>
            </div>
            <div className="form-group"><label>Query (somente leitura)</label><textarea rows={3} value={pgQuery} onChange={e => setPgQuery(e.target.value)} /></div>
            <div className="sales-row">
              <div className="form-group"><label>Coluna nome</label><input value={pgNameCol} onChange={e => setPgNameCol(e.target.value)} /></div>
              <div className="form-group"><label>Coluna telefone</label><input value={pgPhoneCol} onChange={e => setPgPhoneCol(e.target.value)} /></div>
            </div>
            <button className="btn-primary" onClick={() => void createPgSource()} disabled={pgBusy || !sessionId}>
              {pgBusy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Salvar fonte
            </button>
          </div>
        )}
        {sources.filter(s => s.type === 'postgres').length === 0 && !showPgForm && (
          <p className="muted">Nenhuma fonte Postgres configurada.</p>
        )}
        {sources.filter(s => s.type === 'postgres').map(s => (
          <div key={s.id} className="camp-item">
            <div className="camp-info"><strong>{s.name}</strong><span className="muted">postgres</span></div>
            <div className="camp-actions">
              <button className="btn-sm" onClick={() => void testSource(s.id)}>Testar</button>
              <button className="btn-icon-sm danger" onClick={() => void salesApi.deleteSource(s.id).then(refresh)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Opt-out */}
      <div className="sales-card wide">
        <h3>Descadastros (opt-out) <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>— {optOuts.length} contato(s)</span></h3>
        {optOuts.length === 0 && <p className="muted">Nenhum contato descadastrado.</p>}
        {optOuts.length > 0 && (
          <table className="sales-table">
            <thead><tr><th>Telefone</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {optOuts.map(o => (
                <tr key={o.id}>
                  <td>{o.phone}</td>
                  <td className="muted">{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <button className="btn-icon-sm danger" onClick={() => void removeOptOut(o.id)} title="Remover opt-out"><Trash2 size={13} /></button>
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
            {['pending', 'approved', 'sent', 'replied', 'qualified', 'won', 'opted_out', 'failed'].map(st => (
              <div key={st} className="funnel-stat">
                <span className="fn">{metrics[st] ?? 0}</span>
                <span className="fl">{STAGE_LABEL[st]}</span>
              </div>
            ))}
          </div>

          <h4>Abordagens (revise antes de enviar)</h4>
          <table className="sales-table">
            <thead>
              <tr><th>Lead</th><th>Score</th><th>Necessidade</th><th>Mensagem (editável)</th><th>Estágio</th></tr>
            </thead>
            <tbody>
              {outreach.map(o => (
                <tr key={o.id}>
                  <td>{o.leadName || o.phone || '—'}</td>
                  <td><span className="score">{o.score}</span></td>
                  <td className="muted">{o.need}</td>
                  <td>
                    <textarea
                      rows={3}
                      defaultValue={o.message}
                      onBlur={e => void saveMessage(o, e.target.value)}
                    />
                  </td>
                  <td><span className={`stage stage-${o.stage}`}>{STAGE_LABEL[o.stage] ?? o.stage}</span></td>
                </tr>
              ))}
              {outreach.length === 0 && (
                <tr><td colSpan={5} className="muted">Clique em “Gerar” para criar as abordagens.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SalesEngine;
