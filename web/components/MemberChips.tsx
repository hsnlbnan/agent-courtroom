'use client';
// The council for a new case: one chip per member (built-in or written by the person), each with
// its model menu, and the judge, who always runs on Claude.
import { accentOf } from '@/lib/council';
import { roleName, useT } from '@/lib/i18n';
import type { CustomRole, Provider, RoleInfo } from '@/lib/types';
import ModelPicker from './ModelPicker';

interface Seat { key: string; label: string; title: string; custom?: CustomRole }

export default function MemberChips({ roles, custom, chosen, modelOf, chairModel, providers, mode, onToggle, onModel, onChairModel, onEdit, onConnect }: {
  roles: RoleInfo[]; custom: CustomRole[]; chosen: string[]; modelOf: (role: string) => string; chairModel: string;
  providers: Provider[]; mode: 'code' | 'idea';
  onToggle: (role: string) => void; onModel: (role: string, model: string) => void; onChairModel: (model: string) => void;
  onEdit: (role: CustomRole) => void; onConnect: (p: Provider) => void;
}) {
  const { t } = useT();
  const seats: Seat[] = [
    ...roles.map((r) => ({ key: r.role, label: roleName(t, r.role, r.label), title: t.lens[r.role] ?? r.lens })),
    ...custom.map((r) => ({ key: r.key, label: r.label, title: r.brief, custom: r })),
  ];
  return (
    <div className="chips">
      {seats.map((s) => {
        const on = chosen.includes(s.key);
        return (
          <div key={s.key} className={`chip${s.custom ? ' custom' : ''}${on ? ' on' : ''}`} style={{ ['--accent' as string]: accentOf(s.key) }} title={s.title}>
            <label>
              <input type="checkbox" checked={on} onChange={() => onToggle(s.key)} />
              <span className="dot" aria-hidden="true" />{s.label}
            </label>
            <ModelPicker value={modelOf(s.key)} providers={providers} label={t.modelOf(s.label)} mode={mode} onConnect={onConnect}
              onChange={(m) => onModel(s.key, m)} />
            {s.custom && (
              <button type="button" className="edit" aria-label={t.customEdit(s.label)} title={t.customEdit(s.label)} onClick={() => s.custom && onEdit(s.custom)}>
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z" /></svg>
              </button>
            )}
          </div>
        );
      })}
      <div className="chip fixed" style={{ ['--accent' as string]: accentOf('chair') }}>
        <span className="dot" aria-hidden="true" />{t.judge}
        <ModelPicker value={chairModel} providers={providers} label={t.judgeModel} mode={mode} claudeOnly onChange={onChairModel} />
      </div>
    </div>
  );
}
