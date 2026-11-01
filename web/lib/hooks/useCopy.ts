'use client';
// Copy text to the clipboard and say so for a moment. `copied` is the text last copied.
import { useCallback, useState } from 'react';

export function useCopy() {
  const [copied, setCopied] = useState('');
  const copy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? '' : c)), 1500);
  }, []);
  return { copied, copy };
}
