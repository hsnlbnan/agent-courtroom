'use client';
// Model menu attached to a member chip. Usable models are grouped by provider;
// providers that have not passed the security gate are listed, not selectable.
import { useCallback, useId, useRef, useState } from 'react';
import { useDismiss } from '@/lib/hooks/useDismiss';
import { useT } from '@/lib/i18n';
import type { Provider } from '@/lib/types';

/** How a model reads on its chip: `codex:gpt-6-luna` shows as `gpt-6-luna`. */
export const shortName = (m: string) => m.replace(/^[a-z]+:/, '');

export default function ModelPicker({ value, providers, label, onChange, mode, claudeOnly = false, onConnect }: {
  value: string; providers: Provider[]; label: string; onChange: (m: string) => void; mode: string; claudeOnly?: boolean;
  /** Opens the connect dialog for a provider that is not proven yet. */
  onConnect?: (p: Provider) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Fixed to the viewport, so a scrolling panel never clips it and it never leaves the screen.
  const [place, setPlace] = useState<React.CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  // A provider is selectable only in the modes it was cleared for; the judge stays on Claude.
  const fits = (p: Provider) => p.installed && p.status === 'enabled' && (p.modes ?? []).includes(mode) && !(claudeOnly && p.id !== 'claude');
  const usable = providers.filter(fits);
  const options = usable.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));
  const others = providers.filter((p) => !fits(p));
  // Green: connected on this machine, just not usable in this slot (the hint says why). Red: not set up yet.
  const ready = (p: Provider) => p.installed && p.status === 'enabled';
  const why = (p: Provider) => (ready(p) ? (claudeOnly && p.id !== 'claude' ? t.judgeClaude : t.ideaOnly) : '');
  const state = (p: Provider) => (ready(p) ? t.connectedState : p.installed ? t.notConnected : t.notInstalled);

  // Opening highlights the current model; closing on an outside click.
  const show = () => {
    const b = button.current?.getBoundingClientRect();
    if (b) {
      const w = Math.min(272, innerWidth - 16);
      const left = Math.min(Math.max(8, b.right - w), innerWidth - w - 8);
      const below = innerHeight - b.bottom - 14;
      const up = below < 240 && b.top > below;
      setPlace(up ? { left, width: w, bottom: innerHeight - b.top + 6, maxHeight: b.top - 14 } : { left, width: w, top: b.bottom + 6, maxHeight: below });
    }
    setActive(Math.max(0, options.findIndex((o) => o.model === value)));
    setOpen(true);
  };
  // The menu is pinned to where the button was; if the page scrolls or resizes, close it rather than drift.
  useDismiss(open, root, useCallback(() => setOpen(false), []), { trigger: button, onScroll: true });

  const choose = (m: string) => { onChange(m); setOpen(false); button.current?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) choose(options[active].model); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="picker" ref={root}>
      <button ref={button} type="button" role="combobox" className="picker-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${label}: ${value}`} aria-controls={open ? id : undefined}
        aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
        onKeyDown={onKeyDown}
        onClick={() => { if (open) setOpen(false); else show(); }}>
        {shortName(value)}<span className="caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="picker-pop" style={place}>
          {/* One listbox; each provider is a labelled group inside it. */}
          <div role="listbox" id={id} aria-label={label}>
          {usable.map((p) => (
            // biome-ignore lint/a11y/useSemanticElements: an option group inside an ARIA listbox, not a form fieldset
            <div key={p.id} className="group" role="group" aria-labelledby={`${id}-g-${p.id}`}>
              <p className="group-title" id={`${id}-g-${p.id}`}>{p.name}<span>{p.version}</span></p>
              <ul role="presentation">
                {p.models.map((m) => {
                  const i = options.findIndex((o) => o.provider.id === p.id && o.model === m);
                  return (
                    <li key={m} id={`${id}-${i}`} role="option" aria-selected={m === value}
                      className={`${i === active ? 'active' : ''}${m === value ? ' on' : ''}`}
                      onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(m); }}>
                      <span className="m">{p.modelInfo?.[m]?.name ?? m}</span><span className="h">{t.hints[m] ?? p.modelInfo?.[m]?.hint ?? ''}</span>
                      {m === value && <span className="check" aria-hidden="true">✓</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          </div>
          {others.length > 0 && (
            <div className="group others">
              <p className="group-title">{t.otherProviders}</p>
              <ul>
                {others.filter((p) => p.status !== 'blocked').map((p) => (
                  <li key={p.id}>
                    <span className={`st-dot ${ready(p) ? 'ok' : 'no'}`} role="img" aria-label={state(p)} title={state(p)} />
                    <span className="m">{p.name}</span>
                    {why(p) && <span className="h">{why(p)}</span>}
                    {p.setup && onConnect && !claudeOnly && (
                      <button type="button" className="connect" onMouseDown={(e) => { e.preventDefault(); setOpen(false); onConnect(p); }}>
                        {p.connected ? t.connectManage : t.connect}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
