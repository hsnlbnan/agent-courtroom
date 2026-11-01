'use client';
// The verdict as a screen of its own: decision and confidence, how each member voted, what was
// agreed, what is still disputed (with the minority positions), next steps, the judge's full
// reasoning, and "what next" follow-ups.
import { useState } from 'react';
import { accentOf, benchOf, VOTE_TINT } from '@/lib/council';
import { formatClock } from '@/lib/format';
import type { HearingState } from '@/lib/hearing';
import { useElapsed } from '@/lib/hooks/useElapsed';
import { memberName, useT, voteName } from '@/lib/i18n';
import { type Chair, type Citation, type Followup, stepsOf } from '@/lib/types';
import Modal from './Modal';
import { shortName } from './ModelPicker';
import Rich from './Rich';

function FollowupCard({ kind, title, hint, f, onRun }: { kind: string; title: string; hint: string; f?: Followup; onRun: () => void }) {
  const { t } = useT();
  const running = f?.status === 'running';
  const seconds = useElapsed(running, kind);
  return (
    <article className={`fu fu-${kind}`} aria-busy={running}>
      <header>
        <h4>{title}</h4>
        <button type="button" className="ctl" disabled={running} onClick={onRun}>{f?.status === 'done' ? t.fuAgain : t.fuRun}</button>
      </header>
      <p className="hint">{hint}</p>
      {running && <p className="state" role="status"><span className="dots" aria-hidden="true"><i /><i /><i /></span> {t.fuRunning(formatClock(seconds))}</p>}
      {f?.status === 'failed' && <p className="state bad" role="alert">{t.fuFailed(f.message ?? '')}</p>}
      {f?.status === 'done' && f.markdown && <div className="result"><Rich text={f.markdown} citations={f.citations} /></div>}
    </article>
  );
}

function AppealCard({ onAppeal }: { onAppeal: () => Promise<void> }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <article className="fu fu-appeal">
      <header>
        <h4>{t.fuAppeal}</h4>
        <button type="button" className="ctl primary" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await onAppeal(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
        }}>{busy ? t.opening : t.fuOpen}</button>
      </header>
      <p className="hint">{t.fuAppealHint}</p>
      {error && <p className="state bad" role="alert">{error}</p>}
    </article>
  );
}

/** Who said what in one disagreement, then the judge's reading, in the vote list's dot-and-name layout. */
function Dispute({ d, name, cites }: { d: NonNullable<Chair['disagreements']>[number]; name: (role: string) => string; cites: Citation[] }) {
  const { t } = useT();
  return (
    <article className="dispute">
      <h4>{d.topic}</h4>
      <dl className="positions">
        {(d.positions ?? []).map((p) => (
          <div key={p.role} className="row" style={{ ['--accent' as string]: accentOf(p.role) }}>
            <dt><span className="dot" aria-hidden="true" />{name(p.role)}</dt>
            <dd><Rich text={p.position} citations={cites} /></dd>
          </div>
        ))}
        {d.chair_read && (
          <div className="row judge">
            <dt>{t.chairRead}</dt>
            <dd><Rich text={d.chair_read} citations={cites} /></dd>
          </div>
        )}
      </dl>
    </article>
  );
}

export default function VerdictView({ hearing: s, open, onClose, onFollowup, onAppeal }: {
  hearing: HearingState; open: boolean; onClose: () => void;
  onFollowup: (kind: 'ideas' | 'risks') => void; onAppeal: () => Promise<void>;
}) {
  const { t } = useT();
  const chair = s.chair;
  const name = (role: string) => memberName(t, s.members, role);
  const steps = stepsOf(chair);
  const cites = s.verdictCites;

  return (
    <Modal open={open} onClose={onClose} className="verdict-view" titleId="vv-title" title={s.title}
      kicker={`${t.verdictScreen}${s.appealOf ? ` · ${t.appealOf}` : ''}`}>
      <div className="vv">
        {!chair ? <p className="empty">{t.noVerdictYet}</p> : (
          <>
            <section className="decision" style={{ ['--tint' as string]: VOTE_TINT[chair.verdict] }}>
              <div className="head">
                <p className="word">{voteName(t, chair.verdict)}</p>
                <span className="conf">{t.confidenceLabel} {Number(chair.confidence).toFixed(2)}</span>
              </div>
              <p className="reason">{chair.reason}</p>
            </section>

            <section aria-labelledby="vv-votes">
              <h3 id="vv-votes">{t.votesTitle}</h3>
              <ul className="votes">
                {benchOf(s.members).map((m) => {
                  const v = s.votes[m.role];
                  return (
                    <li key={m.role} style={{ ['--accent' as string]: accentOf(m.role) }}>
                      <span className="who"><span className="dot" aria-hidden="true" />{name(m.role)} <span className="model">{shortName(m.model)}</span></span>
                      <span className={`chip v-${v?.vote ?? 'none'}`}>{v?.vote ? voteName(t, v.vote) : '—'}</span>
                      <span className="num">{v?.confidence != null ? Number(v.confidence).toFixed(2) : ''}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="cols">
              {!!chair.consensus?.length && (
                <section aria-labelledby="vv-agreed">
                  <h3 id="vv-agreed">{t.consensus}</h3>
                  <ul className="plain">{chair.consensus.map((x) => <li key={x}><Rich text={x} citations={cites} /></li>)}</ul>
                </section>
              )}
              {steps.length > 0 && (
                <section aria-labelledby="vv-steps">
                  <h3 id="vv-steps">{t.nextSteps}</h3>
                  <ol className="steps">{steps.map((x) => <li key={String(x)}><Rich text={String(x)} citations={cites} /></li>)}</ol>
                </section>
              )}
            </div>

            {!!chair.disagreements?.length && (
              <section aria-labelledby="vv-open">
                <h3 id="vv-open">{t.openQuestions}</h3>
                {chair.disagreements.map((d) => <Dispute key={d.topic} d={d} name={name} cites={cites} />)}
              </section>
            )}

            {s.verdictMd && (
              <details className="full">
                <summary>{t.fullReasoning}</summary>
                <Rich text={s.verdictMd.replace(/^# .*\n+/, '')} citations={cites} />
              </details>
            )}

            <section className="next" aria-labelledby="vv-next">
              <h3 id="vv-next">{t.whatNext}</h3>
              <div className="fus">
                <FollowupCard kind="ideas" title={t.fuIdeas} hint={t.fuIdeasHint} f={s.followups.ideas} onRun={() => onFollowup('ideas')} />
                <FollowupCard kind="risks" title={t.fuRisks} hint={t.fuRisksHint} f={s.followups.risks} onRun={() => onFollowup('risks')} />
                <AppealCard onAppeal={async () => { await onAppeal(); onClose(); }} />
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
