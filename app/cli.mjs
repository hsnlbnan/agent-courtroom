#!/usr/bin/env node
// One command to run the council: checks the environment, picks a free port,
// starts the local server and opens the browser with this run's token.
//
// usage: npx agent-courtroom [--port 4317] [--no-open] [--version]
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const say = (s = '') => process.stdout.write(`${s}\n`);
const fail = (msg, hint) => { say(`\n  ✗ ${msg}`); if (hint) say(`    ${hint}`); say(); process.exit(1); };

if (flag('--version') || flag('-v')) {
  say(JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version);
  process.exit(0);
}

if (flag('--help') || flag('-h')) {
  say('agent-courtroom: rol yapan kodlama ajanlarının bir projeyi tartıştığı yerel konsey.\n');
  say('  npx agent-courtroom              sunucuyu başlatır ve tarayıcıyı açar');
  say('  npx agent-courtroom --port 5000  belirli bir port');
  say('  npx agent-courtroom --no-open    tarayıcıyı açmaz, bağlantıyı yazar');
  say('  npx agent-courtroom --version    sürümü yazar');
  process.exit(0);
}

// 1. Node: node:sqlite needs 22.5+.
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 5)) fail(`Node ${process.versions.node} çok eski; 22.5 veya üstü gerekli.`, 'https://nodejs.org adresinden güncel sürümü kurun.');

// 2. Claude Code CLI: installed and signed in (members run on the user's own login).
const ver = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 });
if (ver.error || ver.status !== 0) fail('Claude Code (claude) bulunamadı.', 'Kurun: npm install -g @anthropic-ai/claude-code  ·  sonra: claude auth login');
let auth = {};
try { auth = JSON.parse(spawnSync('claude', ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 15000 }).stdout || '{}'); } catch {}
if (!auth.loggedIn) fail('Claude Code giriş yapmamış.', 'Giriş yapın: claude auth login');

// 3. A free port on 127.0.0.1, starting from the requested one.
const free = (port) => new Promise((ok) => {
  const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)));
  s.listen(port, '127.0.0.1');
});
const want = Number(value('--port') ?? process.env.PORT ?? 4317);
let port = want;
while (!(await free(port))) { if (++port > want + 20) fail(`${want}–${want + 20} arası portların hepsi dolu.`, 'Başka bir port deneyin: npx agent-courtroom --port 5000'); }

// 4. Start the server in this process with a fresh token, then open the browser.
const token = randomBytes(24).toString('base64url');
process.env.PORT = String(port);
process.env.COUNCIL_TOKEN = token;
process.env.COUNCIL_QUIET = '1';
await import('./server.mjs');

const url = `http://127.0.0.1:${port}/#token=${token}`;
const ui = existsSync(join(HERE, '../web/out/index.html')) ? '3D' : 'klasik';
say('');
say(`  Agent Council · ${ver.stdout.trim()} · ${auth.authMethod === 'claude.ai' ? `Claude aboneliği${auth.subscriptionType ? ` (${auth.subscriptionType})` : ''}` : auth.authMethod ?? 'giriş yapıldı'}`);
// Codex is optional: members can use it when it is installed and signed in.
// The server already probes every CLI (asynchronously); reuse its answer.
const { listProviders } = await import('./lib/providers.mjs');
const cx = (await listProviders()).find((p) => p.id === 'codex');
const cxAuth = existsSync(join(homedir(), '.codex', 'auth.json'));
say(`  Codex: ${!cx?.installed ? 'kurulu değil (isteğe bağlı)' : cxAuth ? `${cx.version} · kullanılabilir` : 'giriş yapılmamış: codex login'}`);
say(`  Arayüz (${ui}): ${url}`);
say('  Durdurmak için Ctrl+C.');
say('');

if (!flag('--no-open')) {
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
  child.on('error', () => say('  (Tarayıcı açılamadı; bağlantıyı elle açın.)'));
  child.unref();
}
