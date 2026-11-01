'use client';
// The record: same data as the stage, readable and accessible. The statements, the verdict and the
// note box are their own components; this one lays them out and follows a live case.
import { useEffect, useRef } from 'react';
import type { Member, Vote } from '@/lib/council';
import { useT } from '@/lib/i18n';
import type { Chair, Entry } from '@/lib/types';
import NoteBox from './NoteBox';
import Transcript from './Transcript';
import VerdictSummary from './VerdictSummary';

export default function Rail({ entries, members, chair, votes, follow, onExport, onNote, onOpenVerdict }: {
  entries: Entry[]; members: Member[]; chair: Chair | null; votes: Record<string, Vote>; follow: boolean;
  onExport?: (format: 'md' | 'json') => void;
  /** Present while the hearing is live. */
  onNote?: (text: string) => Promise<void>;
  onOpenVerdict?: () => void;
}) {
  const { t } = useT();
  const root = useRef<HTMLElement>(null);
  // Follow live cases inside the rail only; never scroll the page under the reader.
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries.length and chair are the triggers: scroll when the record grows.
  useEffect(() => {
    const el = root.current;
    if (follow && el && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
  }, [entries.length, chair, follow]);
  return (
    <aside className="rail" aria-labelledby="rail-title" ref={root}>
      <h2 id="rail-title">{t.transcript}</h2>
      {entries.length === 0 && !chair && <p className="empty">{t.emptyRail}</p>}
      <Transcript entries={entries} members={members} />

      {chair && <VerdictSummary chair={chair} members={members} votes={votes} onOpenVerdict={onOpenVerdict} />}

      {onNote && <NoteBox onNote={onNote} />}

      {onExport && entries.length > 0 && (
        <p className="export">
          <span>{t.exportCase}</span>
          <button type="button" className="ctl" onClick={() => onExport('md')}>{t.exportMd}</button>
          <button type="button" className="ctl" onClick={() => onExport('json')}>{t.exportJson}</button>
        </p>
      )}
    </aside>
  );
}
