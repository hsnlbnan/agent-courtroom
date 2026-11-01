'use client';
// Light or dark: the system setting until the person picks one, then their choice (kept per
// browser). public/theme.js applies a saved choice before first paint; this hook keeps the
// header button and the 3D scene in step with it.
import { useCallback, useEffect, useState } from 'react';

const KEY = 'council-theme';
const EVENT = 'council-theme';
const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
const current = () => {
  const t = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  return t === 'dark' ? true : t === 'light' ? false : systemDark();
};

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(current());
    sync();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    addEventListener(EVENT, sync);
    return () => { mq.removeEventListener('change', sync); removeEventListener(EVENT, sync); };
  }, []);
  const toggle = useCallback(() => {
    const next = current() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch {}
    dispatchEvent(new Event(EVENT));
  }, []);
  return { dark, toggle };
}
