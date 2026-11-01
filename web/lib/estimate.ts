// Rough cost/time for a case, calibrated on today's measured runs
// (3 sonnet members + opus chair, 4 turns: $0.69–0.86, 145–174 s). An estimate, not a quote.
const COST = { sonnet: { statement: 0.05, turn: 0.04 }, opus: { statement: 0.15, turn: 0.12 } } as const;
const tier = (model: string) => (/opus|fable/.test(model) ? 'opus' : 'sonnet');

export function estimate(models: string[], turns: number) {
  if (!models.length) return { usd: 0, seconds: 0 };
  const statements = models.reduce((s, m) => s + COST[tier(m)].statement, 0) * 2; // openings + closings
  const perTurn = models.reduce((s, m) => s + COST[tier(m)].turn, 0) / models.length + 0.015; // + chair pick
  const usd = statements + perTurn * turns + 0.2; // + verdict
  const anyOpus = models.some((m) => tier(m) === 'opus');
  const seconds = (anyOpus ? 60 : 35) + turns * (anyOpus ? 28 : 22) + (anyOpus ? 35 : 20) + 30;
  return { usd, seconds };
}
