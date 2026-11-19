import React, { useEffect, useState } from 'react';

// Destructive-action confirmation (brand kit §14). For wipe-level ops pass
// `requireText` — the confirm button stays disabled until the user types it.
export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    requireText = '',
    onConfirm,
    onClose,
}) {
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isOpen) return undefined;
        setTyped('');
        setBusy(false);

        const onKey = (e) => {
            if (e.key === 'Escape' && !busy) onClose();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [isOpen, busy, onClose]);

    if (!isOpen) return null;

    const mustType = requireText.length > 0;
    const canConfirm = !busy && (!mustType || typed === requireText);

    const handleConfirm = async () => {
        setBusy(true);
        try {
            await onConfirm();
            onClose();
        } catch {
            // Caller surfaces the error (toast); keep the dialog open for retry.
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="modal-overlay"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) onClose();
            }}
        >
            <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
                <h3 id="confirm-dialog-title" className="text-base">{title}</h3>
                <p className="mt-2 text-sm text-[var(--text-2)]">{message}</p>
                {mustType && (
                    <label className="mt-4 block">
                        <span className="caption block">
                            Type <span className="mono">{requireText}</span> to confirm
                        </span>
                        <input
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder={requireText}
                            autoFocus
                            spellCheck="false"
                            autoComplete="off"
                            className="input-shell mono mt-1"
                        />
                    </label>
                )}
                <div className="confirm-actions">
                    <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={danger ? 'btn-danger' : 'btn-primary'}
                        onClick={handleConfirm}
                        disabled={!canConfirm}
                    >
                        {busy ? 'Working…' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
