import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Optional secondary line, rendered muted (e.g. an irreversible-action warning). */
  warning?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** When true, the confirm button is styled as destructive. */
  danger?: boolean;
  /** Disables the confirm button + shows a busy label while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation modal. Reuses the dashboard's `.modal*` classes so it matches the
 * Sessions delete/kill dialogs, and replaces ad-hoc `window.confirm()` / unconfirmed
 * destructive clicks across pages. Closes on overlay click and Escape.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  warning,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div
        className="modal confirm-modal"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onCancel} disabled={busy} aria-label={cancelLabel}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p>{message}</p>
          {warning && <p className="text-muted">{warning}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
