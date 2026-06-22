import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { sessionApi, recommendationsApi } from '../services/api';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type {
  Session,
  CatalogProduct,
  CatalogProductPayload,
  ProductRecommendation,
  AnalyzeResult,
} from '../services/api';
import './Recommendations.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(100, score * 100)));
  const cls = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low';
  return (
    <div className="rec-score-bar-wrap">
      <div className="rec-score-bar">
        <div className="rec-score-bar-fill" style={{ width: `${pct}%` }} data-cls={cls} />
      </div>
      <span className="rec-score-label">{pct}%</span>
    </div>
  );
}

function MediaBadge({ mediaType }: { mediaType?: string | null }) {
  if (!mediaType) return <span className="rec-media-badge none">—</span>;
  const labels: Record<string, string> = { image: '🖼️ Imagem', video: '📹 Vídeo', document: '📄 Doc' };
  return (
    <span className={`rec-media-badge ${mediaType}`}>
      {labels[mediaType] ?? mediaType}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Product Modal
// ---------------------------------------------------------------------------

interface ProductModalProps {
  initial?: CatalogProduct | null;
  onSave: (data: CatalogProductPayload) => Promise<void>;
  onClose: () => void;
}

const EMPTY_FORM: CatalogProductPayload = {
  name: '',
  category: '',
  description: '',
  price: undefined,
  keywords: [],
  tags: [],
  imageUrl: '',
  videoUrl: '',
  documentUrl: '',
  thumbnailUrl: '',
  active: true,
};

function ProductModal({ initial, onSave, onClose }: ProductModalProps) {
  const [form, setForm] = useState<CatalogProductPayload>(() =>
    initial
      ? {
          name: initial.name,
          category: initial.category ?? '',
          description: initial.description ?? '',
          price: initial.price,
          keywords: initial.keywords ?? [],
          tags: initial.tags ?? [],
          imageUrl: initial.imageUrl ?? '',
          videoUrl: initial.videoUrl ?? '',
          documentUrl: initial.documentUrl ?? '',
          thumbnailUrl: initial.thumbnailUrl ?? '',
          active: initial.active,
        }
      : { ...EMPTY_FORM },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function setField<K extends keyof CatalogProductPayload>(k: K, v: CatalogProductPayload[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
      setSaving(false);
    }
  }

  return (
    <div className="rec-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rec-modal">
        <div className="rec-modal-header">
          <h2>{initial ? 'Editar produto' : 'Novo produto'}</h2>
          <button className="rec-modal-close" onClick={onClose} aria-label="Fechar">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="rec-form-group">
            <label>Nome <span className="rec-required">*</span></label>
            <input
              className="rec-input"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="Nome do produto ou serviço"
              required
            />
          </div>

          <div className="rec-form-row">
            <div className="rec-form-group">
              <label>Categoria</label>
              <input className="rec-input" value={form.category} onChange={e => setField('category', e.target.value)} placeholder="Ex.: Serviços" />
            </div>
            <div className="rec-form-group">
              <label>Preço</label>
              <input
                className="rec-input"
                type="number"
                min="0"
                step="0.01"
                value={form.price ?? ''}
                onChange={e => setField('price', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="rec-form-group">
            <label>Descrição</label>
            <textarea className="rec-textarea" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Descreva o produto ou serviço..." />
          </div>

          <div className="rec-form-row">
            <div className="rec-form-group">
              <label>Keywords <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>(vírgulas)</span></label>
              <input
                className="rec-input"
                value={(form.keywords ?? []).join(', ')}
                onChange={e => setField('keywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="plano, mensal, upgrade"
              />
            </div>
            <div className="rec-form-group">
              <label>Tags <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>(vírgulas)</span></label>
              <input
                className="rec-input"
                value={(form.tags ?? []).join(', ')}
                onChange={e => setField('tags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="destaque, novo"
              />
            </div>
          </div>

          <div className="rec-form-group">
            <label>URL da Imagem</label>
            <input className="rec-input" value={form.imageUrl} onChange={e => setField('imageUrl', e.target.value)} placeholder="https://..." />
          </div>
          <div className="rec-form-group">
            <label>URL do Vídeo</label>
            <input className="rec-input" value={form.videoUrl} onChange={e => setField('videoUrl', e.target.value)} placeholder="https://..." />
          </div>
          <div className="rec-form-group">
            <label>URL do Documento</label>
            <input className="rec-input" value={form.documentUrl} onChange={e => setField('documentUrl', e.target.value)} placeholder="https://..." />
          </div>
          <div className="rec-form-group">
            <label>URL do Thumbnail</label>
            <input className="rec-input" value={form.thumbnailUrl} onChange={e => setField('thumbnailUrl', e.target.value)} placeholder="https://..." />
          </div>

          <div className="rec-form-group">
            <div className="rec-toggle-wrap">
              <label className="rec-toggle">
                <input type="checkbox" checked={form.active} onChange={e => setField('active', e.target.checked)} />
                <span className="rec-toggle-slider" />
              </label>
              <span style={{ fontSize: '0.875rem' }}>Ativo</span>
            </div>
          </div>

          {error && <p style={{ color: 'var(--error)', fontSize: '0.875rem', margin: '0 0 12px 0' }}>{error}</p>}

          <div className="rec-modal-footer">
            <button type="button" className="rec-btn rec-btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="rec-btn rec-btn-primary" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Catálogo
// ---------------------------------------------------------------------------

function CatalogTab() {
  const toast = useToast();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<CatalogProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogProduct | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await recommendationsApi.listProducts();
      setProducts(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar catálogo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setEditProduct(null); setModalOpen(true); };
  const openEdit = (p: CatalogProduct) => { setEditProduct(p); setModalOpen(true); };

  const handleSave = async (data: CatalogProductPayload) => {
    if (editProduct) {
      await recommendationsApi.updateProduct(editProduct.id, data);
    } else {
      await recommendationsApi.createProduct(data);
    }
    setModalOpen(false);
    await load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await recommendationsApi.deleteProduct(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error('Erro ao excluir', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="rec-section-header">
        <h2>Catálogo de produtos e serviços</h2>
        <button className="rec-btn rec-btn-primary" onClick={openCreate}>+ Novo produto</button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.9rem' }}>Carregando catálogo...</p>
      ) : loadError ? (
        <div className="rec-empty">
          <div className="rec-empty-icon">⚠️</div>
          <h3>Erro ao carregar catálogo</h3>
          <p>{loadError}</p>
          <button className="rec-btn rec-btn-primary" onClick={() => void load()} style={{ marginTop: 12 }}>
            Tentar novamente
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="rec-empty">
          <div className="rec-empty-icon">📦</div>
          <h3>Nenhum produto cadastrado</h3>
          <p>Adicione seu catálogo de produtos e serviços.</p>
        </div>
      ) : (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th>Mídia</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.thumbnailUrl ? (
                        <img src={p.thumbnailUrl} alt={p.name} className="rec-product-thumb" />
                      ) : (
                        <div className="rec-product-thumb-placeholder">📦</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        {p.price != null && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--primary, #6366f1)' }}>
                            R$ {p.price.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.85rem' }}>{p.category ?? '—'}</td>
                  <td>
                    <div className="rec-product-media-icons">
                      <span className={`rec-product-media-icon ${p.imageUrl ? 'active' : ''}`} title="Imagem">🖼️</span>
                      <span className={`rec-product-media-icon ${p.videoUrl ? 'active' : ''}`} title="Vídeo">📹</span>
                      <span className={`rec-product-media-icon ${p.documentUrl ? 'active' : ''}`} title="Documento">📄</span>
                    </div>
                  </td>
                  <td>
                    <span className={`rec-badge ${p.active ? 'rec-badge-active' : 'rec-badge-inactive'}`}>
                      {p.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="rec-btn rec-btn-secondary rec-btn-sm" onClick={() => openEdit(p)}>Editar</button>
                      <button className="rec-btn rec-btn-danger rec-btn-sm" onClick={() => setDeleteTarget(p)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ProductModal
          initial={editProduct}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir produto"
        message={`Excluir "${deleteTarget?.name ?? ''}"?`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Analisar
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = [
  { key: 'profile', label: '🔍 Buscando perfil do cliente...' },
  { key: 'behavior', label: '🧠 Analisando comportamento...' },
  { key: 'select', label: '🎯 Selecionando produtos...' },
  { key: 'message', label: '✍️ Criando mensagens personalizadas...' },
];

function AnalyzeTab() {
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [sendingAll, setSendingAll] = useState(false);

  // Single mode state
  const [sessionId, setSessionId] = useState('');
  const [phone, setPhone] = useState('');
  const [topN, setTopN] = useState(3);
  const [analyzing, setAnalyzing] = useState(false);
  const [pipelineStage, setPipelineStage] = useState(-1);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');

  // Batch mode state
  const [batchSession, setBatchSession] = useState('');
  const [csvPhones, setCsvPhones] = useState<string[]>([]);
  const [csvFilename, setCsvFilename] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [batchResult, setBatchResult] = useState<number | null>(null);
  const [batchError, setBatchError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sessionApi.list().then(setSessions).catch(() => {});
  }, []);

  const runAnalyze = async () => {
    if (!sessionId || !phone) { setAnalyzeError('Selecione a sessão e informe o telefone.'); return; }
    setAnalyzeError('');
    setResult(null);
    setAnalyzing(true);
    setPipelineStage(0);

    // Simulate pipeline stage progression while the API call runs
    const stageTimer = setInterval(() => {
      setPipelineStage(s => (s < PIPELINE_STAGES.length - 1 ? s + 1 : s));
    }, 900);

    try {
      const data = await recommendationsApi.analyze(sessionId, phone, topN);
      clearInterval(stageTimer);
      setPipelineStage(PIPELINE_STAGES.length);
      setResult(data);
    } catch (err) {
      clearInterval(stageTimer);
      setAnalyzeError(err instanceof Error ? err.message : 'Erro ao analisar');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSendAll = async () => {
    if (!result || !sessionId || sendingAll) return;
    setSendingAll(true);
    try {
      await recommendationsApi.deliverBatch(sessionId, phone);
      toast.success('Recomendações enviadas!');
    } catch (err) {
      toast.error('Erro ao enviar', err instanceof Error ? err.message : undefined);
    } finally {
      setSendingAll(false);
    }
  };

  const handleCsvFile = (file: File) => {
    setCsvFilename(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // skip header if first line looks like a header
      const start = lines[0]?.toLowerCase().includes('phone') ? 1 : 0;
      setCsvPhones(lines.slice(start).map(l => l.split(',')[0].trim()));
    };
    reader.readAsText(file);
  };

  const runBatch = async () => {
    if (!batchSession || csvPhones.length === 0) { setBatchError('Selecione a sessão e carregue um arquivo CSV.'); return; }
    setBatchError('');
    setBatchResult(null);
    setBatchRunning(true);
    setBatchProgress(`Processando ${csvPhones.length} contatos...`);
    try {
      const res = await recommendationsApi.batch(batchSession, csvPhones, topN);
      setBatchResult(res.generated);
      setBatchProgress('');
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Erro ao processar lote');
      setBatchProgress('');
    } finally {
      setBatchRunning(false);
    }
  };

  return (
    <div>
      <div className="rec-mode-toggle">
        <button className={`rec-mode-btn ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>
          Contato único
        </button>
        <button className={`rec-mode-btn ${mode === 'batch' ? 'active' : ''}`} onClick={() => setMode('batch')}>
          Lote (CSV)
        </button>
      </div>

      {mode === 'single' && (
        <>
          <div className="rec-analyze-form">
            <div className="rec-form-group">
              <label>Sessão</label>
              <select className="rec-select" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                <option value="">Selecione uma sessão...</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="rec-form-group">
              <label>Telefone</label>
              <input className="rec-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="5511999999999" />
            </div>
            <div className="rec-form-group">
              <label>Número de recomendações</label>
              <select className="rec-select" value={topN} onChange={e => setTopN(parseInt(e.target.value))}>
                <option value={1}>1 recomendação</option>
                <option value={2}>2 recomendações</option>
                <option value={3}>3 recomendações</option>
              </select>
            </div>
            {analyzeError && <p style={{ color: 'var(--error)', fontSize: '0.875rem', margin: '0 0 10px 0' }}>{analyzeError}</p>}
            <button className="rec-btn rec-btn-primary" onClick={() => void runAnalyze()} disabled={analyzing}>
              {analyzing ? 'Analisando...' : '✨ Analisar com IA'}
            </button>
          </div>

          {analyzing && (
            <div className="rec-pipeline-steps">
              {PIPELINE_STAGES.map((stage, i) => {
                const isDone = i < pipelineStage;
                const isActive = i === pipelineStage;
                return (
                  <div key={stage.key} className={`rec-pipeline-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
                    <div className="rec-pipeline-dot" />
                    <span>{stage.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {result && (
            <div className="rec-analyze-results">
              <div className="rec-insight-card">
                <h3>Perfil do cliente</h3>
                <p>{result.customerInsight.summary}</p>
                {result.customerInsight.interests && result.customerInsight.interests.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {result.customerInsight.interests.map(i => (
                      <span key={i} className="rec-badge rec-badge-active" style={{ fontSize: '0.75rem' }}>{i}</span>
                    ))}
                  </div>
                )}
              </div>

              {result.recommendations.map((rec, idx) => (
                <div key={rec.id ?? idx} className="rec-result-card">
                  <div className="rec-result-card-header">
                    <span className="rec-result-card-name">{rec.productName}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <ScoreBar score={rec.score} />
                      <MediaBadge mediaType={rec.mediaType} />
                    </div>
                  </div>
                  <div className="rec-result-card-msg">{rec.message}</div>
                </div>
              ))}

              <div>
                <button className="rec-btn rec-btn-primary" onClick={() => void handleSendAll()} disabled={sendingAll}>
                  {sendingAll ? (
                    <>
                      <Loader2 size={16} className="spin" /> Enviando…
                    </>
                  ) : (
                    'Enviar tudo'
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'batch' && (
        <div className="rec-analyze-form">
          <div className="rec-form-group">
            <label>Sessão</label>
            <select className="rec-select" value={batchSession} onChange={e => setBatchSession(e.target.value)}>
              <option value="">Selecione uma sessão...</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="rec-form-group">
            <label>Arquivo CSV <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>(coluna: phone)</span></label>
            <div
              className={`rec-upload-area ${csvFilename ? '' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleCsvFile(file);
              }}
            >
              <div className="rec-upload-icon">📄</div>
              {csvFilename ? (
                <p><strong>{csvFilename}</strong> — {csvPhones.length} contatos</p>
              ) : (
                <p>Clique ou arraste um arquivo CSV aqui</p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }}
            />
          </div>

          {batchError && <p style={{ color: 'var(--error)', fontSize: '0.875rem', margin: '0 0 10px 0' }}>{batchError}</p>}

          {batchProgress && <p className="rec-progress-info">{batchProgress}</p>}

          {batchResult != null && (
            <div className="rec-insight-card" style={{ marginBottom: 12 }}>
              <h3>Concluído</h3>
              <p>{batchResult} recomendações geradas</p>
            </div>
          )}

          <button className="rec-btn rec-btn-primary" onClick={() => void runBatch()} disabled={batchRunning}>
            {batchRunning ? 'Processando...' : 'Processar lote'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Recomendações pendentes
// ---------------------------------------------------------------------------

function PendingTab() {
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [pending, setPending] = useState<ProductRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductRecommendation | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    sessionApi.list().then(list => {
      setSessions(list);
      if (list.length > 0) setSessionId(list[0].id);
    }).catch(() => {});
  }, []);

  const load = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoading(true);
    try {
      const data = await recommendationsApi.listPending(sid);
      setPending(data);
    } catch {
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (sessionId) void load(sessionId); }, [sessionId, load]);

  const handleDeliver = async (id: string) => {
    try {
      await recommendationsApi.deliver(id);
      setPending(p => p.filter(r => r.id !== id));
    } catch (err) {
      toast.error('Erro ao enviar', err instanceof Error ? err.message : undefined);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await recommendationsApi.deletePending(deleteTarget.id);
      setPending(p => p.filter(r => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      toast.error('Erro ao excluir', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeliverAll = async () => {
    if (!sessionId || sendingAll) return;
    setSendingAll(true);
    try {
      await recommendationsApi.deliverAll(sessionId);
      await load(sessionId);
    } catch (err) {
      toast.error('Erro ao enviar todas', err instanceof Error ? err.message : undefined);
    } finally {
      setSendingAll(false);
    }
  };

  return (
    <div>
      <div className="rec-pending-actions">
        <select
          className="rec-select"
          style={{ width: 220 }}
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}
        >
          <option value="">Selecione uma sessão...</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button className="rec-btn rec-btn-secondary" onClick={() => sessionId && void load(sessionId)} disabled={loading}>
          Atualizar
        </button>
        {pending.length > 0 && (
          <button className="rec-btn rec-btn-primary" onClick={() => void handleDeliverAll()} disabled={sendingAll}>
            {sendingAll ? (
              <>
                <Loader2 size={16} className="spin" /> Enviando…
              </>
            ) : (
              'Enviar todos'
            )}
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.9rem' }}>Carregando...</p>
      ) : pending.length === 0 ? (
        <div className="rec-empty">
          <div className="rec-empty-icon">✅</div>
          <h3>Nenhuma recomendação pendente</h3>
          <p>Nenhuma recomendação pendente.</p>
        </div>
      ) : (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th>Telefone</th>
                <th>Produto</th>
                <th>Score</th>
                <th>Mídia</th>
                <th>Mensagem</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(rec => (
                <tr key={rec.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{rec.phone}</td>
                  <td style={{ fontWeight: 600 }}>{rec.productName}</td>
                  <td><ScoreBar score={rec.score} /></td>
                  <td><MediaBadge mediaType={rec.mediaType} /></td>
                  <td>
                    <span className="rec-truncate" title={rec.message}>
                      {rec.message.length > 80 ? rec.message.slice(0, 80) + '…' : rec.message}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', whiteSpace: 'nowrap' }}>
                    {new Date(rec.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="rec-btn rec-btn-primary rec-btn-sm" onClick={() => void handleDeliver(rec.id)}>
                        Enviar
                      </button>
                      <button className="rec-btn rec-btn-danger rec-btn-sm" onClick={() => setDeleteTarget(rec)}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir recomendação"
        message="Excluir esta recomendação?"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type TabKey = 'catalog' | 'analyze' | 'pending';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'catalog', label: 'Catálogo' },
  { key: 'analyze', label: 'Analisar' },
  { key: 'pending', label: 'Recomendações' },
];

export default function Recommendations({ embedded = false }: { embedded?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<TabKey>('catalog');

  return (
    <div className="rec-page">
      {!embedded && (
        <>
          <h1>Recomendações</h1>
          <p className="rec-subtitle">Gerencie o catálogo, analise contatos com IA e envie recomendações personalizadas.</p>
        </>
      )}

      <div className="rec-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`rec-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'catalog' && <CatalogTab />}
      {activeTab === 'analyze' && <AnalyzeTab />}
      {activeTab === 'pending' && <PendingTab />}
    </div>
  );
}
