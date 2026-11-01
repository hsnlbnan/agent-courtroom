'use client';
// Pick a folder (code) or an .md/.txt file (idea) without typing a path. Browsers do not hand a
// page the real path of a file the user chooses, so the local server lists the folders instead
// (same fence as targets: $HOME and below, no credential dirs).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { Listing } from '@/lib/types';
import Modal from './Modal';

export default function FolderPicker({ open, start, browse, onPick, onClose }: {
  open: boolean; start: string; browse: (path: string) => Promise<Listing | null>;
  onPick: (path: string) => void; onClose: () => void;
}) {
  const { t } = useT();
  const list = useRef<HTMLUListElement>(null);
  const request = useRef(0); // only the latest listing may land
  const [at, setAt] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);

  const go = useCallback(async (path: string) => {
    const mine = ++request.current;
    setBusy(true);
    const r = await browse(path);
    if (mine !== request.current) return;
    setBusy(false);
    if (!r) return;
    setAt(r);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('button')?.focus());
  }, [browse]);

  // Each opening starts where the input points (or the home folder).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening; `start` follows typing and must not re-list
  useEffect(() => { if (open) void go(start || '~'); }, [open]);

  // Path segments as a breadcrumb: ~ / Documents / Github.
  const crumbs = (at?.path ?? '~').split('/').map((name, i, all) => ({ name, path: all.slice(0, i + 1).join('/') }));

  return (
    <Modal open={open} onClose={onClose} className="picker-dialog" titleId="fp-title" title={t.browseTitle}
      footer={(
        <>
          <p className="hint">{at?.selectable ? t.browseHint : t.browseHomeHint}</p>
          <div className="row">
            <button type="button" className="ctl" onClick={onClose}>{t.cancel}</button>
            <button type="button" className="ctl primary" disabled={!at?.selectable} onClick={() => at && onPick(`${at.path}/`)}>{t.browseUseFolder}</button>
          </div>
        </>
      )}>
      <nav className="crumbs" aria-label={t.browseWhere}>
        {crumbs.map((c, i) => (
          <span key={c.path}>
            {i > 0 && <span className="sep" aria-hidden="true">/</span>}
            {i === crumbs.length - 1
              ? <span aria-current="location">{c.name}</span>
              : <button type="button" className="link" onClick={() => go(c.path)}>{c.name}</button>}
          </span>
        ))}
      </nav>
      <ul ref={list} className="entries" aria-busy={busy}>
        {at?.parent && (
          <li><button type="button" className="entry up" onClick={() => go(at.parent ?? '~')}><span className="ico" aria-hidden="true">↑</span>{t.browseUp}</button></li>
        )}
        {at?.entries.map((e) => (
          <li key={e.path}>
            <button type="button" className={`entry ${e.kind}`}
              onClick={() => (e.kind === 'dir' ? go(e.path) : onPick(e.path))}
              aria-label={e.kind === 'dir' ? t.browseOpen(e.name) : t.browsePickFile(e.name)}>
              <span className="ico" aria-hidden="true">{e.kind === 'dir' ? '▸' : '·'}</span>
              <span className="name">{e.name}</span>
              {e.kind === 'file' && <span className="tag">{t.browseIdeaFile}</span>}
            </button>
          </li>
        ))}
        {at && at.entries.length === 0 && <li className="empty">{t.browseEmpty}</li>}
      </ul>
    </Modal>
  );
}
