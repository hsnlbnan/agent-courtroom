// What the stage shows besides a hearing: the bench of a case being composed, and the latest
// opening or closing statement between turns.
import { resolveVendor } from './council';
import { type Draft, modelOf, modeOf } from './draft';
import type { HearingState } from './hearing';
import { type Dict, memberName, roleName, voteName } from './i18n';
import { statementGist } from './statement';
import type { Frame } from './council';
import { type CustomRole, isStatement, type RoleInfo } from './types';

export interface Aside { kicker: string; role: string; name: string; meta: string; body: string }

/** The chosen bench in an empty, lit room. */
export function previewFrame(d: Draft, t: Dict, roles: RoleInfo[], custom: CustomRole[]): Frame {
  const label = (role: string) => custom.find((r) => r.key === role)?.label ?? roleName(t, role, roles.find((r) => r.role === role)?.label);
  return {
    title: t.newCase, speaker: null, turn: null, link: null, votes: {}, verdict: null, lit: true,
    ruling: d.target.trim() ? t.targetIs(d.target.trim().split('\n')[0].slice(0, 80)) : t.noTarget,
    members: [
      ...d.members.map((role, seat) => { const model = modelOf(d, roles, role); return { role, label: label(role), model, vendor: resolveVendor(model), seat }; }),
      { role: 'chair', label: t.roles.chair, model: d.chairModel, vendor: 'claude', seat: 6, chair: true },
    ],
  };
}

export function previewAside(d: Draft, t: Dict): Aside {
  return { kicker: t.newCase, role: 'chair', name: modeOf(d) === 'code' ? t.modeCode : t.modeIdea, meta: t.benchMeta(d.members.length, d.maxTurns), body: d.focus || t.generalReview };
}

/** Between turns the stage shows the latest opening or closing statement. */
export function statementAside(s: HearingState, t: Dict): Aside | null {
  const last = s.entries.filter(isStatement).at(-1);
  if (!last) return null;
  return {
    kicker: last.kind === 'opening' ? t.blindOpening : t.closing,
    role: last.role,
    name: memberName(t, s.members, last.role),
    meta: last.vote ? `${voteName(t, last.vote.vote)} · ${Number(last.vote.confidence ?? 0).toFixed(2)}` : '',
    body: statementGist(last.body),
  };
}
