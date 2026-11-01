'use client';
// Seconds since something began, ticking once a second while `on`. `key` restarts the count;
// `from` (epoch ms) says when it really began, so a reload does not reset it.
import { useEffect, useState } from 'react';

export function useElapsed(on: boolean, key: string, from: number | null = null) {
  const [since, setSince] = useState(() => from ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger; `from` is read when it changes
  useEffect(() => { setSince(from ?? Date.now()); setNow(Date.now()); }, [key, on]);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return Math.max(0, Math.round((now - since) / 1000));
}
