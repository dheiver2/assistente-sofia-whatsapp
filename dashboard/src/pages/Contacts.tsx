import { useState, useEffect, useCallback, useRef } from 'react';
import { read, utils } from 'xlsx';
import { Loader2, Upload, Tag, Trash2, X, Plus } from 'lucide-react';
import { sessionApi, contactsApi, type Session, type Contact } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import './Contacts.css';

/* ── Helpers ────────────────────────────────────────────────── */

const TAG_COLOR_COUNT = 6;

function tagColorClass(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  }
  return `tag-chip-color-${Math.abs(hash) % TAG_COLOR_COUNT}`;
}

function StatusBadge({ status }: { status: Contact['status'] }) {
  const labels: Record<Contact['status'], string> = {
    active: 'Ativo',
    blocked: 'Bloqueado',
    opted_out: 'Opt-out',
  };
  return (
    <span className={`ct-status ct-status-${status}`}>
      {labels[status]}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

/* ── Componente principal ────────────────────────────────────── */

export function Contacts() {
  useDocumentTitle('Contatos');
  const toast = useToast();

  /* sessões */
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');

  /* dados */
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);

  /* filtros */
  const [searchTerm, setSearchTerm] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  /* modal de tags */
  const [showTagModal, setShowTagModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [newTag, setNewTag] = useState('');
  const [savingTag, setSavingTag] = useState(false);

  /* import */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Carregar sessões ── */
  useEffect(() => {
    sessionApi.list()
      .then(list => {
        setSessions(list);
        const ready = list.find(s => s.status === 'ready');
        if (ready) setSessionId(ready.id);
        else if (list.length > 0) setSessionId(list[0].id);
      })
      .catch(() => {});
  }, []);

  /* ── Carregar contatos ── */
  const loadContacts = useCallback(() => {
    if (!sessionId) return;
    setLoading(true);
    contactsApi
      .list(sessionId, tagFilter || undefined, searchTerm || undefined)
      .then(setContacts)
      .catch(err => toast.error(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [sessionId, tagFilter, searchTerm, toast]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  /* ── Tags únicas de todos os contatos ── */
  const allTags = Array.from(new Set(contacts.flatMap(c => c.tags))).sort();

  /* ── Abrir modal de tags ── */
  function openTagModal(contact: Contact) {
    setSelectedContact(contact);
    setNewTag('');
    setShowTagModal(true);
  }

  /* ── Adicionar nova tag ── */
  async function handleAddTag() {
    if (!selectedContact || !newTag.trim()) return;
    setSavingTag(true);
    try {
      await contactsApi.addTag(selectedContact.id, newTag.trim());
      toast.success(`Tag "${newTag.trim()}" adicionada`);
      setNewTag('');
      await loadContacts();
      // Atualizar o contato selecionado com os dados novos
      setSelectedContact(prev =>
        prev ? { ...prev, tags: [...prev.tags, newTag.trim()] } : prev
      );
    } catch (err: unknown) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setSavingTag(false);
    }
  }

  /* ── Remover tag ── */
  async function handleRemoveTag(contact: Contact, tag: string) {
    try {
      await contactsApi.removeTag(contact.id, tag);
      toast.success(`Tag "${tag}" removida`);
      loadContacts();
      if (selectedContact?.id === contact.id) {
        setSelectedContact(prev =>
          prev ? { ...prev, tags: prev.tags.filter(t => t !== tag) } : prev
        );
      }
    } catch (err: unknown) {
      toast.error(String((err as Error).message ?? err));
    }
  }

  /* ── Toggle tag existente no modal ── */
  async function handleToggleExistingTag(tag: string) {
    if (!selectedContact) return;
    const has = selectedContact.tags.includes(tag);
    setSavingTag(true);
    try {
      if (has) {
        await contactsApi.removeTag(selectedContact.id, tag);
        setSelectedContact(prev =>
          prev ? { ...prev, tags: prev.tags.filter(t => t !== tag) } : prev
        );
      } else {
        await contactsApi.addTag(selectedContact.id, tag);
        setSelectedContact(prev =>
          prev ? { ...prev, tags: [...prev.tags, tag] } : prev
        );
      }
      loadContacts();
    } catch (err: unknown) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setSavingTag(false);
    }
  }

  /* ── Deletar contato ── */
  async function handleDelete(contact: Contact) {
    if (!window.confirm(`Excluir contato ${contact.name ?? contact.phone}?`)) return;
    try {
      await contactsApi.delete(contact.id);
      toast.success('Contato excluído');
      loadContacts();
    } catch (err: unknown) {
      toast.error(String((err as Error).message ?? err));
    }
  }

  /* ── Importar CSV/XLSX ── */
  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    e.target.value = '';

    try {
      const buf = await file.arrayBuffer();
      const wb = read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

      if (rows.length === 0) {
        toast.error('Arquivo vazio ou sem dados reconhecidos.');
        return;
      }

      let imported = 0;
      let failed = 0;

      for (const row of rows) {
        // Aceitar colunas: phone / telefone / numero / cel / whatsapp
        const phone =
          String(row['phone'] ?? row['telefone'] ?? row['numero'] ?? row['cel'] ?? row['whatsapp'] ?? '').trim();
        if (!phone) continue;

        const name =
          String(row['name'] ?? row['nome'] ?? row['contato'] ?? '').trim() || undefined;
        const tags = String(row['tags'] ?? row['etiquetas'] ?? '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
        const notes = String(row['notes'] ?? row['notas'] ?? row['observacoes'] ?? '').trim() || undefined;

        try {
          await contactsApi.upsert({ sessionId, phone, name, tags: tags.length ? tags : undefined, notes });
          imported++;
        } catch {
          failed++;
        }
      }

      toast.success(`${imported} contato(s) importado(s)${failed ? `, ${failed} falha(s)` : ''}.`);
      loadContacts();
    } catch (err: unknown) {
      toast.error(`Erro ao ler arquivo: ${(err as Error).message ?? err}`);
    }
  }

  /* ── Render ── */
  return (
    <div className="ct-page">
      {/* Top bar */}
      <div className="ct-topbar">
        <div className="ct-topbar-left">
          <h1 className="ct-title">Contatos</h1>
          <input
            className="ct-search"
            placeholder="Buscar nome ou telefone…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          <select
            className="ct-filter-select"
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
          >
            <option value="">Todas as tags</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>

        <div className="ct-topbar-right">
          <select
            className="ct-session-select"
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
          >
            {sessions.length === 0 && <option value="">Sem sessões</option>}
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleFileImport}
          />
          <button
            className="ct-btn ct-btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!sessionId}
          >
            <Upload size={15} />
            Importar
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="ct-body">
        {loading ? (
          <div className="ct-loading">
            <Loader2 size={22} className="animate-spin" />
            Carregando contatos…
          </div>
        ) : contacts.length === 0 ? (
          <div className="ct-empty">
            <div className="ct-empty-icon">👥</div>
            <h3>Nenhum contato encontrado</h3>
            <p>
              {searchTerm || tagFilter
                ? 'Tente alterar os filtros de busca.'
                : 'Importe um arquivo CSV ou XLSX para começar.'}
            </p>
            {!searchTerm && !tagFilter && (
              <button
                className="ct-btn ct-btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={!sessionId}
              >
                <Upload size={15} />
                Importar contatos
              </button>
            )}
          </div>
        ) : (
          <div className="ct-table-wrap">
            <table className="ct-table">
              <thead>
                <tr>
                  <th>Nome / Telefone</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th>Último contato</th>
                  <th>Notas</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(contact => (
                  <tr key={contact.id}>
                    {/* Nome / Telefone */}
                    <td>
                      <div className="ct-name">{contact.name ?? '—'}</div>
                      <div className="ct-phone">{contact.phone}</div>
                    </td>

                    {/* Tags */}
                    <td>
                      <div className="ct-tags">
                        {contact.tags.map(tag => (
                          <span key={tag} className={`tag-chip ${tagColorClass(tag)}`}>
                            {tag}
                            <button
                              className="tag-chip-remove"
                              title={`Remover tag "${tag}"`}
                              onClick={() => handleRemoveTag(contact, tag)}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        <button
                          className="ct-action-btn"
                          style={{ padding: '2px 6px' }}
                          title="Gerenciar tags"
                          onClick={() => openTagModal(contact)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>

                    {/* Status */}
                    <td><StatusBadge status={contact.status} /></td>

                    {/* Último contato */}
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {fmtDate(contact.lastContactAt)}
                    </td>

                    {/* Notas */}
                    <td>
                      <div className="ct-notes" title={contact.notes ?? ''}>
                        {contact.notes ?? '—'}
                      </div>
                    </td>

                    {/* Ações */}
                    <td>
                      <div className="ct-actions">
                        <button
                          className="ct-action-btn"
                          title="Gerenciar tags"
                          onClick={() => openTagModal(contact)}
                        >
                          <Tag size={13} />
                          Tags
                        </button>
                        <button
                          className="ct-action-btn danger"
                          title="Excluir contato"
                          onClick={() => handleDelete(contact)}
                        >
                          <Trash2 size={13} />
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

      {/* Tag modal */}
      {showTagModal && selectedContact && (
        <div className="ct-modal-overlay" onClick={() => setShowTagModal(false)}>
          <div className="ct-modal" onClick={e => e.stopPropagation()}>
            <h3>
              Tags — {selectedContact.name ?? selectedContact.phone}
            </h3>

            {/* Adicionar nova tag */}
            <div className="ct-modal-input-row">
              <input
                className="ct-modal-input"
                placeholder="Nova tag…"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleAddTag(); }}
                autoFocus
              />
              <button
                className="ct-btn ct-btn-primary"
                onClick={() => void handleAddTag()}
                disabled={!newTag.trim() || savingTag}
              >
                {savingTag ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add
              </button>
            </div>

            {/* Tags existentes para toggle */}
            {allTags.length > 0 && (
              <div className="ct-tag-list">
                {allTags.map(tag => (
                  <button
                    key={tag}
                    className={`ct-tag-toggle ${selectedContact.tags.includes(tag) ? 'active' : ''}`}
                    onClick={() => void handleToggleExistingTag(tag)}
                    disabled={savingTag}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Tags atuais do contato */}
            {selectedContact.tags.length > 0 && (
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Tags atuais:
                </p>
                <div className="ct-tags">
                  {selectedContact.tags.map(tag => (
                    <span key={tag} className={`tag-chip ${tagColorClass(tag)}`}>
                      {tag}
                      <button
                        className="tag-chip-remove"
                        onClick={() => void handleRemoveTag(selectedContact, tag)}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="ct-modal-footer">
              <button className="ct-btn ct-btn-ghost" onClick={() => setShowTagModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Contacts;
