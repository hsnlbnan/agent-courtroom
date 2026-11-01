'use client';
// Member roles the person wrote, kept in this browser for their next cases.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRIEF_MAX, keyFor, LABEL_MAX } from '../draft';
import type { CustomRole } from '../types';

const KEY = 'council-custom-roles';
const load = (): CustomRole[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const save = (list: CustomRole[]) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
const clean = (label: string, brief: string) => ({ label: label.trim().replace(/\s+/g, ' ').slice(0, LABEL_MAX), brief: brief.trim().slice(0, BRIEF_MAX) });

export function useCustomRoles() {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  // The list as last set, so changes build on it even when the browser blocks storage.
  const current = useRef<CustomRole[]>([]);
  // The next list is computed once, outside any state updater, then saved and set.
  const commit = useCallback((next: CustomRole[]) => { current.current = next; save(next); setRoles(next); }, []);
  useEffect(() => { const saved = load(); current.current = saved; setRoles(saved); }, []);
  const add = useCallback((label: string, brief: string): CustomRole => {
    const role = { key: keyFor(label), ...clean(label, brief) };
    commit([...current.current, role]);
    return role;
  }, [commit]);
  const update = useCallback((key: string, label: string, brief: string) => {
    commit(current.current.map((r) => (r.key === key ? { ...r, ...clean(label, brief) } : r)));
  }, [commit]);
  const remove = useCallback((key: string) => commit(current.current.filter((r) => r.key !== key)), [commit]);
  return { roles, add, update, remove };
}
