// A new-case request, checked and turned into startCase options. What to judge is an idea typed
// in the form (`idea`, or free text in `target`) or a path: a folder means code mode, a .md/.txt
// file an idea from that file; `mode` may override. Error codes are part of the API (the UI
// translates them).
import { resolveModel } from '../adapters/index.mjs';
import { IDEA_MAX } from './context.mjs';
import { modelPolicy } from './providers.mjs';
import { customRoles, DEFAULT_MEMBERS, listRoles, MODELS } from './roles.mjs';
import { checkTarget, inferInput } from './targets.mjs';

const fail = (code, error) => ({ error, code });
export const langOf = (v) => (v === 'tr' ? 'tr' : 'en');

/** Inline idea text, or a checked path with its mode. */
function subjectOf(body, check) {
  const typed = typeof body.target === 'string' ? body.target.trim() : '';
  const idea = typeof body.idea === 'string' && body.idea.trim() ? body.idea.trim() : inferInput(typed).kind === 'text' ? typed : '';
  if (idea) {
    if (idea.length > IDEA_MAX) return fail('idea_too_long', `The idea is longer than ${IDEA_MAX} characters`);
    return { mode: 'idea', idea };
  }
  if (!typed) return fail('target_required', 'Target is required');
  const mode = body.mode === 'idea' || body.mode === 'code' ? body.mode : inferInput(typed).kind === 'file' ? 'idea' : 'code';
  const checked = check(typed, mode);
  return checked.error ? fail(checked.code, checked.error) : { mode, target: checked.path };
}

/**
 * Members and their models. Unknown roles are dropped; a model that is not a Claude alias or a
 * usable provider model falls back to the role's default; asking for a provider that cannot run
 * (or is not cleared for this mode) is an error, not a silent swap.
 */
function benchOf(body, mode, providers, roles) {
  const custom = customRoles(body.custom);
  const known = new Map([...roles.map((r) => [r.role, r.model]), ...Object.keys(custom).map((k) => [k, 'sonnet'])]);
  const members = Array.isArray(body.members) ? [...new Set(body.members.filter((r) => known.has(r)))] : DEFAULT_MEMBERS;
  if (members.length < 2) return fail('min_members', 'Pick at least two members');
  const policy = modelPolicy(providers);
  const asked = (r) => body.models?.[r];
  const isProviderModel = (m) => typeof m === 'string' && !MODELS.includes(m) && policy.known(m);
  if (members.some((r) => isProviderModel(asked(r)) && !policy.usable(asked(r)))) return fail('provider_unavailable', 'That provider is not available');
  if (members.some((r) => isProviderModel(asked(r)) && !policy.usable(asked(r), mode))) return fail('provider_unavailable', 'That provider is not cleared for this mode');
  const models = Object.fromEntries(members.map((r) => [r, MODELS.includes(asked(r)) || policy.usable(asked(r), mode) ? asked(r) : known.get(r)]));
  return { members, models, custom };
}

/**
 * `body` is the request; returns { error, code } or { options, idea } where `idea` is inline
 * idea text the caller must write to the case's idea.md and set as `options.target`.
 */
export function parseNewCase(body, { providers, roles = listRoles(), check = checkTarget }) {
  const subject = subjectOf(body, check);
  if (subject.error) return subject;
  const bench = benchOf(body, subject.mode, providers, roles);
  if (bench.error) return bench;
  // A provider may refuse a code-mode target it cannot read safely (Cursor and a repo's own .cursor config).
  const refusal = subject.mode === 'code' && bench.members.map((r) => resolveModel(bench.models[r]).adapter.refuses?.(subject.target)).find(Boolean);
  if (refusal) return fail(refusal, 'This folder has its own config for one of the chosen CLIs, so that CLI cannot read it');
  const maxTurns = Math.min(Math.max(Number(body.maxTurns) || 6, 2), 18);
  const focus = String(body.focus ?? '').trim().slice(0, 300);
  const title = subject.idea ? focus || subject.idea.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 80) : undefined;
  return {
    idea: subject.idea ?? null,
    options: {
      title, target: subject.target ?? null, mode: subject.mode, focus, maxTurns, minTurns: Math.min(4, maxTurns),
      ...bench, chairModel: MODELS.includes(body.chairModel) ? body.chairModel : 'opus', // the judge stays on Claude
      lang: langOf(body.lang), // the council writes in the UI's language
    },
  };
}
