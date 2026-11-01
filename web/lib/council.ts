// Shared vocabulary with app/ (see app/ARCHITECTURE.md). Kept small on purpose.

export type Role = string;
export type Stance = 'challenge' | 'question' | 'agree' | 'build' | 'concede';
export type Place = 'bench' | 'pros' | 'def' | 'witness' | 'jury';

export interface Member { role: Role; label: string; model: string; vendor: string; seat: number; chair?: boolean }
export interface Vote { vote: string; confidence: number | null }

export const PLACE: Record<string, Place> = {
  chair: 'bench', skeptic: 'pros', optimist: 'def', deterministic: 'witness', security: 'witness',
};
export const placeOf = (role: Role): Place => PLACE[role] ?? 'jury';
/** Which CLI a model id runs on (`codex:gpt-6-luna` → codex; Claude aliases → claude). Mirrors app/adapters/index.mjs. */
export const resolveVendor = (model: string) => (model.includes(':') ? model.split(':')[0] : ['codex', 'qwen', 'cursor', 'opencode', 'kimi'].includes(model) ? model : 'claude');

/** The members who argue (everyone but the chair). */
export const benchOf = (members: Member[]) => members.filter((m) => !m.chair && m.role !== 'chair');

// One low-chroma accent per role; only the current speaker shows it.
export const ACCENT: Record<string, string> = {
  chair: 'oklch(0.62 0.06 85)',
  optimist: 'oklch(0.66 0.11 150)',
  skeptic: 'oklch(0.62 0.13 30)',
  deterministic: 'oklch(0.62 0.09 255)',
  'user-advocate': 'oklch(0.72 0.11 80)',
  'cost-ops': 'oklch(0.64 0.08 200)',
  security: 'oklch(0.6 0.1 315)',
};
// A member role the user wrote gets a steady colour of its own, picked from its key.
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// The colour comes from the name part of the key (not its random suffix), so the form can preview it.
export const accentOf = (role: Role) => ACCENT[role] ?? (role.startsWith('custom-') ? `oklch(0.66 0.09 ${hueOf(role.replace(/-[a-z0-9]{4}$/, ''))})` : 'oklch(0.6 0.02 260)');

export const VOTE_TINT: Record<string, string> = {
  go: 'oklch(0.7 0.12 150)', 'no-go': 'oklch(0.6 0.16 28)', conditional: 'oklch(0.78 0.11 80)',
};

export interface Frame {
  title: string;
  members: Member[];
  speaker: Role | null;
  turn: { n: number; stance: Stance | null; body: string; replyTo: string | null; target: Role | null } | null;
  ruling: string;
  link: { from: Role; to: Role; kind: 'objection' | 'question' | 'reply' } | null;
  votes: Record<Role, Vote>;
  verdict: { verdict: string; confidence: number; reason: string } | null;
  /** House lights up without a verdict, e.g. while previewing a new case. */
  lit?: boolean;
  /** Members writing out of turn (blind openings, closings): each gets a desk lamp. */
  writing?: Role[];
}
