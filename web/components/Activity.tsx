'use client';
// What is happening right now, under the scene: who is up, what we are waiting
// for and for how long. Ended hearings that did not reach a verdict get a card
// that says why and what to do next.
import { accentOf, benchOf } from '@/lib/council';
import { formatClock } from '@/lib/format';
import type { HearingState } from '@/lib/hearing';
import { useElapsed } from '@/lib/hooks/useElapsed';
import { roleName, useT } from '@/lib/i18n';
import { waitingOn } from '@/lib/selectors';

const HINT_AFTER_S = 8;

export default function Activity({ hearing: s, isLive, onNewCase, onExport }: {
  hearing: HearingState; isLive: boolean; onNewCase: () => void; onExport: (format: 'md' | 'json') => void;
}) {
  const { t } = useT();
  const wait = waitingOn(s, isLive, t);
  // Counted from the last event, so a reload does not reset the clock.
  const seconds = useElapsed(!!wait, wait?.key ?? 'none', s.startedAt != null ? s.startedAt + s.ts : null);

  if (s.phase === 'failed' || s.phase === 'stopped') {
    const failed = s.phase === 'failed';
    const fix = t.failedFixes[s.failureCause ?? 'unknown'] ?? t.failedFixes.unknown;
    return (
      <section className={`endcard ${failed ? 'failed' : 'stopped'}`} role="status" aria-labelledby="endcard-title">
        <h2 id="endcard-title">{failed ? t.failedTitle : t.stoppedTitle}</h2>
        <p>{failed ? t.failedBody : t.stoppedBody(t.stopReasons[s.stopReason ?? ''] ?? s.stopReason ?? '')}</p>
        {failed && fix && <p className="fix">{fix.text}{fix.cmd && <> <code>{fix.cmd}</code></>}</p>}
        {failed && s.failure && (
          <details><summary>{t.failedDetail}</summary><code>{s.failure}</code></details>
        )}
        <div className="row">
          <button type="button" className="ctl primary" onClick={onNewCase}>{t.newCase}</button>
          {s.entries.length > 0 && <button type="button" className="ctl" onClick={() => onExport('md')}>{t.exportMd}</button>}
        </div>
      </section>
    );
  }
  if (!wait) return null;

  // During openings, show who is still writing.
  const bench = benchOf(s.members);
  const done = new Set(s.entries.flatMap((e) => (e.kind === 'opening' ? [e.role] : [])));
  return (
    <div className="activity" role="status">
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="what">{wait.text}</span>
      <span className="time">{t.elapsed(formatClock(seconds))}</span>
      {s.phase === 'openings' && bench.length > 0 && (
        <span className="who">
          {bench.map((m) => (
            <span key={m.role} className={`pill${done.has(m.role) ? ' in' : ''}`} style={{ ['--accent' as string]: accentOf(m.role) }}>
              {roleName(t, m.role, m.label)} · {done.has(m.role) ? t.ready : t.pending}
            </span>
          ))}
        </span>
      )}
      {wait.hint && seconds > HINT_AFTER_S && <span className="hint">{wait.hint}</span>}
    </div>
  );
}
