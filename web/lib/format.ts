// Numbers as the UI shows them.
/** 75 seconds → "1:15". */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** 12_400 → "12k", 1_500_000 → "1.5M". */
export const formatTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : '—');
