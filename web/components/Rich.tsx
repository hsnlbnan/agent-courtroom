// Tiny, safe markdown: paragraphs, lists (one nested level), `code`, **bold**, *italic*. React escapes all text.
// A known citation is marked even without backticks (judges often write `(idea.md:4)` bare),
// and the protocol's [assumption] tag is shown as a translated label.
import { Fragment } from 'react';
import { type Dict, useT } from '@/lib/i18n';
import type { Citation } from '@/lib/types';

function inline(t: Dict, text: string, cites?: Map<string, Citation>) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[assumption\]|[\w./-]+\.\w+:\d+(?:-\d+)?)/g).filter(Boolean).map((part, i) => {
    if (part === '[assumption]' || part === '`[assumption]`') return <span key={i} className="assume">{t.assumption}</span>;
    const ticked = part.startsWith('`') && part.endsWith('`') && part.length > 2;
    if (ticked || cites?.has(part)) {
      const code = ticked ? part.slice(1, -1) : part;
      const c = cites?.get(code);
      return (
        <code key={i} className={c?.verified === true ? 'ok' : c?.verified === false ? 'bad' : undefined}
          title={c?.verified === true ? t.citeOk : c?.verified === false ? t.citeBad : undefined}>{code}</code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export default function Rich({ text, citations }: { text: string; citations?: Citation[] }) {
  const { t } = useT();
  const cites = new Map((citations ?? []).map((c) => [c.ref, c]));
  const blocks: React.ReactNode[] = [];
  let list: { text: string; sub: string[] }[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push(<p key={blocks.length}>{inline(t, para.join(' '), cites)}</p>); para = []; }
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>
              {inline(t, l.text, cites)}
              {l.sub.length > 0 && <ul>{l.sub.map((x, j) => <li key={j}>{inline(t, x, cites)}</li>)}</ul>}
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.replace(/```[\s\S]*?```/g, '').split('\n')) {
    const line = raw.trim();
    const li = line.match(/^(?:[-*]|\d+\.)\s+(.*)/);
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (!line) flush();
    else if (h) { flush(); blocks.push(<p key={blocks.length} className="h">{inline(t, h[1], cites)}</p>); }
    else if (li && list.length && /^\s{2,}/.test(raw)) list[list.length - 1].sub.push(li[1]);
    else if (li) { if (para.length) flush(); list.push({ text: li[1], sub: [] }); }
    else { if (list.length) flush(); para.push(line); }
  }
  flush();
  return <div className="rich">{blocks}</div>;
}
