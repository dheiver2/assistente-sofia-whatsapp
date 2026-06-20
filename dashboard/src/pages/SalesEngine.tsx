import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Send, Sparkles, Trash2, Database, RefreshCw } from 'lucide-react';
import { sessionApi, salesApi, type Session, type Campaign, type Outreach, type LeadSource, type SalesLead } from '../services/api';
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

  // formulários
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
    const [src, camp] = await Promise.all([salesApi.listSources(sessionId), salesApi.listCampaigns(sessionId)]);
    setSources(src);
    setCampaigns(camp);
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
      <PageHeader title={t('nav.sales')} subtitle="Vendas ativas: a IA lê a base, gera a abordagem e conduz a conversa" />

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
              <small>Use uma fonte Postgres (read-only) via API <code>/api/sales/sources</code> para puxar da base real.</small>
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
