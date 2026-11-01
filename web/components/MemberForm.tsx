'use client';
// Write a member of your own, or edit one: a name, what it looks at and how it argues (with three
// starters), and a live preview of its chip. Escape closes only this form.
import { useEffect, useRef, useState } from 'react';
import { accentOf } from '@/lib/council';
import { BRIEF_MAX, LABEL_MAX, slugOf } from '@/lib/draft';
import { useT } from '@/lib/i18n';
import type { CustomRole } from '@/lib/types';

const BRIEF_MIN = 10;

export default function MemberForm({ editing, onSave, onRemove, onCancel }: {
  editing: CustomRole | null;
  onSave: (label: string, brief: string) => void;
  onRemove: (key: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [label, setLabel] = useState(editing?.label ?? '');
  const [brief, setBrief] = useState(editing?.brief ?? '');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  // Opening the form moves focus to its first field (the person asked for it).
  useEffect(() => { nameRef.current?.focus(); }, []);

  const save = () => {
    if (!label.trim()) { setError(t.customNeedName); nameRef.current?.focus(); return; }
    if (brief.trim().length < BRIEF_MIN) { setError(t.customNeedBrief); return; }
    onSave(label, brief);
  };

  return (
    <section className="member-form" aria-labelledby="member-form-title"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <div className="mf-head">
        <h3 id="member-form-title">{editing ? t.customEditTitle : t.customNewTitle}</h3>
        <span className={`chip preview${label.trim() ? ' on' : ''}`} style={{ ['--accent' as string]: accentOf(`custom-${slugOf(label)}`) }} aria-hidden="true">
          <span className="dot" />{label.trim() || t.customNamePreview}
        </span>
      </div>
      {!editing && (
        <p className="starters">
          <span>{t.customStart}</span>
          {t.customTemplates.map((tpl) => (
            <button key={tpl.label} type="button" className="link" onClick={() => { setLabel(tpl.label); setBrief(tpl.brief); setError(''); }}>{tpl.label}</button>
          ))}
        </p>
      )}
      <label className="sub" htmlFor="new-member-name">{t.customName}</label>
      <input id="new-member-name" type="text" value={label} maxLength={LABEL_MAX} placeholder={t.customNamePh} ref={nameRef}
        onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
      <div className="label-row">
        <label className="sub" htmlFor="new-member-brief">{t.customBrief}</label>
        <span className="count">{t.chars(brief.trim().length, BRIEF_MAX)}</span>
      </div>
      <textarea id="new-member-brief" rows={5} value={brief} maxLength={BRIEF_MAX} placeholder={t.customBriefPh}
        aria-describedby="new-member-hint" onChange={(e) => setBrief(e.target.value)} />
      <p className="hint" id="new-member-hint">{t.customHint}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        {editing && <button type="button" className="link danger" onClick={() => onRemove(editing.key)}>{t.customRemoveThis}</button>}
        <button type="button" className="ctl" onClick={onCancel}>{t.cancel}</button>
        <button type="button" className="ctl primary" onClick={save}>{editing ? t.customUpdate : t.customSave}</button>
      </div>
    </section>
  );
}
