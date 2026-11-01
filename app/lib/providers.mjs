// Which agent CLIs are on this machine and whether the council may use them, as the UI and the
// server see it. The CLIs themselves are described in adapters/ (index.mjs is the registry); this
// file adds what only the machine can tell: installed or not, version, the models a CLI lists for
// this account, and whether an untested provider passed the canary here (connect.mjs).
import { execFile } from 'node:child_process';
import { ADAPTERS } from '../adapters/index.mjs';
import { connections } from './connect.mjs';

const CACHE_MS = 300_000;
let cache = null;
let cachedAt = 0;
let inflight = null;

/** The version number a CLI prints, e.g. "2.1.4" from "2.1.4 (Claude Code)" or "codex-cli 0.159.0"; null if none. */
export const versionOf = (out) => String(out ?? '').match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/)?.[0] ?? null;

// `--version` off the event loop: some CLIs take seconds, and a synchronous check
// used to freeze the whole server (streams included).
const probe = (bin) => new Promise((ok) => {
  execFile(bin, ['--version'], { encoding: 'utf8', timeout: 8000 }, (err, stdout, stderr) => {
    ok(err ? { installed: false, version: null } : { installed: true, version: versionOf(stdout || stderr) });
  });
});

/** One provider as the API reports it. */
async function describe(adapter, connected, offline) {
  const { vendor: id, name, status, modes, models, note, setup } = adapter;
  const found = await probe(adapter.bin);
  let p = { id, name, status, modes, models, note, ...found };
  // A CLI may list more models for this account (Codex's catalog); its default stays first.
  const extra = found.installed && adapter.discoverModels && !offline ? await adapter.discoverModels() : [];
  if (extra.length) p = { ...p, models: [...models, ...extra.map((m) => m.id)], modelInfo: Object.fromEntries(extra.map((m) => [m.id, m])) };
  // A provider that passed the canary on this machine is usable in the modes it passed.
  if (status === 'untested' && connected[id]?.modes?.length) p = { ...p, status: 'enabled', connected: true, modes: connected[id].modes };
  // What a provider still needs: which variables are set (never their values) and how to sign in.
  if (setup) p = { ...p, setup: { ...setup, envSet: Object.fromEntries([...setup.env, ...setup.optional].map((k) => [k, !!process.env[k]])) } };
  return p;
}

/** Drop the cache, e.g. after a provider was connected or disconnected. */
export function refreshProviders() { cache = null; cachedAt = 0; }

/** Providers with install state. Cached for 5 minutes; a stale cache is served while it refreshes. */
export function listProviders() {
  const fresh = cache && Date.now() - cachedAt < CACHE_MS;
  if (!fresh && !inflight) {
    const connected = connections();
    // COUNCIL_OFFLINE skips network lookups (Codex's model catalog). It is separate from COUNCIL_QUIET:
    // the CLI runs the server quietly, and its model menu still needs the catalog.
    const offline = process.env.COUNCIL_OFFLINE === '1';
    inflight = Promise.all(ADAPTERS.map((a) => describe(a, connected, offline)))
      .then((list) => { cache = list; cachedAt = Date.now(); return list; })
      .finally(() => { inflight = null; });
  }
  return cache && (fresh || inflight) ? Promise.resolve(cache) : inflight;
}

/** The provider policy for new cases, from one providers listing. */
export function modelPolicy(providers) {
  const enabled = providers.filter((p) => p.status === 'enabled' && p.installed);
  const modesOf = new Map(providers.flatMap((p) => p.models.map((m) => [m, p.modes ?? []])));
  const usable = new Set(enabled.flatMap((p) => p.models));
  const known = new Set(providers.flatMap((p) => p.models));
  return {
    /** Can this model run a member in this mode right now? */
    usable: (model, mode) => usable.has(model) && (!mode || (modesOf.get(model) ?? []).includes(mode)),
    /** Is this the name of some provider's model (usable or not)? */
    known: (model) => known.has(model),
  };
}
