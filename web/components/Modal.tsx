'use client';
// A modal dialog: the native <dialog> opened with showModal() (focus trap and backdrop from the
// browser), a title row with a close button, Escape and a backdrop click close it, and Escape
// never reaches the page behind it. Focus returns to what had it before.
import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n';

export default function Modal({ open, onClose, title, titleId, className, kicker, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; titleId: string; className: string;
  kicker?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { opener.current = document.activeElement as HTMLElement | null; d.showModal(); }
    if (!open && d.open) { d.close(); opener.current?.focus?.(); }
  }, [open]);
  return (
    // A click on the backdrop closes; Escape does the same natively.
    <dialog ref={ref} className={`modal ${className}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // A dialog the browser closed by itself still tells its owner, so `open` never goes stale.
      onClose={() => { if (open) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <header className="modal-head">
        <div>
          {kicker && <p className="kicker">{kicker}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button type="button" className="ctl close" onClick={onClose} aria-label={t.close}>✕</button>
      </header>
      {children}
      {footer && <footer className="modal-foot">{footer}</footer>}
    </dialog>
  );
}
