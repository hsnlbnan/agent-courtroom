'use client';
// A popover's way out: a click outside `root`, Escape, and (optionally) scrolling or resizing
// close it. Escape stays inside the popover, and focus goes back to the trigger.
import { type RefObject, useEffect } from 'react';

export function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void,
  { trigger, onScroll = false }: { trigger?: RefObject<HTMLElement | null>; onScroll?: boolean } = {}) {
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      trigger?.current?.focus();
    };
    const away = () => close();
    addEventListener('mousedown', outside);
    addEventListener('keydown', esc, true);
    if (onScroll) { addEventListener('resize', away); addEventListener('scroll', away, true); }
    return () => {
      removeEventListener('mousedown', outside);
      removeEventListener('keydown', esc, true);
      removeEventListener('resize', away);
      removeEventListener('scroll', away, true);
    };
  }, [open, root, close, trigger, onScroll]);
}
