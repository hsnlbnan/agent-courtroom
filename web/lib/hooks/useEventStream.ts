'use client';
// One case's event stream into the hearing reducer: replayed at a speed (0 = instant) or live,
// each event applied once, optionally paused at `?upto=<turn>` and resumed later.
import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../api';
import type { CouncilEvent } from '../events';
import type { HearingAction } from '../hearing';
import type { CaseInfo } from '../types';

export function useEventStream({ api, current, dispatch, onError }: {
  api: Api | null; current: CaseInfo | null; dispatch: Dispatch<HearingAction>; onError: (message: string) => void;
}) {
  const [speed, setSpeed] = useState(6);
  const [paused, setPaused] = useState(false);
  const source = useRef<EventSource | null>(null);
  const held = useRef<CouncilEvent[]>([]);
  const pausedRef = useRef(false);

  const open = useCallback((c: CaseInfo, sp: number, live: boolean) => {
    if (!api) return;
    source.current?.close();
    dispatch({ kind: 'reset' });
    held.current = [];
    pausedRef.current = false;
    setPaused(false);
    const upto = live ? 0 : Number(new URLSearchParams(location.search).get('upto')) || 0;
    const src = new EventSource(api.streamUrl(c.id, live ? 0 : sp));
    let lastSeq = 0;
    src.addEventListener('council', (msg) => {
      let ev: CouncilEvent;
      try { ev = JSON.parse((msg as MessageEvent).data); } catch { return; }
      if (ev.seq <= lastSeq) return;
      lastSeq = ev.seq;
      if (pausedRef.current) { held.current.push(ev); return; }
      dispatch({ kind: 'event', ev });
      if (upto && ev.type === 'turn.completed' && ev.data.n === upto) { pausedRef.current = true; setPaused(true); }
    });
    src.addEventListener('replay-end', () => src.close());
    // EventSource retries on its own; say so only when it has given up.
    src.onerror = () => { if (src.readyState === EventSource.CLOSED) onError('stream'); };
    source.current = src;
  }, [api, dispatch, onError]);

  // Reconnect when the case or the token changes; speed changes go through replay().
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the case id and the api (token), not on every case field
  useEffect(() => {
    if (current && api) open(current, speed, current.live);
    return () => source.current?.close();
  }, [current?.id, api]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    for (const ev of held.current.splice(0)) dispatch({ kind: 'event', ev });
  }, [dispatch]);

  /** Replay the current case at a speed; a finished case is never "live" here, whatever the list said. */
  const replay = useCallback((sp: number) => {
    setSpeed(sp);
    if (current) open(current, sp, false);
  }, [current, open]);

  return { speed, paused, resume, replay };
}
