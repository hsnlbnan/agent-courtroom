'use client';
// The record's statements in order: openings, turns, notes, closings. Replies link to what they answer.
import { type Member, accentOf } from '@/lib/council';
import { memberName, noteText, refLabel, useT, voteName, voteText } from '@/lib/i18n';
import { prefersReducedMotion } from '@/lib/motion';
import { statementBody } from '@/lib/statement';
import type { Entry } from '@/lib/types';
import Rich from './Rich';

function jump(key: string) {
  const id = /^T\d+$/.test(key) ? `t-${key.slice(1)}` : /^U\d+$/.test(key) ? `u-${key.slice(1)}` : key.startsWith('O-') ? `o-${key.slice(2)}` : key;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
}

export default function Transcript({ entries, members }: { entries: Entry[]; members: Member[] }) {
  const { t } = useT();
  const label = (r: string) => memberName(t, members, r);
  return (
    <ol aria-live="polite" aria-relevant="additions">
      {entries.map((e, i) => {
        // The record is append-only, so a position never changes owner.
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
        if (e.kind === 'note') return <li key={`n${i}`} className="note">{noteText(t, e)}</li>;
        if (e.kind === 'user') return (
          <li key={`u${e.k}`} id={`u-${e.k}`} tabIndex={-1} className="user">
            <div className="who"><b>{t.you}</b><span className="n">U{e.k}</span></div>
            <p>{e.text}</p>
          </li>
        );
        const id = e.kind === 'turn' ? `t-${e.n}` : e.kind === 'opening' ? `o-${e.role}` : `c-${e.role}`;
        return (
          <li key={id} id={id} tabIndex={-1} className={i === entries.length - 1 ? 'now' : undefined} style={{ ['--accent' as string]: accentOf(e.role) }}>
            <div className="who">
              <b>{label(e.role)}</b>
              {e.kind === 'turn' && <span className="n">T{e.n}</span>}
              {e.kind === 'opening' && <span className="n">{t.openingTag}</span>}
              {e.kind === 'closing' && <span className="n">{t.closingTag}</span>}
              {e.kind === 'turn' && e.stance && <span className={`st st-${e.stance}`}>{t.stances[e.stance] ?? e.stance}</span>}
              {e.kind === 'turn' && e.replyTo && <button type="button" className="to" onClick={() => jump(e.replyTo ?? '')}>→ {refLabel(t, e.replyTo, label)}</button>}
              {e.kind === 'turn' && e.mismatch && <span className="mm" title={t.mismatchTitle}>{t.mismatch}</span>}
              {e.kind !== 'turn' && e.vote && <span className="vote">{voteText(t, e.vote)}</span>}
            </div>
            <Rich text={e.kind === 'turn' ? e.body : statementBody(e.body, (v) => voteName(t, v))}
              citations={e.kind === 'turn' ? e.citations : undefined} />
          </li>
        );
      })}
    </ol>
  );
}
