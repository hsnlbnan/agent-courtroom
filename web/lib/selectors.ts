// What the screens read from a hearing's state: the 3D frame, who is still writing, what the
// hearing is waiting on, and the line under the scene in the UI's language.
import { benchOf, type Frame, type Role } from './council';
import type { HearingState, Ruling } from './hearing';
import { type Dict, memberName, refLabel, roleName, voteName } from './i18n';
import { isTurn } from './types';

/** The line under the scene. */
export function rulingText(t: Dict, r: Ruling, members: HearingState['members']): string {
  const name = (role: Role) => memberName(t, members, role);
  switch (r.kind) {
    case 'openings': return t.rulingOpenings;
    case 'openingsN': return t.rulingOpeningsN(r.n);
    case 'pick': return t.rulingPick(r.byRule, name(r.role), refLabel(t, r.replyTo, name), (r.whyCode && t.why[r.whyCode]) || r.why);
    case 'closing': return t.rulingClosing(name(r.role));
    case 'verdict': return t.rulingVerdict(voteName(t, r.verdict), r.confidence.toFixed(2));
    case 'verdictWritten': return t.rulingVerdictWritten;
    case 'userNote': return t.rulingUserNote(r.k);
    case 'stopped': return t.rulingStopped(t.stopReasons[r.reason] ?? r.reason);
    case 'failed': return t.failedTitle;
    default: return '';
  }
}

/** The member a reply reference points at: T3 → who spoke T3, O-skeptic → skeptic. */
function targetOf(s: HearingState, replyTo: string | null): Role | null {
  if (!replyTo) return null;
  const turn = replyTo.match(/^T(\d+)$/);
  if (turn) return s.entries.filter(isTurn).find((x) => x.n === Number(turn[1]))?.role ?? null;
  return replyTo.match(/^O-(.+)$/)?.[1] ?? null;
}

const turnsOf = (s: HearingState) => s.entries.filter(isTurn).length;
/** Closings are under way (or about to be): the turn limit is reached and nobody holds the floor. */
const closingTime = (s: HearingState) => s.phase === 'closings' || (s.phase === 'talk' && !s.live && turnsOf(s) >= s.maxTurns);

/** Who is still writing during the parallel rounds, where nobody holds the floor. */
export function writingNow(s: HearingState): Role[] {
  if (s.ended) return [];
  const kind = s.phase === 'openings' ? 'opening' : closingTime(s) ? 'closing' : null;
  if (!kind) return [];
  const done = new Set(s.entries.filter((e) => e.kind === kind).map((e) => (e.kind === 'opening' || e.kind === 'closing' ? e.role : '')));
  return benchOf(s.members).filter((m) => !done.has(m.role)).map((m) => m.role);
}

export function toFrame(s: HearingState, t: Dict): Frame {
  const { live, last, speaker } = s;
  const replyTo = live?.replyTo ?? last?.replyTo ?? null;
  const target = targetOf(s, replyTo);
  const showTurn = s.phase === 'talk' && (live || last);
  const linkKind = last && !live ? (last.stance === 'challenge' ? 'objection' : last.stance === 'question' ? 'question' : 'reply') : null;
  return {
    title: s.title, members: s.members.map((m) => ({ ...m, label: roleName(t, m.role, m.label) })), speaker,
    ruling: rulingText(t, s.ruling, s.members), votes: s.votes,
    turn: live ? { n: live.n, stance: null, body: live.body, replyTo, target }
      : showTurn && last ? { n: last.n, stance: last.stance, body: last.body, replyTo, target } : null,
    link: linkKind && target && speaker && target !== speaker && linkKind !== 'reply' ? { from: speaker, to: target, kind: linkKind } : null,
    verdict: s.phase === 'verdict' && s.chair ? { verdict: s.chair.verdict, confidence: Number(s.chair.confidence), reason: s.chair.reason } : null,
    writing: writingNow(s),
  };
}

/** The one thing a live hearing is waiting on, or null when nothing is pending. `key` changes when the wait does. */
export function waitingOn(s: HearingState, isLive: boolean, t: Dict): { key: string; text: string; hint?: string } | null {
  if (!isLive) return null;
  if (!s.started) return { key: 'connect', text: t.connecting };
  const bench = benchOf(s.members).length;
  const openings = s.entries.filter((e) => e.kind === 'opening').length;
  if (s.phase === 'openings') return { key: `open-${openings}`, text: t.waitOpenings(openings, bench) };
  if (s.live && !s.live.body.trim()) return { key: `words-${s.live.n}`, text: t.waitWords(memberName(t, s.members, s.live.role)), hint: t.waitWordsHint };
  if (s.live) return null; // words are arriving
  if (s.phase === 'closings' && s.closingsDone >= bench) return { key: 'verdict', text: t.waitVerdict };
  if (closingTime(s)) return { key: `close-${s.closingsDone}`, text: t.waitClosings(s.closingsDone, bench) };
  if (s.phase === 'talk') return { key: `pick-${turnsOf(s)}`, text: t.waitPick };
  return null;
}
