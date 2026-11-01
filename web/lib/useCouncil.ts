'use client';
// The app's connection to the local server: which case is open, its hearing state (folded from
// the event stream), the catalog for the new-case form, and the actions the screens can take.
// Fetching lives in api.ts, the stream in hooks/useEventStream.ts, the state in hearing.ts.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { type Api, createApi, errorText } from './api';
import { hearingReducer, initialHearing } from './hearing';
import { useEventStream } from './hooks/useEventStream';
import { useToken } from './hooks/useToken';
import { useT } from './i18n';
import { toFrame } from './selectors';
import type { CaseInfo, Provider, RoleInfo, StartRequest } from './types';

export function useCouncil() {
  const { t, lang } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const { token, checked } = useToken();
  const api: Api | null = useMemo(() => (token ? createApi(token, (code) => tRef.current.errors[code]) : null), [token]);
  const [cases, setCases] = useState<CaseInfo[]>([]);
  const [current, setCurrent] = useState<CaseInfo | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [hearing, dispatch] = useReducer(hearingReducer, initialHearing);
  const currentId = useRef<string | null>(null);
  currentId.current = current?.id ?? null;

  const refresh = useCallback(async (select?: string) => {
    if (!api) return;
    try {
      const list = await api.cases();
      setCases(list);
      const want = select ?? new URLSearchParams(location.search).get('case');
      // No case asked for and nothing live: start empty, so the app opens on "new case".
      setCurrent((c) => list.find((x) => x.id === want) ?? (c && list.find((x) => x.id === c.id)) ?? list.find((x) => x.live) ?? null);
      setError('');
    } catch (e) { setError(tRef.current.loadFailed(errorText(e))); }
    setLoaded(true);
  }, [api]);
  useEffect(() => { if (checked && !token) setLoaded(true); }, [checked, token]);
  useEffect(() => { void refresh(); }, [refresh]);

  const onStreamError = useCallback(() => setError(tRef.current.streamLost), []);
  const playback = useEventStream({ api, current, dispatch, onError: onStreamError });

  // A live case that ends is no longer live: refresh the list so its status and controls follow.
  useEffect(() => {
    if (hearing.ended && current?.live) void refresh(current.id);
  }, [hearing.ended, current?.live, current?.id, refresh]);

  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const reloadProviders = useCallback(() => {
    api?.providers().then(setProviders).catch((e) => setError(tRef.current.loadFailed(errorText(e))));
  }, [api]);
  useEffect(() => {
    if (!api) return;
    api.roles().then((r) => setRoles(r.roles)).catch((e) => setError(tRef.current.loadFailed(errorText(e))));
    reloadProviders();
  }, [api, reloadProviders]);

  const start = useCallback(async (body: StartRequest) => {
    if (!api) return;
    const { id } = await api.start({ ...body, lang });
    await refresh(id);
  }, [api, lang, refresh]);
  const stop = useCallback(() => {
    if (api && current) api.stop(current.id).catch((e) => setError(errorText(e)));
  }, [api, current]);
  const sendNote = useCallback(async (text: string) => {
    if (api && current) await api.note(current.id, text);
  }, [api, current]);
  const exportCase = useCallback(async (format: 'md' | 'json') => {
    if (!api || !current) return;
    try {
      const { name, blob } = await api.exportFile(current.id, format, lang);
      const href = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) { setError(tRef.current.exportFailed(errorText(e))); }
  }, [api, current, lang]);
  // "What next": an analysis lands on this case (unless another case was opened meanwhile); an appeal opens a new one.
  const followup = useCallback(async (name: 'ideas' | 'risks') => {
    if (!api || !current) return;
    const id = current.id;
    const settle = (f: Parameters<typeof dispatch>[0]) => { if (currentId.current === id) dispatch(f); };
    settle({ kind: 'followup', name, followup: { status: 'running' } });
    try {
      const r = await api.analyse(id, name, lang);
      settle({ kind: 'followup', name, followup: { status: 'done', markdown: r.markdown, citations: r.citations } });
    } catch (e) { settle({ kind: 'followup', name, followup: { status: 'failed', message: errorText(e) } }); }
  }, [api, current, lang]);
  const appeal = useCallback(async () => {
    if (!api || !current) return;
    const { id } = await api.appeal(current.id, lang);
    await refresh(id);
  }, [api, current, lang, refresh]);

  const frame = useMemo(() => toFrame(hearing, t), [hearing, t]);
  const isLive = !!current?.live && !hearing.ended;
  return {
    api, hasToken: !!token, loaded, error, cases, current, select: setCurrent,
    hearing, frame, isLive, playback, roles, providers, reloadProviders,
    actions: { start, stop, sendNote, exportCase, followup, appeal },
  };
}

export type Council = ReturnType<typeof useCouncil>;
