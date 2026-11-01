'use client';
// Opening a case happens in the room: this panel takes the rail's place while the stage previews
// the chosen members in their seats. It assembles the form; the draft lives in the page (it also
// drives the preview), custom members in useCustomRoles.
import { useEffect, useRef, useState } from 'react';
import { type Draft, IDEA_MAX, inputKind, modelOf, modeOf } from '@/lib/draft';
import { estimate } from '@/lib/estimate';
import type { useCustomRoles } from '@/lib/hooks/useCustomRoles';
import { useT } from '@/lib/i18n';
import type { CustomRole, Listing, Provider, RoleInfo, Suggestion } from '@/lib/types';
import ConnectDialog, { type ConnectCalls } from './ConnectDialog';
import MemberChips from './MemberChips';
import MemberForm from './MemberForm';
import TargetField from './TargetField';

export default function Composer({ draft, onDraft, roles, custom, providers, suggest, browse, connect, onProvidersChanged, onStart, onClose }: {
  draft: Draft; onDraft: (patch: Partial<Draft>) => void;
  roles: RoleInfo[]; custom: ReturnType<typeof useCustomRoles>; providers: Provider[];
  suggest: (path: string, mode: string) => Promise<Suggestion[]>;
  browse: (path: string) => Promise<Listing | null>;
  connect: ConnectCalls; onProvidersChanged: () => void;
  onStart: () => Promise<void>;
  onClose?: () => void;
}) {
  const { t } = useT();
  const targetRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState<{ editing: CustomRole | null } | null>(null); // the member form, when open
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { targetRef.current?.focus(); }, []);

  const mode = modeOf(draft);
  const kind = inputKind(draft.target, draft.asText);
  const model = (role: string) => modelOf(draft, roles, role);
  const chosen = draft.members;
  const est = estimate(chosen.map(model), draft.maxTurns);
  const toggle = (role: string) => onDraft({ members: chosen.includes(role) ? chosen.filter((x) => x !== role) : [...chosen, role] });

  const saveMember = (label: string, brief: string) => {
    if (form?.editing) custom.update(form.editing.key, label, brief);
    else onDraft({ members: [...chosen, custom.add(label, brief).key] });
    setForm(null);
  };
  const removeMember = (key: string) => {
    custom.remove(key);
    onDraft({ members: chosen.filter((m) => m !== key) });
    setForm(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === 'empty') { setError(t.needInput); targetRef.current?.focus(); return; }
    if (kind === 'text' && draft.target.trim().length > IDEA_MAX) { setError(t.errors.idea_too_long); targetRef.current?.focus(); return; }
    if (chosen.length < 2) { setError(t.minMembers); return; }
    setBusy(true);
    setError('');
    try { await onStart(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); targetRef.current?.focus(); } finally { setBusy(false); }
  };

  return (
    // Escape closes the panel; the fields and popovers inside stop it first when it is theirs.
    <aside className="composer" aria-labelledby="composer-title" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } }}>
      <form onSubmit={submit} noValidate>
        <h2 id="composer-title">{t.newCase}</h2>
        <ConnectDialog provider={connecting} calls={connect} onClose={(changed) => { setConnecting(null); if (changed) onProvidersChanged(); }} />

        <TargetField value={draft.target} asText={draft.asText} onChange={onDraft} suggest={suggest} browse={browse} inputRef={targetRef} />

        <fieldset className="members">
          <legend className="label">{t.council}</legend>
          <MemberChips roles={roles} custom={custom.roles} chosen={chosen} modelOf={model} chairModel={draft.chairModel} providers={providers} mode={mode}
            onToggle={toggle} onModel={(role, m) => onDraft({ models: { ...draft.models, [role]: m } })} onChairModel={(m) => onDraft({ chairModel: m })}
            onEdit={(r) => setForm({ editing: r })} onConnect={setConnecting} />
          {form
            ? <MemberForm key={form.editing?.key ?? 'new'} editing={form.editing} onSave={saveMember} onRemove={removeMember} onCancel={() => setForm(null)} />
            : <button type="button" className="link add-member" onClick={() => setForm({ editing: null })}>{t.customAdd}</button>}
        </fieldset>

        {mode === 'code' && chosen.some((role) => model(role).startsWith('codex')) && <p className="warn" role="alert">{t.codexWarn}</p>}

        <div className="field">
          <label className="label" htmlFor="focus">{t.questionOpt}</label>
          <textarea id="focus" rows={2} value={draft.focus} maxLength={300} placeholder={t.questionPh} onChange={(e) => onDraft({ focus: e.target.value })} />
        </div>

        <div className="field turns">
          <label className="label" htmlFor="turns">{t.turns}</label>
          <input id="turns" type="range" min={2} max={18} value={draft.maxTurns} onChange={(e) => onDraft({ maxTurns: Number(e.target.value) })} />
          <output htmlFor="turns">{draft.maxTurns} <span className="dur">{t.minutes(Math.max(1, Math.round(est.seconds / 60)))}</span></output>
        </div>

        <p className="error" role="alert">{error}</p>
        <div className="actions">
          {onClose && <button type="button" className="ctl" onClick={onClose}>{t.cancel}</button>}
          <button type="submit" className="ctl primary" disabled={busy}>{busy ? t.opening : t.openHearing}</button>
        </div>
      </form>
    </aside>
  );
}
