import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Loader2, Search, ShoppingBag, Package, X, Phone, CheckCircle2, Clock, XCircle, Receipt, TrendingUp, Trash2,
} from 'lucide-react';
import { sessionApi, ordersApi, type Session, type Order, type OrderStatus } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { useWebSocket } from '../hooks/useWebSocket';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import './Contacts.css'; // reaproveita os estilos base ct-* (página, toolbar, tabela, avatar)
import './Orders.css';

const STATUS_META: Record<OrderStatus, { label: string; icon: typeof Clock }> = {
  novo: { label: 'Novo', icon: Clock },
  confirmado: { label: 'Confirmado', icon: CheckCircle2 },
  concluido: { label: 'Concluído', icon: Package },
  cancelado: { label: 'Cancelado', icon: XCircle },
};

const brl = (n: number) => `R$ ${Number(n ?? 0).toFixed(2).replace('.', ',')}`;
const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 55%)`;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.novo;
  const Icon = meta.icon;
  return (
    <span className={`ord-status ord-status-${status}`}>
      <Icon size={12} /> {meta.label}
    </span>
  );
}

export function Orders() {
  useDocumentTitle('Pedidos');
  const toast = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [selected, setSelected] = useState<Order | null>(null);
  const [custOrders, setCustOrders] = useState<Order[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carrega sessões; escolhe por padrão a que tem mais pedidos (geralmente a loja).
  useEffect(() => {
    sessionApi
      .list()
      .then(async list => {
        setSessions(list);
        if (!list.length) return;
        const counts = await Promise.all(
          list.map(s =>
            ordersApi
              .stats(s.id)
              .then(st => Object.values(st).reduce((a, b) => a + b, 0))
              .catch(() => 0),
          ),
        );
        let best = 0;
        counts.forEach((c, i) => { if (c > counts[best]) best = i; });
        setSessionId(list[best].id);
      })
      .catch(() => {});
  }, []);

  const loadOrders = useCallback(
    (sid: string, search: string, status: string) => {
      if (!sid) return;
      setLoading(true);
      ordersApi
        .list(sid, { search: search || undefined, status: status || undefined, take: 300 })
        .then(setOrders)
        .catch(err => toast.error('Erro ao carregar pedidos', err instanceof Error ? err.message : undefined))
        .finally(() => setLoading(false));
    },
    [toast],
  );

  useEffect(() => {
    if (!sessionId) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadOrders(sessionId, searchTerm, statusFilter), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [sessionId, searchTerm, statusFilter, loadOrders]);

  // Notificação em tempo real: novo pedido fechado na conversa.
  useWebSocket({
    onOrderCreated: ev => {
      if (ev.sessionId !== sessionId) return;
      toast.success('Novo pedido recebido!', `${ev.customerName || ev.phone} — ${brl(ev.total)} (${ev.itemCount} itens)`);
      loadOrders(sessionId, searchTerm, statusFilter);
    },
  });

  const novos = useMemo(() => orders.filter(o => o.status === 'novo').length, [orders]);

  function openDrawer(order: Order) {
    setSelected(order);
    setCustOrders([]);
    ordersApi.byPhone(sessionId, order.phone).then(setCustOrders).catch(() => {});
  }
  function closeDrawer() {
    setSelected(null);
    setCustOrders([]);
  }

  async function changeStatus(order: Order, status: OrderStatus) {
    try {
      const updated = await ordersApi.update(order.id, { status });
      setOrders(prev => prev.map(o => (o.id === order.id ? updated : o)));
      setSelected(s => (s && s.id === order.id ? updated : s));
      toast.success('Status atualizado', `${order.customerName || order.phone}: ${STATUS_META[status].label}`);
    } catch (err) {
      toast.error('Falha ao atualizar', err instanceof Error ? err.message : undefined);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await ordersApi.delete(deleteTarget.id);
      setOrders(prev => prev.filter(o => o.id !== deleteTarget.id));
      if (selected?.id === deleteTarget.id) closeDrawer();
      setDeleteTarget(null);
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(false);
    }
  }

  // Resumo do cliente no drawer (a partir dos pedidos dele).
  const custSummary = useMemo(() => {
    if (!custOrders.length) return null;
    const totalGasto = custOrders.reduce((s, o) => s + Number(o.total ?? 0), 0);
    return { count: custOrders.length, totalGasto, ticket: totalGasto / custOrders.length };
  }, [custOrders]);

  return (
    <div className="ct-page ord-page">
      <PageHeader
        title="Pedidos"
        subtitle="Histórico de compras e pedidos fechados na conversa pela IA"
        badge={!loading && orders.length > 0 ? `${orders.length} pedidos${novos ? ` · ${novos} novos` : ''}` : undefined}
      />

      <div className="ct-toolbar">
        <div className="ct-search-wrap">
          <Search size={15} className="ct-search-icon" />
          <input
            className="ct-search"
            placeholder="Buscar cliente ou telefone…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <select className="ct-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="novo">Novos</option>
          <option value="confirmado">Confirmados</option>
          <option value="concluido">Concluídos</option>
          <option value="cancelado">Cancelados</option>
        </select>

        <div className="ct-toolbar-spacer" />

        <select className="ct-session-select" value={sessionId} onChange={e => setSessionId(e.target.value)}>
          {sessions.length === 0 && <option value="">Sem sessões</option>}
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="ct-body">
        {loading ? (
          <div className="ct-loading">
            <Loader2 size={22} className="animate-spin" /> Carregando pedidos…
          </div>
        ) : orders.length === 0 ? (
          <div className="ct-empty">
            <div className="ct-empty-icon"><ShoppingBag size={28} /></div>
            <p>Nenhum pedido nesta sessão.</p>
            <span className="ord-empty-hint">Quando a IA fechar um pedido na conversa, ele aparece aqui em tempo real.</span>
          </div>
        ) : (
          <div className="ct-table-wrap">
            <table className="ct-table ord-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Itens</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr
                    key={o.id}
                    className={`ct-row ord-row ${o.status === 'novo' ? 'ord-row-new' : ''}`}
                    onClick={() => openDrawer(o)}
                  >
                    <td>
                      <div className="ct-identity">
                        <span className="ct-avatar" style={{ background: avatarColor(o.customerName ?? o.phone), color: '#fff' }}>
                          {initials(o.customerName ?? o.phone)}
                        </span>
                        <div className="ct-identity-text">
                          <div className="ct-name">{o.customerName ?? 'Sem nome'}</div>
                          <div className="ct-phone">{o.phone || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="ord-items-count"><Package size={13} /> {o.items.length}</span>
                      <span className="ord-items-preview">{o.items.slice(0, 2).map(i => i.produto).join(', ')}{o.items.length > 2 ? '…' : ''}</span>
                    </td>
                    <td className="ord-total">{brl(o.total)}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="ct-muted-cell">{fmtDate(o.placedAt ?? o.createdAt)}</td>
                    <td>
                      <div className="ct-actions" onClick={e => e.stopPropagation()}>
                        <button className="ct-action-btn" title="Excluir" onClick={() => setDeleteTarget(o)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer de detalhe */}
      {selected && (
        <>
          <div className="ord-drawer-backdrop" onClick={closeDrawer} />
          <aside className="ord-drawer">
            <div className="ord-drawer-head">
              <div className="ct-identity">
                <span className="ct-avatar" style={{ background: avatarColor(selected.customerName ?? selected.phone), color: '#fff' }}>
                  {initials(selected.customerName ?? selected.phone)}
                </span>
                <div className="ct-identity-text">
                  <div className="ct-name">{selected.customerName ?? 'Sem nome'}</div>
                  <div className="ct-phone"><Phone size={12} /> {selected.phone || '—'}</div>
                </div>
              </div>
              <button className="ct-action-btn" onClick={closeDrawer}><X size={18} /></button>
            </div>

            <div className="ord-drawer-body">
              <div className="ord-drawer-meta">
                <StatusBadge status={selected.status} />
                <span className="ord-drawer-date">{fmtDate(selected.placedAt ?? selected.createdAt)}</span>
                {selected.reference && <span className="ord-ref">#{selected.reference}</span>}
              </div>

              <h4 className="ord-section-title"><Receipt size={15} /> Itens do pedido</h4>
              <ul className="ord-items-list">
                {selected.items.map((it, i) => (
                  <li key={i}>
                    <span className="ord-item-qty">{it.qtd}×</span>
                    <span className="ord-item-name">{it.produto}</span>
                    <span className="ord-item-price">{brl(it.preco)}</span>
                  </li>
                ))}
              </ul>
              <div className="ord-total-row"><span>Total</span><strong>{brl(selected.total)}</strong></div>

              {/* Ações de status (não para histórico) */}
              {selected.source !== 'historico-bi' && (
                <div className="ord-actions-row">
                  {selected.status !== 'confirmado' && (
                    <button className="ct-btn" onClick={() => changeStatus(selected, 'confirmado')}>Confirmar</button>
                  )}
                  {selected.status !== 'concluido' && (
                    <button className="ct-btn ct-btn-primary" onClick={() => changeStatus(selected, 'concluido')}>Concluir</button>
                  )}
                  {selected.status !== 'cancelado' && (
                    <button className="ct-btn ord-btn-danger" onClick={() => changeStatus(selected, 'cancelado')}>Cancelar</button>
                  )}
                </div>
              )}

              {/* Histórico do cliente */}
              <h4 className="ord-section-title"><TrendingUp size={15} /> Histórico do cliente</h4>
              {custSummary && (
                <div className="ord-cust-summary">
                  <div><strong>{custSummary.count}</strong><span>pedidos</span></div>
                  <div><strong>{brl(custSummary.totalGasto)}</strong><span>total gasto</span></div>
                  <div><strong>{brl(custSummary.ticket)}</strong><span>ticket médio</span></div>
                </div>
              )}
              <ul className="ord-hist-list">
                {custOrders.filter(o => o.id !== selected.id).slice(0, 12).map(o => (
                  <li key={o.id} onClick={() => openDrawer(o)}>
                    <span className="ord-hist-date">{fmtDate(o.placedAt ?? o.createdAt)}</span>
                    <span className="ord-hist-items">{o.items.slice(0, 2).map(i => i.produto).join(', ')}{o.items.length > 2 ? '…' : ''}</span>
                    <span className="ord-hist-total">{brl(o.total)}</span>
                  </li>
                ))}
                {custOrders.filter(o => o.id !== selected.id).length === 0 && (
                  <li className="ord-hist-empty">Sem outros pedidos.</li>
                )}
              </ul>
            </div>
          </aside>
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Excluir pedido"
        message={`Excluir o pedido de ${deleteTarget?.customerName ?? deleteTarget?.phone}?`}
        warning="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
      />
    </div>
  );
}
