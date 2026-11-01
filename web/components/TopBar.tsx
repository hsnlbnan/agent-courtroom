'use client';
// The header: case switcher, hearing status with stop or replay controls, and the app toggles
// (verdict, new case, sound, theme, language).
import { formatClock, formatTokens } from '@/lib/format';
import type { HearingState } from '@/lib/hearing';
import { type Lang, useT } from '@/lib/i18n';
import type { CaseInfo } from '@/lib/types';
import CaseMenu from './CaseMenu';

export interface Playback { speed: number; paused: boolean; resume: () => void; replay: (speed: number) => void }

function SpeedControl({ playback }: { playback: Playback }) {
  const { t } = useT();
  const speeds = [[2, '2×'], [6, '6×'], [20, '20×'], [0, t.instant]] as const;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a button group, not a form; fieldset would add form styling */}
      <div className="seg" role="group" aria-label={t.speed}>
        {speeds.map(([v, l]) => <button key={v} type="button" aria-pressed={playback.speed === v} onClick={() => playback.replay(v)}>{l}</button>)}
      </div>
      {playback.paused
        ? <button type="button" className="ctl primary" onClick={playback.resume}>{t.resume}</button>
        : <button type="button" className="ctl" onClick={() => playback.replay(playback.speed)} aria-label={t.replay}>↺</button>}
    </>
  );
}

const SoundIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8h3l4-3v10l-4-3H3z" />
    {on ? <><path d="M13 7.5a3.5 3.5 0 0 1 0 5" /><path d="M15.5 5.5a6.5 6.5 0 0 1 0 9" /></> : <path d="M13.5 8l4 4m0-4l-4 4" />}
  </svg>
);
const ThemeIcon = ({ dark }: { dark: boolean }) => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {dark
      ? <><circle cx="10" cy="10" r="3.5" /><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" /></>
      : <path d="M15.5 12.2A6.5 6.5 0 0 1 7.8 4.5a6.5 6.5 0 1 0 7.7 7.7z" />}
  </svg>
);

export default function TopBar({ hasToken, cases, current, composing, hearing, isLive, playback, sound, theme, onPick, onNew, onStop, onOpenVerdict }: {
  hasToken: boolean; cases: CaseInfo[]; current: CaseInfo | null; composing: boolean;
  hearing: HearingState; isLive: boolean; playback: Playback;
  sound: { on: boolean; toggle: () => void }; theme: { dark: boolean; toggle: () => void };
  onPick: (c: CaseInfo) => void; onNew: () => void; onStop: () => void; onOpenVerdict: () => void;
}) {
  const { t, lang, setLang } = useT();
  const showCase = !!current && !composing;
  const turnsDone = hearing.entries.filter((e) => e.kind === 'turn').length;
  return (
    <header className="top">
      <div className="mark">
        <span className="word">{t.wordmark}</span>
        {hasToken && <CaseMenu cases={cases} current={current} onPick={onPick} onNew={onNew} />}
      </div>
      <div className="bar">
        {showCase && (
          <span className={`status${isLive ? ' live' : ''}`}>
            {isLive && <span className="pulse" aria-hidden="true" />}
            {isLive ? `${t.live} · ` : ''}{t.turnStatus(turnsDone, hearing.maxTurns || '—')} · {formatClock(hearing.ts / 1000)}
            {hearing.tokens ? <span className="tok"> · {formatTokens(hearing.tokens)}</span> : ''}
          </span>
        )}
        {showCase && (isLive
          ? <button type="button" className="ctl stop" onClick={onStop} aria-keyshortcuts="Escape">{t.stop} <kbd>Esc</kbd></button>
          : <SpeedControl playback={playback} />)}
      </div>
      <div className="acts">
        {hearing.chair && !composing && <button type="button" className="ctl verdict-btn" onClick={onOpenVerdict}>{t.openVerdict}</button>}
        {hasToken && !composing && (
          <button type="button" className="ctl primary new" onClick={onNew} aria-label={t.newCase}>
            <span aria-hidden="true" className="plus">+</span><span className="lbl">{t.newCase}</span>
          </button>
        )}
        <button type="button" className={`ctl icon sound${sound.on ? ' on' : ''}`} aria-pressed={sound.on} onClick={sound.toggle}
          aria-label={sound.on ? t.soundOn : t.soundOff} title={sound.on ? t.soundOn : t.soundOff}><SoundIcon on={sound.on} /></button>
        <button type="button" className="ctl icon theme" onClick={theme.toggle}
          aria-label={theme.dark ? t.themeToLight : t.themeToDark} title={theme.dark ? t.themeToLight : t.themeToDark}><ThemeIcon dark={theme.dark} /></button>
        {/* biome-ignore lint/a11y/useSemanticElements: a button group, not a form; fieldset would add form styling */}
        <div className="seg lang" role="group" aria-label={t.language}>
          {(['en', 'tr'] as Lang[]).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} aria-label={l === 'en' ? 'English' : 'Türkçe'}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </header>
  );
}
