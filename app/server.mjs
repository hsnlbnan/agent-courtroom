#!/usr/bin/env node
// Local-only server: 127.0.0.1, one random token per run, Host/Origin checks, SSE for replay and
// live cases. Zero dependencies. This file is configuration and wiring; the API is a route table
// (lib/api.mjs), static files lib/static.mjs, the event stream lib/sse.mjs.
//
// usage: node server.mjs [--port 4317] [--import-demo]
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { children } from './adapters/process.mjs';
import { createRoutes, matchRoute } from './lib/api.mjs';
import { createIdeas, createLiveCases } from './lib/cases.mjs';
import { useConnectionsFile } from './lib/connect.mjs';
import { createAnalyses } from './lib/followup.mjs';
import { HttpError, send, tokenChecker } from './lib/http.mjs';
import { importRun } from './lib/importer.mjs';
import { startCase } from './lib/orchestrator.mjs';
import { SANDBOX_ROOT } from './lib/paths.mjs';
import { listProviders } from './lib/providers.mjs';
import { createStatic } from './lib/static.mjs';
import { openStore } from './lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const portArg = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : process.env.PORT || 4317);
if (!Number.isInteger(portArg) || portArg < 1 || portArg > 65535) { console.error('--port must be a number from 1 to 65535'); process.exit(2); }
const PORT = portArg;
const TOKEN = process.env.COUNCIL_TOKEN ?? randomBytes(24).toString('base64url');
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
// Dev only: let the Next dev server (another origin) call the API, e.g. COUNCIL_ALLOWED_ORIGINS=http://localhost:3130
const ALLOWED = new Set((process.env.COUNCIL_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const MAX_LIVE = 3;

const store = openStore();
const dataDir = dirname(store.path);
useConnectionsFile(join(dataDir, 'providers.json'));
const live = createLiveCases({ store, startCase, max: MAX_LIVE });
const routes = createRoutes({ store, live, ideas: createIdeas(join(dataDir, 'cases')), analyses: createAnalyses(store), dataDir });
const files = createStatic({ web: join(HERE, '../web/out'), classic: join(HERE, 'public') });
const tokenOk = tokenChecker(TOKEN);

/** Same-origin requests get no CORS headers; an allow-listed dev origin gets its own; others are refused. */
function corsFor(origin) {
  if (!origin || HOSTS.has(origin.replace(/^https?:\/\//, ''))) return {};
  return ALLOWED.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : null;
}

async function handle(req, res) {
  // The Host check comes first: it guards against DNS rebinding, and a malformed Host cannot reach the URL parser.
  if (!HOSTS.has(req.headers.host)) return send(res, 421, { error: 'bad host' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return req.method === 'GET' ? files.serve(res, url.pathname) : send(res, 405, {});
  const cors = corsFor(req.headers.origin);
  if (!cors) return send(res, 403, { error: 'bad origin' });
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', { ...cors, 'Access-Control-Allow-Headers': 'X-Council-Token, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' });
  }
  const found = matchRoute(routes, req.method, url.pathname);
  if (!found.route) return send(res, found.status, { error: found.status === 404 ? 'not found' : 'method' }, cors);
  const token = found.route.auth === 'query' ? url.searchParams.get('token') : req.headers['x-council-token'];
  if (!tokenOk(token)) return send(res, 401, { error: 'token' }, cors);
  try {
    const out = await found.route.handle({ req, res, url, params: found.params, cors });
    if (!found.route.stream) send(res, out.status, out.body, { ...cors, ...(out.headers ?? {}) });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) }, cors);
    throw e;
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(`[council] ${req.method} ${req.url?.split('?')[0]}: ${e.stack ?? e}`);
    send(res, 500, { error: 'internal error' });
  });
});

// A case still "running" at startup lost its process when the server last died.
for (const c of store.listCases()) if (c.status === 'running') store.setStatus(c.id, 'interrupted');
if (args.includes('--import-demo') || !store.listCases().some((c) => c.source === 'import')) {
  const demo = join(HERE, '../reports/2026-10-30-council-app');
  if (existsSync(join(demo, 'council.json'))) importRun(store, demo, 'demo-council-app');
}
void listProviders(); // warm the cache before the first page asks
// Sandboxes a crash or a killed server left behind. A day old means no case still uses it
// (another server on this machine may have a live one).
for (const d of existsSync(SANDBOX_ROOT) ? readdirSync(SANDBOX_ROOT) : []) {
  try { if (Date.now() - statSync(join(SANDBOX_ROOT, d)).mtimeMs > 86_400_000) rmSync(join(SANDBOX_ROOT, d), { recursive: true, force: true }); } catch {}
}

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use; pick another with --port.` : `Server error: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  if (process.env.COUNCIL_QUIET) return; // the cli prints its own banner
  console.log(`Agent Council → http://127.0.0.1:${PORT}/#token=${TOKEN}`);
  console.log(`DB: ${store.path}`);
  if (files.hasWeb()) console.log('UI: 3D (web/out) at /, classic at /classic/');
  if (ALLOWED.size) console.log(`CORS allowed (dev): ${[...ALLOWED].join(', ')}`);
});

// Member CLIs, analyses and connection tests run in their own process groups: stop them all
// (SIGTERM, then SIGKILL) before exiting, so none outlives the server.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    live.stopAll('server');
    server.close();
    await children.stopAll(2000);
    process.exit(0);
  });
}
