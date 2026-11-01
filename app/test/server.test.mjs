// Black-box tests for the local server: it runs as a child process on a free
// port with its own token and a throwaway database, and is called over HTTP
// with hand-set Host/Origin headers (fetch cannot set Host).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../server.mjs');
const TOKEN = 'test-token-0123456789abcdef';
let port;
let child;
let tmp;

const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});

function call(path, { method = 'GET', host = `127.0.0.1:${port}`, origin, token = TOKEN, body } = {}) {
  return new Promise((ok, fail) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    if (token) headers['X-Council-Token'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(s); } catch {}
        ok({ status: res.statusCode, headers: res.headers, json, text: s });
      });
    });
    req.on('error', fail);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  port = await freePort();
  // Everything the server writes goes under one temp folder in $HOME (targets must live there).
  tmp = mkdtempSync(join(homedir(), '.council-test-server-'));
  // A `claude` that never answers a hearing (a started case stays live until it is stopped)
  // but answers a follow-up analysis at once, citing the idea and a file it never saw.
  const analysis = JSON.stringify({ type: 'result', result: 'Özet.\n\n1. Pilot (`idea.md:1`), bkz. `nope.md:3`.', session_id: 's', usage: {} });
  writeFileSync(join(tmp, 'claude'), `#!/bin/sh\ncase "$*" in *"The hearing below has ended"*) printf '%s\\n' '${analysis}' ;; *) sleep 30 ;; esac\n`);
  chmodSync(join(tmp, 'claude'), 0o755);
  child = spawn(process.execPath, [SERVER, '--port', String(port)], {
    env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, COUNCIL_TOKEN: TOKEN, COUNCIL_DB: join(tmp, 'db', 'council.db'), COUNCIL_QUIET: '1', COUNCIL_OFFLINE: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await call('/api/roles'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

after(() => {
  child?.kill('SIGKILL');
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('host: requests for any other Host are refused (DNS rebinding)', async () => {
  assert.equal((await call('/api/roles', { host: `evil.example:${port}` })).status, 421);
  assert.equal((await call('/', { host: 'attacker.test' })).status, 421);
  assert.equal((await call('/api/roles', { host: `localhost:${port}` })).status, 200);
});

test('origin: cross-origin API calls are refused unless allow-listed', async () => {
  assert.equal((await call('/api/roles', { origin: 'https://evil.example' })).status, 403);
  const same = await call('/api/roles', { origin: `http://127.0.0.1:${port}` });
  assert.equal(same.status, 200);
  assert.equal(same.headers['access-control-allow-origin'], undefined);
});

test('token: API needs the exact token; stream takes it as a query parameter', async () => {
  assert.equal((await call('/api/roles', { token: null })).status, 401);
  assert.equal((await call('/api/roles', { token: `${TOKEN}x` })).status, 401);
  assert.equal((await call('/api/cases', { token: 'wrong' })).status, 401);
  assert.equal((await call('/api/cases/x/stream', { token: null })).status, 401);
  const roles = await call('/api/roles');
  assert.equal(roles.status, 200);
  assert.ok(Array.isArray(roles.json.roles) && roles.json.roles.length >= 6);
});

test('headers: responses carry nosniff, no-referrer and a CSP', async () => {
  const r = await call('/api/roles');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('static: path traversal does not leave the public folders', async () => {
  for (const p of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/..%2fserver.mjs']) {
    const r = await call(p);
    assert.notEqual(r.status, 200, p);
  }
});

test('cases: invalid requests are rejected before anything runs', async () => {
  const post = (body) => call('/api/cases', { method: 'POST', body });
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post({})).status, 400); // no target
  assert.equal((await post({ target: '/etc' })).status, 400); // outside $HOME
  assert.equal((await post({ target: homedir() })).status, 400); // $HOME itself
  assert.equal((await post({ target: join(homedir(), '.ssh') })).status, 400); // credential folder
  assert.equal((await post({ target: tmp, members: ['optimist'] })).status, 400); // fewer than two members
  assert.equal((await post({ target: tmp, members: ['optimist', 'nobody'] })).status, 400); // unknown roles are dropped
  assert.equal((await call('/api/cases', { method: 'DELETE' })).status, 405);
  assert.equal((await call('/api/cases/nope/stop', { method: 'POST' })).status, 409);
});

test('cases: a valid case starts, shows as live, stops once', async () => {
  const created = await call('/api/cases', { method: 'POST', body: {
    target: tmp, mode: 'code', members: ['optimist', 'skeptic'],
    models: { optimist: '--dangerously-skip-permissions', skeptic: 'haiku' }, chairModel: 'codex', maxTurns: 99,
  } });
  assert.equal(created.status, 201);
  const { id } = created.json;
  const list = await call('/api/cases');
  const c = list.json.find((x) => x.id === id);
  assert.ok(c?.live);
  assert.equal((await call(`/api/cases/${id}/stop`, { method: 'POST' })).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await call(`/api/cases/${id}/stop`, { method: 'POST' })).status, 409);

  // Model injection falls back to the role default; the judge stays on Claude.
  const stream = await new Promise((ok) => {
    const req = request({ host: '127.0.0.1', port, path: `/api/cases/${id}/stream?token=${TOKEN}&speed=0`, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; if (s.includes('replay-end')) { req.destroy(); ok(s); } });
    });
    req.end();
  });
  const events = stream.split('\n').filter((l) => l.startsWith('data: {"seq"')).map((l) => JSON.parse(l.slice(6)));
  const reg = Object.fromEntries(events.filter((e) => e.type === 'member.registered').map((e) => [e.data.role, e.data.model]));
  assert.notEqual(reg.optimist, '--dangerously-skip-permissions');
  assert.equal(reg.skeptic, 'haiku');
  assert.notEqual(reg.chair, 'codex');
  assert.equal(events.at(-1).type, 'case.ended');
});

test('export: needs the token and returns a downloadable file', async () => {
  const list = await call('/api/cases');
  const id = list.json[0].id;
  assert.equal((await call(`/api/cases/${id}/export`, { token: null })).status, 401);
  const md = await call(`/api/cases/${id}/export?format=md&lang=tr`);
  assert.equal(md.status, 200);
  assert.match(md.headers['content-type'], /text\/markdown/);
  assert.match(md.headers['content-disposition'], /^attachment; filename="[a-z0-9-]+\.md"$/);
  const json = await call(`/api/cases/${id}/export?format=json`);
  assert.equal(json.json.case.id, id);
  assert.equal((await call('/api/cases/nope/export')).status, 404);
});

test('providers: a member on an untested provider is refused, not swapped', async () => {
  const r = await call('/api/cases', { method: 'POST', body: { target: tmp, members: ['optimist', 'skeptic'], models: { optimist: 'qwen' } } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'provider_unavailable');
});

test('inline idea: becomes the case idea.md (0600), idea mode, titled from its first line', async () => {
  const idea = '# Kiralık laboratuvar ekipmanı\n\nÜniversitelerdeki atıl cihazları saatlik kiralayan bir pazar yeri.';
  const r = await call('/api/cases', { method: 'POST', body: { idea, members: ['optimist', 'skeptic'] } });
  assert.equal(r.status, 201);
  const c = (await call('/api/cases')).json.find((x) => x.id === r.json.id);
  assert.equal(c.mode, 'idea');
  assert.equal(c.title, 'Kiralık laboratuvar ekipmanı');
  assert.ok(c.target.endsWith(`/cases/${r.json.id}/idea.md`));
  assert.equal(readFileSync(c.target, 'utf8').trim(), idea);
  assert.equal(statSync(c.target).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(c.target)).mode & 0o777, 0o700);
  await call(`/api/cases/${r.json.id}/stop`, { method: 'POST' });

  // Free text in `target` is an inline idea too; a folder path without a mode is code mode.
  const t = await call('/api/cases', { method: 'POST', body: { target: 'Bir fikir: kampüs içi kargo', members: ['optimist', 'skeptic'] } });
  assert.equal(t.status, 201);
  await call(`/api/cases/${t.json.id}/stop`, { method: 'POST' });
  const f = await call('/api/cases', { method: 'POST', body: { target: tmp, members: ['optimist', 'skeptic'] } });
  assert.equal((await call('/api/cases')).json.find((x) => x.id === f.json.id).mode, 'code');
  await call(`/api/cases/${f.json.id}/stop`, { method: 'POST' });

  assert.equal((await call('/api/cases', { method: 'POST', body: { idea: 'x'.repeat(12_001), members: ['optimist', 'skeptic'] } })).json.code, 'idea_too_long');
  // The app's own data folder is a credential folder that exists on every OS (macOS-only ones like Library/Keychains do not).
  mkdirSync(join(homedir(), '.agent-council'), { recursive: true });
  assert.equal((await call('/api/cases', { method: 'POST', body: { target: join(homedir(), '.agent-council'), members: ['optimist', 'skeptic'] } })).json.code, 'target_sensitive');
  assert.equal((await call('/api/cases', { method: 'POST', body: { target: join(homedir(), '.ssh'), members: ['optimist', 'skeptic'] } })).status, 400);
});

test('follow-up: refused while live, without a verdict, or for an unknown kind', async () => {
  const r = await call('/api/cases', { method: 'POST', body: { target: tmp, members: ['optimist', 'skeptic'] } });
  const id = r.json.id;
  assert.equal((await call(`/api/cases/${id}/followup`, { method: 'POST', body: { kind: 'ideas' } })).json.code, 'still_live');
  await call(`/api/cases/${id}/stop`, { method: 'POST' });
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal((await call(`/api/cases/${id}/followup`, { method: 'POST', body: { kind: 'ideas' } })).json.code, 'no_verdict');
  assert.equal((await call('/api/cases/nope/followup', { method: 'POST', body: { kind: 'ideas' } })).status, 404);
  const demo = (await call('/api/cases')).json.find((c) => c.source === 'import');
  assert.equal((await call(`/api/cases/${demo.id}/followup`, { method: 'POST', body: { kind: 'poem' } })).json.code, 'bad_followup');
  assert.equal((await call(`/api/cases/${demo.id}/followup`, { token: null, method: 'POST', body: { kind: 'ideas' } })).status, 401);
});

test('appeal: an inline-idea case reuses its own idea.md (not refused as a fenced path)', async () => {
  const { openStore } = await import('../lib/store.mjs');
  const r = await call('/api/cases', { method: 'POST', body: { idea: 'Kampüs içi kargo dolapları.', members: ['optimist', 'skeptic'] } });
  await call(`/api/cases/${r.json.id}/stop`, { method: 'POST' });
  await new Promise((ok) => setTimeout(ok, 300));
  // Give the stopped case a verdict, as a finished one would have.
  const store = openStore(join(tmp, 'db', 'council.db'));
  store.append(r.json.id, 'verdict.completed', { markdown: '# v', chair: { verdict: 'conditional', confidence: 0.6, reason: 'r',
    disagreements: [{ topic: 'Kim öder?', positions: [] }] } }, 99_999);
  store.close();
  const appeal = await call(`/api/cases/${r.json.id}/followup`, { method: 'POST', body: { kind: 'appeal', lang: 'tr' } });
  assert.equal(appeal.status, 201, JSON.stringify(appeal.json));
  const c = (await call('/api/cases')).json.find((x) => x.id === appeal.json.id);
  assert.equal(c.title, 'Temyiz: Kim öder?');
  assert.equal(c.mode, 'idea');
  assert.ok(c.target.endsWith(`/cases/${r.json.id}/idea.md`));
  await call(`/api/cases/${appeal.json.id}/stop`, { method: 'POST' });
});

test('follow-up: an analysis comes back with its citations checked like the verdict', async () => {
  const { openStore } = await import('../lib/store.mjs');
  const r = await call('/api/cases', { method: 'POST', body: { idea: 'Kampüs içi kargo dolapları.', members: ['optimist', 'skeptic'] } });
  await call(`/api/cases/${r.json.id}/stop`, { method: 'POST' });
  await new Promise((ok) => setTimeout(ok, 300));
  const store = openStore(join(tmp, 'db', 'council.db'));
  store.append(r.json.id, 'verdict.completed', { markdown: '# v', chair: { verdict: 'go', confidence: 0.7, reason: 'r' } }, 99_999);
  store.close();
  const f = await call(`/api/cases/${r.json.id}/followup`, { method: 'POST', body: { kind: 'ideas', lang: 'tr' } });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.deepEqual(f.json.citations.map((c) => [c.ref, c.verified]), [['idea.md:1', true], ['nope.md:3', false]]);
  const ev = (await call(`/api/cases/${r.json.id}/export?format=json`)).json.events.find((e) => e.type === 'followup.completed');
  assert.equal(ev.data.citations.length, 2);
});

test('custom role: accepted with the case and registered with its label; an unknown key is not', async () => {
  const r = await call('/api/cases', { method: 'POST', body: { idea: 'Kampüs içi kargo dolapları.', members: ['optimist', 'custom-lawyer-b2', 'custom-ghost'],
    custom: [{ key: 'custom-lawyer-b2', label: 'Hukukçu', brief: 'KVKK ve sözleşme risklerine bakar.' }] } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await new Promise((ok) => setTimeout(ok, 200));
  const ev = (await call(`/api/cases/${r.json.id}/export?format=json`)).json.events.filter((e) => e.type === 'member.registered').map((e) => [e.data.role, e.data.label]);
  assert.deepEqual(ev.filter(([role]) => role !== 'chair'), [['optimist', 'İyimser'], ['custom-lawyer-b2', 'Hukukçu']]);
  await call(`/api/cases/${r.json.id}/stop`, { method: 'POST' });
});

test('connect: needs the token, only for connectable providers, and refuses a CLI that is not installed', async () => {
  assert.equal((await call('/api/providers/qwen/connect', { token: null })).status, 401);
  assert.equal((await call('/api/providers/claude/connect')).status, 404);
  assert.deepEqual((await call('/api/providers/qwen/connect')).json, { state: 'idle' });
  // The test server's PATH has no `opencode` (fake bin first, then the real PATH; opencode is not installed here).
  const ps = (await call('/api/providers')).json;
  const oc = ps.find((p) => p.id === 'opencode');
  if (!oc.installed) assert.equal((await call('/api/providers/opencode/connect', { method: 'POST' })).json.code, 'not_installed');
  assert.ok(!ps.some((p) => p.id === 'gemini' || p.id === 'antigravity'), 'blocked providers are not offered');
  assert.deepEqual(Object.keys(oc.setup.envSet), ['OPENROUTER_API_KEY']);
  assert.equal(typeof oc.setup.envSet.OPENROUTER_API_KEY, 'boolean'); // presence only, never the value
});

test('api: wrong method is 405, unknown export format 400, an oversized body 413', async () => {
  assert.equal((await call('/api/roles', { method: 'POST', body: {} })).status, 405);
  const demo = (await call('/api/cases')).json.find((c) => c.source === 'import');
  const bad = await call(`/api/cases/${demo.id}/export?format=pdf`);
  assert.deepEqual([bad.status, bad.json.code], [400, 'bad_format']);
  const big = await call('/api/cases', { method: 'POST', body: JSON.stringify({ idea: 'x'.repeat(70_000) }) });
  assert.equal(big.status, 413);
  // The server is still up after all of that.
  assert.equal((await call('/api/roles')).status, 200);
});
