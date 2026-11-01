// The /api routes as a table: method, path pattern, how the token is checked, and a handler.
// Adding an endpoint is one entry here. Handlers return { status, body, headers? } or throw an
// HttpError; status codes and error `code`s are part of the API (the UI translates the codes).
import { join } from 'node:path';
import { connect, disconnect, isConnectable, jobOf } from './connect.mjs';
import { EXPORTERS, exportName } from './export.mjs';
import { appealOptions, FOLLOWUPS } from './followup.mjs';
import { HttpError, readJson } from './http.mjs';
import { langOf, parseNewCase } from './new-case.mjs';
import { listProviders, modelPolicy, refreshProviders } from './providers.mjs';
import { listRoles, MODELS } from './roles.mjs';
import { streamCase } from './sse.mjs';
import { browse, checkTarget, suggest } from './targets.mjs';
import { newCaseId } from './cases.mjs';

const ok = (body, status = 200, headers) => ({ status, body, headers });
const caseOr404 = (store, id) => {
  const c = store.getCase(id);
  if (!c) throw new HttpError(404, 'no such case', 'not_found');
  return c;
};
const jobView = (j) => (j ? { state: j.state, step: j.step, results: j.results, modes: j.modes ?? [], startedAt: j.startedAt } : { state: 'idle' });

/** deps: { store, live (createLiveCases), ideas (createIdeas), analyses (createAnalyses), dataDir } */
export function createRoutes({ store, live, ideas, analyses, dataDir }) {
  const startNew = async (req) => {
    const parsed = parseNewCase(await readJson(req), { providers: await listProviders() });
    if (parsed.error) throw new HttpError(400, parsed.error, parsed.code);
    const id = newCaseId();
    // An inline idea becomes the case's own idea.md, so members cite `idea.md:<line>` as with a file.
    const target = parsed.idea ? ideas.write(id, parsed.idea) : parsed.options.target;
    return ok({ id: live.start({ ...parsed.options, id, target }).id }, 201);
  };

  const appeal = async (c, lang) => {
    // A user path is re-checked with the usual rules; an inline idea's file was written by this server.
    const checked = ideas.owns(c.target)
      ? (ideas.exists(c.target) ? { path: c.target } : { error: 'Target not found', code: 'target_not_found' })
      : checkTarget(c.target, c.mode === 'idea' ? 'idea' : 'code');
    if (checked.error) throw new HttpError(400, checked.error, checked.code);
    const policy = modelPolicy(await listProviders());
    const usable = (m) => MODELS.includes(m) || policy.usable(m, c.mode);
    const options = appealOptions(c, store.events(c.id), { target: checked.path, lang, usable, claudeModels: MODELS });
    return ok({ id: live.start(options).id }, 201);
  };

  const followup = async ({ req, params }) => {
    const c = caseOr404(store, params.id);
    if (live.has(c.id)) throw new HttpError(409, 'The case is still running', 'still_live');
    const body = await readJson(req);
    const lang = langOf(body.lang);
    if (!store.events(c.id).some((e) => e.type === 'verdict.completed')) throw new HttpError(409, 'The case has no verdict', 'no_verdict');
    const kind = FOLLOWUPS[body.kind];
    if (!kind) throw new HttpError(400, 'unknown follow-up', 'bad_followup');
    if (kind.type === 'case') return appeal(c, lang);
    if (analyses.isRunning(c.id, body.kind)) throw new HttpError(409, 'Already running', 'followup_running');
    try { return ok(await analyses.run(c, body.kind, lang)); }
    catch (e) { throw new HttpError(502, e.message, 'followup_failed'); }
  };

  const exportCase = ({ url, params }) => {
    const c = caseOr404(store, params.id);
    const format = url.searchParams.get('format') ?? 'md';
    const exporter = EXPORTERS[format];
    if (!exporter) throw new HttpError(400, 'unknown export format', 'bad_format');
    return ok(exporter.render(c, store.events(c.id), langOf(url.searchParams.get('lang'))), 200,
      { 'Content-Type': exporter.mime, 'Content-Disposition': `attachment; filename="${exportName(c, format)}"` });
  };

  const note = async ({ req, params }) => {
    const h = live.get(params.id);
    if (!h) throw new HttpError(409, 'not running', 'not_live');
    const text = String((await readJson(req)).text ?? '').trim().slice(0, 500);
    if (!text) throw new HttpError(400, 'Note is empty', 'note_empty');
    const ev = h.addNote(text);
    if (!ev) throw new HttpError(409, 'not running', 'not_live');
    return ok({ seq: ev.seq }, 201);
  };

  const stop = ({ params }) => {
    const h = live.get(params.id);
    if (!h) throw new HttpError(409, 'not running', 'not_live');
    h.stop();
    return ok({ ok: true });
  };

  // Connecting a provider: GET reports the running/last test, POST starts it, DELETE forgets a connection.
  const connectable = (id) => { if (!isConnectable(id)) throw new HttpError(404, 'not connectable'); return id; };
  const startConnect = async ({ params }) => {
    const id = connectable(params.id);
    const p = (await listProviders()).find((x) => x.id === id);
    if (!p?.installed) throw new HttpError(409, 'Not installed', 'not_installed');
    if (jobOf(id)?.state === 'running') throw new HttpError(409, 'Already running', 'connect_running');
    void connect(id, { version: p.version, workRoot: join(dataDir, 'canary') }).then(refreshProviders, refreshProviders);
    return ok(jobView(jobOf(id)), 202);
  };

  return [
    { method: 'GET', path: '/api/roles', handle: () => ok({ roles: listRoles(), models: MODELS }) },
    { method: 'GET', path: '/api/providers', handle: async () => ok(await listProviders()) },
    { method: 'GET', path: '/api/suggest', handle: ({ url }) => ok(suggest(url.searchParams.get('path'), url.searchParams.get('mode') === 'idea' ? 'idea' : 'code')) },
    { method: 'GET', path: '/api/browse', handle: ({ url }) => ok(browse(url.searchParams.get('path'))) },
    { method: 'GET', path: '/api/providers/:id/connect', handle: ({ params }) => ok(jobView(jobOf(connectable(params.id)))) },
    { method: 'POST', path: '/api/providers/:id/connect', handle: startConnect },
    { method: 'DELETE', path: '/api/providers/:id/connect', handle: ({ params }) => { disconnect(connectable(params.id)); refreshProviders(); return ok({ state: 'idle' }); } },
    { method: 'GET', path: '/api/cases', handle: () => ok(store.listCases().map((c) => ({ ...c, live: live.has(c.id) }))) },
    { method: 'POST', path: '/api/cases', handle: ({ req }) => startNew(req) },
    // EventSource cannot send headers, so the stream takes the token as a query parameter.
    { method: 'GET', path: '/api/cases/:id/stream', auth: 'query', stream: true,
      handle: ({ req, res, url, params, cors }) => {
        caseOr404(store, params.id);
        streamCase({ req, res, store, caseId: params.id, live: live.has(params.id), speed: Number(url.searchParams.get('speed') ?? 6), cors });
      } },
    { method: 'GET', path: '/api/cases/:id/export', handle: exportCase },
    { method: 'POST', path: '/api/cases/:id/note', handle: note },
    { method: 'POST', path: '/api/cases/:id/followup', handle: followup },
    { method: 'POST', path: '/api/cases/:id/stop', handle: stop },
  ].map((r) => ({ ...r, pattern: new RegExp(`^${r.path.replace(/:(\w+)/g, '(?<$1>[\\w-]+)')}$`) }));
}

/** Find the route for a request: { route, params }, or { status: 404 | 405 }. */
export function matchRoute(routes, method, pathname) {
  const byPath = routes.map((r) => ({ r, m: pathname.match(r.pattern) })).filter((x) => x.m);
  if (!byPath.length) return { status: 404 };
  const hit = byPath.find((x) => x.r.method === method);
  return hit ? { route: hit.r, params: { ...hit.m.groups } } : { status: 405 };
}
