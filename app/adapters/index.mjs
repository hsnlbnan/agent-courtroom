// The adapter registry: every CLI the council can run, described once. Adding a provider means
// writing its adapter (argv, parse, env, catalog fields) and listing it here; providers.mjs,
// connect.mjs, the orchestrator and the server all read from this list.
import { claude } from './claude.mjs';
import { codex } from './codex.mjs';
import { UNTESTED } from './untested.mjs';

export const ADAPTERS = [claude, codex, ...Object.values(UNTESTED)];
const byVendor = new Map(ADAPTERS.map((a) => [a.vendor, a]));

export const adapterOf = (vendor) => byVendor.get(vendor) ?? null;

/**
 * Which adapter runs a member model, and what model name that CLI is given.
 * `sonnet` → claude/`sonnet`; `codex` → codex/its default; `codex:gpt-6-luna` → codex/`gpt-6-luna`.
 */
export function resolveModel(model) {
  const [vendor, ...rest] = String(model ?? '').split(':');
  const adapter = byVendor.get(vendor);
  if (!adapter || adapter === claude) return { adapter: claude, cliModel: model };
  return { adapter, cliModel: rest.join(':') || undefined };
}

/** Providers whose adapter is written but has to pass the canary before it can be used. */
export const connectable = () => ADAPTERS.filter((a) => a.status === 'untested').map((a) => a.vendor);
