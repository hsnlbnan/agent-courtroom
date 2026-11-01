// The case event stream as the server sends it (app/ARCHITECTURE.md, "Event envelope"), one
// member of the union per event type. The reducer narrows on `type`; nothing is `any`.
import type { Member, Role, Stance, Vote } from './council';
import type { Chair, Citation } from './types';

type Ev<T extends string, D> = { seq: number; ts: number; type: T; data: D };

export type CouncilEvent =
  | Ev<'case.started', { title: string; mode: string; maxTurns: number; target?: string; focus?: string | null; appealOf?: string | null; startedAt?: number }>
  | Ev<'member.registered', Member & { brief?: string }>
  | Ev<'opening.completed', { role: Role; body: string; vote: Vote | null }>
  | Ev<'moderator.pick', { n: number; role: Role; replyTo: string; why: string; whyCode?: string; source: 'rule' | 'chair' }>
  | Ev<'turn.started', { n: number; role: Role; replyTo: string | null }>
  | Ev<'turn.delta', { n: number; text: string }>
  | Ev<'turn.completed', { n: number; role: Role; header?: { replyTo?: string; addresses?: string; stance?: Stance }; body: string; mismatch?: boolean; citations?: Citation[] }>
  | Ev<'closing.completed', { role: Role; body: string; vote: (Vote & { role?: string }) | null; citations?: Citation[] }>
  | Ev<'verdict.completed', { markdown?: string; chair: Chair | null; citations?: Citation[] }>
  | Ev<'note', { text: string; kind?: string; code?: string; params?: Record<string, string | number> }>
  | Ev<'user.note', { k: number; text: string }>
  | Ev<'usage', { role: Role; inputTokens?: number; outputTokens?: number; ms?: number }>
  | Ev<'case.stopped', { reason: string }>
  | Ev<'case.ended', { endedBy: string; cause?: string }>
  | Ev<'followup.started', { kind: string }>
  | Ev<'followup.completed', { kind: string; markdown: string; citations?: Citation[] }>
  | Ev<'followup.failed', { kind: string; message: string }>;

export type CouncilEventType = CouncilEvent['type'];
