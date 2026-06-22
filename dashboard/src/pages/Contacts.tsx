import { useState, useEffect, useCallback, useRef } from 'react';
import { read, utils } from 'xlsx';
import { Loader2, Upload, Tag, Trash2, X, Plus, Search, Phone, Mail, StickyNote, Users } from 'lucide-react';
import { sessionApi, contactsApi, type Session, type Contact } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

/* Colored avatars with initials */
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ContactAvatar({ contact, size = 38 }: { contact: Contact; size?: number }) {
  const key = contact.name ?? contact.phone;
  const color = avatarColor(key);
  return (
    <span
      className="ct-avatar"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        fontSize: size * 0.38,
      }}
      aria-hidden
    >
      {avatarInitials(contact.name ?? contact.phone)}
    </span>
  );
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

  /* drawer de perfil / tags */
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [savingTag, setSavingTag] = useState(false);

  /* confirmação de exclusão */
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  /* ── Abrir drawer de perfil ── */
  function openDrawer(contact: Contact) {
    setSelectedContact(contact);
    setNewTag('');
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
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

  /* ── Toggle tag existente no drawer ── */
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
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await contactsApi.delete(deleteTarget.id);
      toast.success('Contato excluído');
      if (selectedContact?.id === deleteTarget.id) setDrawerOpen(false);
      setDeleteTarget(null);
      loadContacts();
    } catch (err: unknown) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setDeleting(false);
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
      <PageHeader
        title="Contatos"
        subtitle="Gerencie seus contatos, etiquetas e importações"
        badge={
          !loading && contacts.length > 0
            ? `${contacts.length} ${contacts.length === 1 ? 'contato' : 'contatos'}`
            : undefined
        }
        actions={
          <>
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
          </>
        }
      />

      {/* Toolbar */}
      <div className="ct-toolbar">
        <div className="ct-search-wrap">
          <Search size={15} className="ct-search-icon" />
          <input
            className="ct-search"
            placeholder="Buscar nome ou telefone…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

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

        <div className="ct-toolbar-spacer" />

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
            <div className="ct-empty-icon">
              <Users size={42} />
            </div>
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
                  <th>Contato</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th>Último contato</th>
                  <th>Notas</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(contact => (
                  <tr
                    key={contact.id}
                    className="ct-row"
                    onClick={() => openDrawer(contact)}
                  >
                    {/* Contato (avatar + nome/telefone) */}
                    <td>
                      <div className="ct-identity">
                        <ContactAvatar contact={contact} />
                        <div className="ct-identity-text">
                          <div className="ct-name">{contact.name ?? 'Sem nome'}</div>
                          <div className="ct-phone">{contact.phone}</div>
                        </div>
                      </div>
                    </td>

                    {/* Tags */}
                    <td onClick={e => e.stopPropagation()}>
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
                          className="ct-action-btn ct-tag-add"
                          title="Gerenciar tags"
                          onClick={() => openDrawer(contact)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>

                    {/* Status */}
                    <td><StatusBadge status={contact.status} /></td>

                    {/* Último contato */}
                    <td className="ct-muted-cell">
                      {fmtDate(contact.lastContactAt)}
                    </td>

                    {/* Notas */}
                    <td>
                      <div className="ct-notes" title={contact.notes ?? ''}>
                        {contact.notes ?? '—'}
                      </div>
                    </td>

                    {/* Ações */}
                    <td onClick={e => e.stopPropagation()}>
                      <div className="ct-actions">
                        <button
                          className="ct-action-btn"
                          title="Gerenciar tags"
                          onClick={() => openDrawer(contact)}
                        >
                          <Tag size={13} />
                          Tags
                        </button>
                        <button
                          className="ct-action-btn danger"
                          title="Excluir contato"
                          onClick={() => setDeleteTarget(contact)}
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

      {/* Profile drawer */}
      {selectedContact && (
        <div
          className={`ct-drawer-overlay ${drawerOpen ? 'open' : ''}`}
          onClick={closeDrawer}
        >
          <aside
            className={`ct-drawer ${drawerOpen ? 'open' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="ct-drawer-header">
              <ContactAvatar contact={selectedContact} size={56} />
              <div className="ct-drawer-identity">
                <div className="ct-drawer-name">{selectedContact.name ?? 'Sem nome'}</div>
                <div className="ct-drawer-status">
                  <StatusBadge status={selectedContact.status} />
                </div>
              </div>
              <button className="ct-drawer-close" onClick={closeDrawer} title="Fechar">
                <X size={18} />
              </button>
            </div>

            <div className="ct-drawer-body">
              {/* Detalhes */}
              <section className="ct-drawer-section">
                <h4 className="ct-drawer-label">Detalhes</h4>
                <div className="ct-field">
                  <Phone size={14} className="ct-field-icon" />
                  <span>{selectedContact.phone}</span>
                </div>
                {selectedContact.email && (
                  <div className="ct-field">
                    <Mail size={14} className="ct-field-icon" />
                    <span>{selectedContact.email}</span>
                  </div>
                )}
                <div className="ct-field">
                  <Tag size={14} className="ct-field-icon" />
                  <span>Último contato: {fmtDate(selectedContact.lastContactAt)}</span>
                </div>
              </section>

              {/* Tags atuais */}
              <section className="ct-drawer-section">
                <h4 className="ct-drawer-label">Tags</h4>
                <div className="ct-tags">
                  {selectedContact.tags.length === 0 && (
                    <span className="ct-drawer-empty-hint">Nenhuma tag ainda.</span>
                  )}
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

                {/* Adicionar nova tag */}
                <div className="ct-drawer-input-row">
                  <input
                    className="ct-modal-input"
                    placeholder="Nova tag…"
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleAddTag(); }}
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
              </section>

              {/* Notas */}
              <section className="ct-drawer-section">
                <h4 className="ct-drawer-label">Notas</h4>
                <div className="ct-drawer-notes">
                  <StickyNote size={14} className="ct-field-icon" />
                  <span>{selectedContact.notes ?? 'Sem notas.'}</span>
                </div>
              </section>
            </div>

            {/* Footer actions */}
            <div className="ct-drawer-footer">
              <button
                className="ct-btn ct-btn-danger"
                onClick={() => setDeleteTarget(selectedContact)}
              >
                <Trash2 size={14} />
                Excluir
              </button>
              <button className="ct-btn ct-btn-ghost" onClick={closeDrawer}>
                Fechar
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Confirmação de exclusão */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Excluir contato"
        message={`Tem certeza que deseja excluir ${deleteTarget?.name ?? deleteTarget?.phone ?? 'este contato'}?`}
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

export default Contacts;
