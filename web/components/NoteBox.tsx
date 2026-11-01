'use client';
// A note from the person running a live hearing: the next turn answers it.
import { useId, useState } from 'react';
import { useT } from '@/lib/i18n';

export default function NoteBox({ onNote }: { onNote: (text: string) => Promise<void> }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setError(t.errors.note_empty); return; }
    setBusy(true);
    setError('');
    try { await onNote(text.trim()); setText(''); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="notebox" onSubmit={submit} noValidate>
      <label className="label" htmlFor={`${id}-note`}>{t.noteLabel}</label>
      <textarea id={`${id}-note`} rows={2} maxLength={500} value={text} placeholder={t.notePh} aria-describedby={`${id}-hint`}
        aria-invalid={error ? true : undefined} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }} />
      <p id={`${id}-hint`} className="hint">{t.noteHint}</p>
      <p className="error" role="alert">{error}</p>
      <button type="submit" className="ctl primary" disabled={busy}>{busy ? t.noteSending : t.noteSend}</button>
    </form>
  );
}
