// The new-case form as data: what was typed, who sits on the council, and the request it becomes.
import type { CustomRole, RoleInfo, StartRequest } from './types';

export const IDEA_MAX = 12_000;
export const LABEL_MAX = 40;
export const BRIEF_MAX = 1500;

export interface Draft {
  /** What the user typed: a folder, an idea file, or the idea itself. */
  target: string;
  /** Use the input as idea text even if it looks like a path. */
  asText: boolean;
  focus: string; maxTurns: number; members: string[]; models: Record<string, string>; chairModel: string;
}
export const emptyDraft: Draft = { target: '', asText: false, focus: '', maxTurns: 6, members: [], models: {}, chairModel: 'opus' };

// Same rule as the server (app/lib/targets.mjs inferInput): a path-like single line is a folder
// or, ending in .md/.txt, an idea file; anything else is the idea itself.
export type InputKind = 'dir' | 'file' | 'text' | 'empty';
export function inputKind(raw: string, asText = false): InputKind {
  const s = raw.trim();
  if (!s) return 'empty';
  const pathLike = /^(~(\/|$)|\/|\.{1,2}\/)/.test(s) && !s.includes('\n');
  if (asText || !pathLike) return 'text';
  return /\.(md|txt)$/i.test(s) ? 'file' : 'dir';
}
/** The mode the input means: a folder is a codebase, anything else an idea. */
export const modeOf = (d: Draft): 'code' | 'idea' => (inputKind(d.target, d.asText) === 'dir' ? 'code' : 'idea');

/** The model a member runs on: the one picked, else the role's default, else sonnet. */
export const modelOf = (d: Draft, roles: RoleInfo[], role: string) => d.models[role] ?? roles.find((r) => r.role === role)?.model ?? 'sonnet';

/** A role key the server accepts: custom-<ascii slug>-<4 random>. The colour comes from the slug. */
export const slugOf = (label: string) => label.toLocaleLowerCase('tr').replace(/[ıİ]/g, 'i').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'member';
export const keyFor = (label: string) => `custom-${slugOf(label)}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;

/** The POST /api/cases body: every member with the model the form shows for it. */
export function toStartRequest(d: Draft, roles: RoleInfo[], custom: CustomRole[]): StartRequest {
  const kind = inputKind(d.target, d.asText);
  const where = kind === 'text' ? { idea: d.target.trim() } : { target: d.target.trim(), mode: kind === 'dir' ? 'code' as const : 'idea' as const };
  return {
    ...where, focus: d.focus, maxTurns: d.maxTurns, members: d.members, chairModel: d.chairModel,
    models: Object.fromEntries(d.members.map((m) => [m, modelOf(d, roles, m)])),
    custom: custom.filter((r) => d.members.includes(r.key)),
  };
}
