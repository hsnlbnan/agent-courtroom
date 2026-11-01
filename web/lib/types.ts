// Shapes the UI shares, most of them as the server sends them (app/ARCHITECTURE.md). Components
// and hooks import from here, never from each other.
import type { Role, Stance, Vote } from './council';

export interface Citation { ref: string; verified: boolean | null }

export type TurnEntry = { kind: 'turn'; n: number; role: Role; stance: Stance | null; replyTo: string | null; body: string; mismatch: boolean; citations: Citation[] };
export type StatementEntry = { kind: 'opening' | 'closing'; role: Role; body: string; vote: Vote | null };
export type Entry =
  | TurnEntry
  | StatementEntry
  | { kind: 'note'; text: string; code?: string; params?: Record<string, string | number> }
  | { kind: 'user'; k: number; text: string };
export const isTurn = (e: Entry): e is TurnEntry => e.kind === 'turn';
export const isStatement = (e: Entry): e is StatementEntry => e.kind === 'opening' || e.kind === 'closing';

export interface Chair {
  verdict: string; confidence: number; reason: string;
  consensus?: string[]; actions?: string[]; first_steps?: string[];
  disagreements?: { topic: string; positions?: { role: string; position: string }[]; chair_read?: string }[];
}
/** The chair's next steps, whichever name its JSON used. */
export const stepsOf = (c: Chair | null) => c?.first_steps ?? c?.actions ?? [];

export interface Followup { status: 'running' | 'done' | 'failed'; markdown?: string; message?: string; citations?: Citation[] }

export interface CaseInfo { id: string; title: string; mode: string; source: string; status: string; live: boolean; created_at?: number }
export interface RoleInfo { role: string; label: string; model: string; lens: string; default: boolean }
export interface Suggestion { path: string; kind: 'dir' | 'file' }
export interface Listing { path: string; parent: string | null; selectable: boolean; entries: { name: string; path: string; kind: 'dir' | 'file' }[] }

export interface Provider {
  id: string; name: string; status: 'enabled' | 'untested' | 'blocked'; models: string[]; modes?: string[]; note: string;
  installed: boolean; version: string | null;
  /** Display name and one-line description for vendor models such as `codex:gpt-6-luna`. */
  modelInfo?: Record<string, { name: string; hint: string }>;
  /** Set when the provider passed the canary on this machine. */
  connected?: boolean;
  /** What a provider still to connect needs; envSet says which variables are present (never their values). */
  setup?: { env: string[]; optional: string[]; login: string | null; envSet: Record<string, boolean> };
}
export interface ConnectResult { ok: boolean; code?: string; detail?: string }
export interface ConnectJob { state: 'idle' | 'running' | 'done'; step?: string; modes?: string[]; startedAt?: number; results?: Record<string, ConnectResult> }

/** A member role the person wrote in the new-case form. */
export interface CustomRole { key: string; label: string; brief: string }

/** The body of POST /api/cases. */
export interface StartRequest {
  target?: string; idea?: string; mode?: 'code' | 'idea'; focus: string; maxTurns: number;
  members: string[]; models: Record<string, string>; chairModel: string; custom: CustomRole[];
}
