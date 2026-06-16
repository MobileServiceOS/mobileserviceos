import { useState, type ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────
//  ConfirmDialog — styled replacement for window.confirm()
//
//  Matches the app's modal idiom (.modal-overlay > .modal) and adds
//  async feedback the native confirm can't give: while onConfirm runs the
//  buttons disable and the action label swaps to a busy label, so a
//  Firestore write that takes a beat reads as "working" rather than frozen.
//
//  Contract:
//    - onConfirm runs the action. RESOLVING closes the dialog (onClose);
//      THROWING keeps it open with the buttons re-enabled so the operator
//      can retry. The action itself owns its success/error toast.
//    - Mount only while needed ({pending && <ConfirmDialog … />}) so each
//      open is a fresh instance and the busy state never leaks between uses.
// ─────────────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({
  title, body, confirmLabel, busyLabel = 'Working…', tone = 'primary', onConfirm, onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      setBusy(false); // action toasted the failure — stay open for retry
      return;
    }
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="modal" role="alertdialog" aria-label={title}>
        <div className="modal-title" style={tone === 'danger' ? { color: 'var(--red)' } : undefined}>
          {title}
        </div>
        <div className="modal-sub">{body}</div>
        <div className="modal-actions">
          <button className="btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${tone}`} onClick={run} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
