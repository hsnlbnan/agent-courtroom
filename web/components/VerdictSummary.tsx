'use client';
// The chair's verdict in the record: the call, each member's vote, the minority views and the next steps.
import type { Member, Vote } from '@/lib/council';
import { memberName, useT, voteText } from '@/lib/i18n';
import { type Chair, stepsOf } from '@/lib/types';
import { shortName } from './ModelPicker';
import Rich from './Rich';

export default function VerdictSummary({ chair, members, votes, onOpenVerdict }: {
  chair: Chair; members: Member[]; votes: Record<string, Vote>; onOpenVerdict?: () => void;
}) {
  const { t } = useT();
  const label = (r: string) => memberName(t, members, r);
  const steps = stepsOf(chair);
  return (
    <section className="verdict" id="verdict" tabIndex={-1} aria-labelledby="verdict-title">
      <h3 id="verdict-title">{t.verdictTitle(t.votes[chair.verdict] ?? chair.verdict, Number(chair.confidence).toFixed(2))}</h3>
      <p className="reason">{chair.reason}</p>
      {onOpenVerdict && <button type="button" className="ctl primary" onClick={onOpenVerdict}>{t.openVerdict}</button>}
      <table>
        <thead><tr><th scope="col">{t.member}</th><th scope="col">{t.model}</th><th scope="col">{t.vote}</th></tr></thead>
        <tbody>
          {members.filter((m) => !m.chair).map((m) => (
            <tr key={m.role}><td>{label(m.role)}</td><td>{shortName(m.model)}</td><td>{voteText(t, votes[m.role]) || '—'}</td></tr>
          ))}
        </tbody>
      </table>
      {!!chair.disagreements?.length && (
        <>
          <h4>{t.minority}</h4>
          {chair.disagreements.map((d) => (
            <div key={d.topic} className="dis">
              <p className="topic">{d.topic}</p>
              <ul>{(d.positions ?? []).map((p) => <li key={p.role}><b>{label(p.role)}:</b> {p.position}</li>)}</ul>
              {d.chair_read && <p className="read">{t.chairSays}: {d.chair_read}</p>}
            </div>
          ))}
        </>
      )}
      {steps.length > 0 && (
        <>
          <h4>{chair.first_steps ? t.firstSteps : t.actions}</h4>
          <ol className="steps">{steps.map((a) => <li key={String(a)}><Rich text={String(a)} /></li>)}</ol>
        </>
      )}
    </section>
  );
}
