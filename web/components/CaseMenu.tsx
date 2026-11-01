'use client';
// Case switcher: one button with the current title; a quiet list of past and
// live cases underneath.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from '@/lib/hooks/useDismiss';
import { useT } from '@/lib/i18n';
import type { CaseInfo } from '@/lib/types';

const when = (locale: string, ms?: number) => (ms ? new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function CaseMenu({ cases, current, onPick, onNew }: { cases: (CaseInfo & { created_at?: number })[]; current: CaseInfo | null; onPick: (c: CaseInfo) => void; onNew?: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close, { trigger });
  // Opening moves focus into the list; picking or Escape returns it to the trigger.
  useEffect(() => { if (open) root.current?.querySelector<HTMLButtonElement>('.cases button')?.focus(); }, [open]);
  const pick = (c: CaseInfo) => { onPick(c); setOpen(false); trigger.current?.focus(); };
  return (
    <div className="casemenu" ref={root}>
      <button ref={trigger} type="button" className="case-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="case-title">{current?.title ?? t.noCase}</span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cases" role="dialog" aria-label={t.cases}>
          {cases.length === 0 && (
            <div className="empty">
              <p>{t.noCases}</p>
              {onNew && <button type="button" className="ctl primary" onClick={() => { setOpen(false); onNew(); }}>{t.firstCase}</button>}
            </div>
          )}
          <ul>
            {cases.map((c) => (
              <li key={c.id}>
                <button type="button" aria-current={c.id === current?.id ? 'true' : undefined}
                  onClick={() => pick(c)}>
                  <span className="t">{c.title}</span>
                  <span className="m">
                    {c.live ? <span className="live">{t.liveDot}</span> : t.status[c.status] ?? c.status}
                    {c.source === 'import' ? ` · ${t.sample}` : ''}{c.created_at ? ` · ${when(t.locale, c.created_at)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
