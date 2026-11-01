'use client';
// The one page: the stage (3D room and the line under it) on the left; the record, the new-case
// form or the onboarding panel on the right; the verdict as a screen of its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Activity from '@/components/Activity';
import Composer from '@/components/Composer';
import Onboarding from '@/components/Onboarding';
import Rail from '@/components/Rail';
import Stage from '@/components/Stage';
import TopBar from '@/components/TopBar';
import VerdictView from '@/components/VerdictView';
import type { Frame } from '@/lib/council';
import { type Draft, emptyDraft, toStartRequest } from '@/lib/draft';
import { useCustomRoles } from '@/lib/hooks/useCustomRoles';
import { useT } from '@/lib/i18n';
import { previewAside, previewFrame, statementAside } from '@/lib/preview';
import { useHearingSounds, useSoundSetting } from '@/lib/sound';
import { useTheme } from '@/lib/theme';
import { isTurn } from '@/lib/types';
import { useCouncil } from '@/lib/useCouncil';

/** Whether a key press came from somewhere that types text. */
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));

export default function Page() {
  const c = useCouncil();
  const { t } = useT();
  const { hearing } = c;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const onDraft = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const custom = useCustomRoles();
  const [verdictOpen, setVerdictOpen] = useState(false);
  const sound = useSoundSetting();
  const theme = useTheme();

  // Default members once the roles arrive.
  useEffect(() => {
    if (!c.roles.length) return;
    setDraft((d) => (d.members.length ? d : { ...d, members: c.roles.filter((r) => r.default).map((r) => r.role) }));
  }, [c.roles]);

  // Sounds follow the hearing; instant replays arrive all at once, so they stay quiet.
  const lastTurn = hearing.entries.filter(isTurn).at(-1);
  const watch = useMemo(() => ({
    live: hearing.live ? { n: hearing.live.n } : null, speaker: hearing.speaker, lastStance: lastTurn?.stance ?? null,
    lastN: lastTurn?.n ?? 0, verdict: hearing.chair?.verdict ?? null, entries: hearing.entries.length,
  }), [hearing.live, hearing.speaker, lastTurn, hearing.chair, hearing.entries.length]);
  useHearingSounds(sound.on, watch, !c.isLive && c.playback.speed === 0);

  // A live hearing that reaches its verdict opens the verdict screen once; another case closes it.
  const wasLive = useRef(false);
  useEffect(() => {
    if (c.isLive) wasLive.current = true;
    if (wasLive.current && hearing.phase === 'verdict' && hearing.chair) { wasLive.current = false; setVerdictOpen(true); }
  }, [c.isLive, hearing.phase, hearing.chair]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the case id is the trigger
  useEffect(() => { setVerdictOpen(false); wasLive.current = false; }, [c.current?.id]);
  // Nothing selected (and nothing live): open straight into a new case.
  useEffect(() => { if (c.loaded && c.hasToken && !c.current) setComposing(true); }, [c.loaded, c.hasToken, c.current]);

  // Escape stops a live hearing, but only from the page itself: never while typing, composing or in a dialog.
  const { stop } = c.actions;
  const stoppable = c.isLive && !composing;
  useEffect(() => {
    if (!stoppable) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !typing(e) && !document.querySelector('dialog[open]')) stop(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [stoppable, stop]);

  // Stable, so the form's debounced lookups do not restart on every render.
  const { api } = c;
  const suggest = useCallback((path: string, mode: string) => api?.suggest(path, mode).catch(() => []) ?? Promise.resolve([]), [api]);
  const browse = useCallback((path: string) => api?.browse(path).catch(() => null) ?? Promise.resolve(null), [api]);

  // Before the case list arrives, say so instead of showing an empty room.
  const frame: Frame = c.hasToken && !c.loaded ? { ...c.frame, ruling: t.loadingCases }
    : composing ? previewFrame(draft, t, c.roles, custom.roles) : c.frame;
  const aside = composing ? previewAside(draft, t) : statementAside(hearing, t);
  const openVerdict = () => setVerdictOpen(true);

  const panel = !c.hasToken && c.loaded ? <Onboarding />
    : composing && c.api ? (
      <Composer draft={draft} onDraft={onDraft} roles={c.roles} custom={custom} providers={c.providers}
        suggest={suggest} browse={browse}
        connect={c.api.connect} onProvidersChanged={c.reloadProviders}
        onClose={c.current ? () => setComposing(false) : undefined}
        onStart={async () => { await c.actions.start(toStartRequest(draft, c.roles, custom.roles)); setComposing(false); }} />
    ) : (
      <Rail entries={hearing.entries} members={hearing.members} chair={hearing.chair} votes={hearing.votes} follow={c.isLive}
        onExport={c.actions.exportCase} onOpenVerdict={openVerdict} onNote={c.isLive ? c.actions.sendNote : undefined} />
    );

  return (
    <main className="shell">
      <Stage frame={frame} aside={aside}
        top={<TopBar hasToken={c.hasToken} cases={c.cases} current={c.current} composing={composing} hearing={hearing} isLive={c.isLive}
          playback={c.playback} sound={sound} theme={theme} onPick={(x) => { setComposing(false); c.select(x); }}
          onNew={() => setComposing(true)} onStop={stop} onOpenVerdict={openVerdict} />}
        extra={!composing && c.current ? <Activity hearing={hearing} isLive={c.isLive} onNewCase={() => setComposing(true)} onExport={c.actions.exportCase} /> : null}
        onOpenVerdict={hearing.chair && !composing ? openVerdict : undefined} />
      <VerdictView hearing={hearing} open={verdictOpen} onClose={() => setVerdictOpen(false)} onFollowup={c.actions.followup} onAppeal={c.actions.appeal} />
      {panel}
      {c.error && <p className="error-banner" role="alert">{c.error}</p>}
    </main>
  );
}
