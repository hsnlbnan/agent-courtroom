// The state of one hearing, folded from its event stream. Pure: no fetching, no translation.
// The line under the scene (`ruling`) is kept as data and rendered in the UI's language later.
import type { Member, Role, Vote } from './council';
import type { CouncilEvent } from './events';
import type { Chair, Citation, Entry, Followup, TurnEntry } from './types';

export type Ruling =
  | { kind: 'none' }
  | { kind: 'openings' }
  | { kind: 'openingsN'; n: number }
  | { kind: 'pick'; byRule: boolean; role: Role; replyTo: string; why: string; whyCode?: string }
  | { kind: 'closing'; role: Role }
  | { kind: 'verdict'; verdict: string; confidence: number }
  | { kind: 'verdictWritten' }
  | { kind: 'userNote'; k: number }
  | { kind: 'stopped'; reason: string }
  | { kind: 'failed' };

export type Phase = 'idle' | 'openings' | 'talk' | 'closings' | 'verdict' | 'stopped' | 'failed';

export interface HearingState {
  title: string; mode: string; maxTurns: number; ts: number; tokens: number;
  members: Member[]; votes: Record<Role, Vote>; entries: Entry[];
  speaker: Role | null; live: { n: number; role: Role; raw: string; body: string; replyTo: string | null } | null;
  last: TurnEntry | null; ruling: Ruling; phase: Phase;
  chair: Chair | null; ended: boolean;
  // Context for the waiting, failed and verdict screens.
  started: boolean; target: string; focus: string; appealOf: string | null;
  closingsDone: number; verdictMd: string; verdictCites: Citation[]; failure: string | null; stopReason: string | null;
  /** Why the case failed (timeout, auth, limit, exit, empty) and when it started (epoch ms). */
  failureCause: string | null; startedAt: number | null;
  followups: Record<string, Followup>;
}

export const initialHearing: HearingState = {
  title: '', mode: 'idea', maxTurns: 0, ts: 0, tokens: 0, members: [], votes: {}, entries: [], speaker: null, live: null,
  last: null, ruling: { kind: 'none' }, phase: 'idle', chair: null, ended: false,
  started: false, target: '', focus: '', appealOf: null, closingsDone: 0, verdictMd: '', verdictCites: [], failure: null, stopReason: null,
  failureCause: null, startedAt: null, followups: {},
};

/** What the reducer accepts: a server event, a fresh start, or a follow-up the UI ran itself. */
export type HearingAction =
  | { kind: 'reset' }
  | { kind: 'event'; ev: CouncilEvent }
  | { kind: 'followup'; name: string; followup: Followup };

// Header lines arrive in pieces ("STANCE: " then "concede\n"), so strip from the whole raw text
// every time, and hold back a last line that may still be a header in progress.
const HEADERS = ['REPLY_TO:', 'ADDRESSES:', 'STANCE:'];
export const stripHeader = (s: string) => {
  const body = s.replace(/^\s*(REPLY_TO|ADDRESSES|STANCE):.*(\n|$)/gim, '');
  const tail = body.trim().toUpperCase();
  return tail && !body.includes('\n') && HEADERS.some((h) => h.startsWith(tail)) ? '' : body;
};

/** The first reference a turn answers, skipping itself (models sometimes write "T1 | O-skeptic" on T1). */
export const firstRef = (raw: string | undefined, n: number) =>
  raw?.split('|').map((x) => x.trim()).find((x) => x && x !== `T${n}`) ?? null;

function applyEvent(s: HearingState, ev: CouncilEvent): HearingState {
  const next: HearingState = { ...s, ts: ev.ts };
  switch (ev.type) {
    case 'case.started': {
      const d = ev.data;
      return { ...next, title: d.title, mode: d.mode, maxTurns: d.maxTurns, phase: 'openings', ruling: { kind: 'openings' },
        started: true, startedAt: d.startedAt ?? null, target: d.target ?? '', focus: d.focus ?? '', appealOf: d.appealOf ?? null };
    }
    case 'member.registered': return { ...next, members: [...s.members.filter((m) => m.role !== ev.data.role), ev.data] };
    case 'opening.completed': {
      const d = ev.data;
      const done = s.entries.filter((x) => x.kind === 'opening').length + 1;
      return { ...next, entries: [...s.entries, { kind: 'opening', role: d.role, body: d.body, vote: d.vote }],
        votes: d.vote ? { ...s.votes, [d.role]: d.vote } : s.votes, ruling: { kind: 'openingsN', n: done } };
    }
    case 'moderator.pick': {
      const d = ev.data;
      return { ...next, phase: 'talk', ruling: { kind: 'pick', byRule: d.source === 'rule', role: d.role, replyTo: d.replyTo ?? '', why: d.why, whyCode: d.whyCode } };
    }
    case 'turn.started': return { ...next, speaker: ev.data.role, live: { n: ev.data.n, role: ev.data.role, raw: '', body: '', replyTo: ev.data.replyTo } };
    case 'turn.delta': {
      if (!s.live || s.live.n !== ev.data.n) return next;
      const raw = s.live.raw + (ev.data.text ?? '');
      return { ...next, live: { ...s.live, raw, body: stripHeader(raw) } };
    }
    case 'turn.completed': {
      const d = ev.data;
      const turn: TurnEntry = { kind: 'turn', n: d.n, role: d.role, stance: d.header?.stance ?? null,
        replyTo: firstRef(d.header?.replyTo, d.n), body: d.body, mismatch: !!d.mismatch, citations: d.citations ?? [] };
      return { ...next, entries: [...s.entries, turn], last: turn, live: null, speaker: d.role };
    }
    case 'closing.completed': {
      const d = ev.data;
      return { ...next, phase: 'closings', speaker: d.role, last: null, live: null, closingsDone: s.closingsDone + 1,
        entries: [...s.entries, { kind: 'closing', role: d.role, body: d.body, vote: d.vote }],
        votes: d.vote ? { ...s.votes, [d.role]: { vote: d.vote.vote, confidence: d.vote.confidence } } : s.votes,
        ruling: { kind: 'closing', role: d.role } };
    }
    case 'verdict.completed': {
      const c = ev.data.chair;
      return { ...next, phase: 'verdict', speaker: null, chair: c, verdictMd: ev.data.markdown ?? '', verdictCites: ev.data.citations ?? [],
        ruling: c ? { kind: 'verdict', verdict: c.verdict, confidence: Number(c.confidence) } : { kind: 'verdictWritten' } };
    }
    case 'note': {
      const d = ev.data;
      const failed = d.code === 'error';
      return { ...next, entries: [...s.entries, { kind: 'note', text: d.text, code: d.code, params: d.params }],
        failure: failed ? String(d.params?.detail || d.params?.message || d.text) : s.failure,
        failureCause: failed ? String(d.params?.cause ?? 'unknown') : s.failureCause };
    }
    case 'user.note': return { ...next, entries: [...s.entries, { kind: 'user', k: ev.data.k, text: ev.data.text }], ruling: { kind: 'userNote', k: ev.data.k } };
    case 'usage': return { ...next, tokens: s.tokens + (ev.data.inputTokens ?? 0) + (ev.data.outputTokens ?? 0) };
    case 'case.stopped': return { ...next, phase: 'stopped', speaker: null, live: null, ended: true, stopReason: ev.data.reason, ruling: { kind: 'stopped', reason: ev.data.reason } };
    case 'case.ended':
      return ev.data.endedBy === 'error'
        ? { ...next, ended: true, phase: 'failed', speaker: null, live: null, ruling: { kind: 'failed' } }
        : { ...next, ended: true };
    case 'followup.started': return { ...next, followups: { ...s.followups, [ev.data.kind]: { status: 'running' } } };
    case 'followup.completed': return { ...next, followups: { ...s.followups, [ev.data.kind]: { status: 'done', markdown: ev.data.markdown, citations: ev.data.citations ?? [] } } };
    case 'followup.failed': return { ...next, followups: { ...s.followups, [ev.data.kind]: { status: 'failed', message: ev.data.message } } };
    default: return next;
  }
}

export function hearingReducer(s: HearingState, action: HearingAction): HearingState {
  if (action.kind === 'reset') return initialHearing;
  if (action.kind === 'followup') return { ...s, followups: { ...s.followups, [action.name]: action.followup } };
  return applyEvent(s, action.ev);
}
