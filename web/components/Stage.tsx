'use client';
// Stage = 3D room + typographic overlay. The canvas is decorative; the text
// overlay and the transcript rail carry the meaning for assistive tech.
import { useTheme } from '@/lib/theme';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { type Frame, VOTE_TINT, accentOf, placeOf } from '@/lib/council';
import { useT } from '@/lib/i18n';
import type { Palette } from './Courtroom';
import SceneBoundary, { hasWebGL } from './SceneBoundary';

// The speech band is read, not parsed: drop markdown markers.
const plain = (s: string) => s.replace(/\*\*|`|^#+\s*/gm, '');

const Courtroom = dynamic(() => import('./Courtroom'), { ssr: false });

const LIGHT: Palette = { clay: '#f3eee7', clayDeep: '#e1d9ce', wood: '#c4ab8c', base: '#cbc1b3', bg: '#d9d3ca', arc: '#c8412f', dark: false };
const DARK: Palette = { clay: '#5c5c62', clayDeep: '#46464c', wood: '#6e5b49', base: '#2a2a2e', bg: '#0f0f11', arc: '#ef6a52', dark: true };

function usePrefers(query: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = matchMedia(query);
    setOn(mq.matches);
    const fn = () => setOn(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return on;
}

export type { Aside } from '@/lib/preview';
import type { Aside } from '@/lib/preview';

export default function Stage({ frame, aside, top, extra, onOpenVerdict }: { frame: Frame; aside?: Aside | null; top?: React.ReactNode; extra?: React.ReactNode; onOpenVerdict?: () => void }) {
  const { t: tr } = useT();
  const { dark } = useTheme();
  const still = usePrefers('(prefers-reduced-motion: reduce)');
  const [gl, setGl] = useState(true);
  useEffect(() => setGl(hasWebGL()), []);
  const [drawn, setDrawn] = useState(false);
  const speaker = frame.members.find((m) => m.role === frame.speaker);
  const target = frame.turn?.target ? frame.members.find((m) => m.role === frame.turn?.target) : null;
  const t = frame.turn;
  return (
    <section className="stage" aria-label={tr.stage}>
      <div className="canvas">
        {gl ? <SceneBoundary><Courtroom frame={frame} palette={dark ? DARK : LIGHT} still={still} onReady={() => setDrawn(true)} /></SceneBoundary>
          : <p className="no-scene">{tr.noWebGL}</p>}
        {gl && !drawn && <p className="no-scene scene-wait" aria-hidden="true">{tr.sceneLoading}</p>}
      </div>

      {top}
      <p className="ruling" role="status">{frame.ruling}</p>
      {extra}

      {t && speaker && !frame.verdict && (
        <figure className="speech" style={{ ['--accent' as string]: accentOf(speaker.role) }}>
          <figcaption>
            <span className="role">{tr.places[placeOf(speaker.role)]}</span>
            <span className="name">{speaker.label}</span>
            <span className="meta">T{t.n}{t.stance ? ` · ${tr.stances[t.stance] ?? t.stance}` : ''}{t.replyTo ? ` → ${/^O-/.test(t.replyTo) ? tr.refOpening(target?.label ?? t.replyTo.slice(2)) : `${t.replyTo}${target ? ` ${target.label}` : ''}`}` : ''}</span>
          </figcaption>
          {t.stance === 'challenge' && <span className="objection">{tr.objection}</span>}
          {t.body.trim() ? <blockquote>{plain(t.body)}</blockquote> : <p className="thinking" aria-hidden="true"><i /><i /><i /></p>}
        </figure>
      )}

      {!t && !frame.verdict && aside && (
        <figure className="speech" style={{ ['--accent' as string]: accentOf(aside.role) }}>
          <figcaption><span className="role">{aside.kicker}</span><span className="name">{aside.name}</span><span className="meta">{aside.meta}</span></figcaption>
          <blockquote>{plain(aside.body)}</blockquote>
        </figure>
      )}

      {frame.verdict && (
        <figure className="speech verdict" style={{ ['--tint' as string]: VOTE_TINT[frame.verdict.verdict] }}>
          <figcaption><span className="role">{tr.verdict}</span><span className="name">{tr.votes[frame.verdict.verdict] ?? frame.verdict.verdict}</span>
            <span className="meta">{tr.confidence(frame.verdict.confidence.toFixed(2))}</span></figcaption>
          <blockquote>{plain(frame.verdict.reason)}</blockquote>
          {onOpenVerdict && <button type="button" className="ctl primary open-verdict" onClick={onOpenVerdict}>{tr.openVerdict}</button>}
        </figure>
      )}
    </section>
  );
}
