'use client';
// The run's token: from the start URL's hash (then removed from the address bar and kept for this
// tab), or from this tab's session. A link pasted into an open tab only changes the hash, so
// that is picked up too.
import { useEffect, useState } from 'react';

const KEY = 'council-token';

function readToken(): string {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
  try {
    if (fromHash) { sessionStorage.setItem(KEY, fromHash); history.replaceState(null, '', location.pathname + location.search); }
    return fromHash ?? sessionStorage.getItem(KEY) ?? '';
  } catch { return fromHash ?? ''; }
}

/** `checked` turns true once the token (or its absence) is known. */
export function useToken() {
  const [token, setToken] = useState('');
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const read = () => { setToken(readToken()); setChecked(true); };
    read();
    addEventListener('hashchange', read);
    return () => removeEventListener('hashchange', read);
  }, []);
  return { token, checked };
}
