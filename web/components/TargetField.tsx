'use client';
// "What should the council judge?": one box for a folder, an idea file or the idea itself, with
// path suggestions while typing a path, a nudge when a bare word names something in the home
// folder, the detected kind, and a folder browser.
import { useEffect, useId, useRef, useState } from 'react';
import { IDEA_MAX, inputKind } from '@/lib/draft';
import { useT } from '@/lib/i18n';
import type { Listing, Suggestion } from '@/lib/types';
import FolderPicker from './FolderPicker';

const SUGGEST_MS = 120;
const HOME_MATCH_MS = 200;

export default function TargetField({ value, asText, onChange, suggest, browse, inputRef }: {
  value: string; asText: boolean;
  onChange: (patch: { target?: string; asText?: boolean }) => void;
  suggest: (path: string, mode: string) => Promise<Suggestion[]>;
  browse: (path: string) => Promise<Listing | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useT();
  const listId = useId();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picking, setPicking] = useState(false);
  const [homeMatch, setHomeMatch] = useState<Suggestion | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const kind = inputKind(value, asText);
  const looksLikePath = ['dir', 'file'].includes(inputKind(value));

  // Path suggestions while the input looks like a path (debounced; a late answer for older text is dropped).
  useEffect(() => {
    if (!looksLikePath || asText) { setItems([]); return; }
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await suggest(value, 'idea');
      if (stale) return;
      setItems(found);
      setActive(-1);
    }, SUGGEST_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [value, asText, looksLikePath, suggest]);

  // A bare word like "Projects/app" reads as idea text; if it names a folder or file in the home
  // folder, offer it as that path instead of guessing.
  useEffect(() => {
    const word = value.trim();
    if (kind !== 'text' || asText || !/^[^\s~/.][^\s]{0,119}$/.test(word)) { setHomeMatch(null); return; }
    let stale = false;
    const timer = setTimeout(async () => {
      const want = `~/${word.replace(/\/$/, '')}`.toLowerCase();
      const hit = (await suggest(`~/${word}`, 'idea')).find((x) => x.path.replace(/\/$/, '').toLowerCase() === want);
      if (!stale) setHomeMatch(hit ?? null);
    }, HOME_MATCH_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [value, asText, kind, suggest]);
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const pick = (s: Suggestion) => { onChange({ target: s.path }); setOpen(s.kind === 'dir'); inputRef.current?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!looksLikePath) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  const showList = open && items.length > 0;
  const browseFrom = inputKind(value) === 'dir' ? value.replace(/\/$/, '') : inputKind(value) === 'file' ? value.replace(/\/[^/]*$/, '') : '~';

  return (
    <div className="field combo">
      <FolderPicker open={picking} browse={browse} start={browseFrom}
        onClose={() => { setPicking(false); inputRef.current?.focus(); }}
        onPick={(p) => { onChange({ target: p, asText: false }); setPicking(false); setOpen(false); inputRef.current?.focus(); }} />
      <div className="label-row">
        <label className="label" htmlFor="target">{t.judgeWhat}</label>
        <button type="button" className="ctl small" onClick={() => setPicking(true)}>{t.browse}</button>
      </div>
      <div className="combo-box">
        <textarea id="target" ref={inputRef} value={value} autoComplete="off" spellCheck={kind === 'text'}
          rows={kind === 'text' ? 6 : 2} maxLength={IDEA_MAX + 200} placeholder={t.judgePh} aria-describedby={`${listId}-kind`}
          role="combobox" aria-expanded={showList} aria-controls={showList ? listId : undefined} aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => { onChange({ target: e.target.value }); setOpen(true); }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }} onKeyDown={onKeyDown} />
        {showList && (
          <ul id={listId} role="listbox" className="suggest">
            {items.map((s, i) => (
              <li key={s.path} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }} className={i === active ? 'on' : undefined}>
                <span className="kind" aria-hidden="true">{s.kind === 'dir' ? '▸' : '·'}</span>{s.path}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="kind-line" id={`${listId}-kind`}>
        <span className={`kind-tag k-${kind}`} aria-live="polite">{kind === 'dir' ? t.kindDir : kind === 'file' ? t.kindFile : kind === 'text' ? t.kindText : ''}</span>
        {kind === 'text' && <span className={`count${value.trim().length > IDEA_MAX ? ' over' : ''}`}>{t.chars(value.trim().length, IDEA_MAX)}</span>}
        {homeMatch && (
          <button type="button" className="link home-hint" onClick={() => { onChange({ target: homeMatch.path }); inputRef.current?.focus(); }}>
            {homeMatch.kind === 'dir' ? t.homeDirHint(homeMatch.path) : t.homeFileHint(homeMatch.path)}
          </button>
        )}
        {looksLikePath && <button type="button" className="link" onClick={() => onChange({ asText: !asText })}>{asText ? t.useAsPath : t.useAsText}</button>}
      </p>
    </div>
  );
}
