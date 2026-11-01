#!/usr/bin/env node
// Screenshots of every state that is not the happy path: onboarding, loading,
// empty new case, a live case waiting for openings / the moderator / the first
// words, a stopped case, a failed case, and the verdict. It starts its own
// server on a throwaway database with a slow scripted `claude` (stage-claude.mjs),
// so nothing touches your real cases or subscription.
//
// usage: node web/scripts/states.mjs <outDir> [lang=tr]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [out, lang = 'tr'] = process.argv.slice(2);
if (!out) throw new Error('usage: states.mjs <outDir> [en|tr]');
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a private server with the slow fake on PATH ----------------------------
const work = mkdtempSync(join(homedir(), '.council-states-'));
const bin = join(work, 'bin');
mkdirSync(bin);
copyFileSync(join(HERE, 'stage-claude.mjs'), join(bin, 'claude'));
chmodSync(join(bin, 'claude'), 0o755);
const target = join(work, 'proje');
mkdirSync(target);
writeFileSync(join(target, 'README.md'), '# Örnek proje\n\nTek komutla kurulur: `npx agent-courtroom`.\n');
const PORT = 4460;
const TOKEN = 'states-token-0123456789';
const server = spawn(process.execPath, [join(HERE, '../../app/server.mjs'), '--port', String(PORT)], {
  env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COUNCIL_TOKEN: TOKEN, COUNCIL_DB: join(work, 'db', 'council.db'), COUNCIL_QUIET: '1', COUNCIL_OFFLINE: '1' },
  stdio: 'ignore',
});
const api = (path, body) => fetch(`http://127.0.0.1:${PORT}${path}`, {
  method: body ? 'POST' : 'GET', headers: { 'X-Council-Token': TOKEN, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
}).then((r) => r.json());
for (let i = 0; i < 50; i++) { try { await api('/api/roles'); break; } catch { await wait(100); } }
const newCase = (focus) => api('/api/cases', { target, mode: 'code', members: ['optimist', 'skeptic'], models: { optimist: 'sonnet', skeptic: 'opus' }, maxTurns: 2, focus, lang })
  .then((r) => r.id);

// ---- headless Chrome ---------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'council-states-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((ok, fail) => {
  let err = '';
  chrome.stderr.on('data', (d) => { err += d; const m = err.match(/ws:\/\/[^\s]+/); if (m) ok(m[0]); });
  chrome.on('exit', () => fail(new Error(err)));
});
const page = (await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); });
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const js = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('council-lang', ${JSON.stringify(lang)}); } catch {}` });

const base = `http://127.0.0.1:${PORT}/`;
const withToken = (q = '') => `${base}${q ? `?${q}` : ''}#token=${TOKEN}`;
const looks = [
  { name: 'desktop-light', metrics: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, scheme: 'light' },
  { name: 'desktop-dark', metrics: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, scheme: 'dark' },
  { name: 'phone-dark', metrics: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, scheme: 'dark' },
];
async function shoot(state, look) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${state}--${look.name}.png`), Buffer.from(r.result.data, 'base64'));
}
async function open(url) {
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url });
}

try {
  for (const look of looks) {
    await send('Emulation.setDeviceMetricsOverride', look.metrics);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: look.scheme }] });

    await open(base); await wait(2500); await shoot('01-onboarding-no-token', look);

    // Loading: every request slowed down.
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: false, latency: 3000, downloadThroughput: -1, uploadThroughput: -1 });
    await open(withToken()); await wait(1800); await shoot('02-loading', look);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    await open(withToken()); await wait(2500); await shoot('03-new-case-empty', look);
    // The single input, as an idea typed in place and as a folder path.
    const type = async (text) => {
      await js(`(() => { const el = document.getElementById('target'); el.focus(); el.select(); })()`);
      await send('Input.insertText', { text });
      await wait(700);
    };
    await type('Üniversitelerdeki atıl laboratuvar cihazlarını saatlik kiralayan bir pazar yeri.\nHedef: araştırma grupları ve küçük girişimler.');
    await shoot('03b-new-case-idea-text', look);
    await type(`${target}`); await js(`document.getElementById('target').blur()`); await wait(400);
    await shoot('03c-new-case-folder', look);

    // One live case, photographed as it moves through its waiting states.
    const live = await newCase('Yayına hazır mı?');
    await open(withToken(`case=${live}`));
    await wait(1800); await shoot('04-live-openings-pending', look);
    await wait(4400); await shoot('05-live-moderator-picking', look); // openings done ~5s, pick takes 3s
    await wait(3000); await shoot('06-live-waiting-first-words', look); // turn started, first delta after 2.2s
    await wait(2600); await shoot('07-live-streaming', look);
    await wait(21000); await shoot('09-verdict-screen', look); // opens by itself for a live viewer
    await js(`document.querySelector('.fu-risks button')?.click()`); await wait(6000);
    await js(`document.querySelector('.fu-risks')?.scrollIntoView({ block: 'center' })`); await wait(400); await shoot('09b-verdict-followup', look);
    await js(`document.querySelector('dialog[open]')?.close()`); await wait(800); await shoot('10-verdict-stage', look);
    await js(`document.getElementById('verdict')?.scrollIntoView()`); await wait(600); await shoot('10b-verdict-rail', look);

    const stopped = await newCase('Durdurulacak dava');
    await wait(2000); await api(`/api/cases/${stopped}/stop`, {});
    await open(withToken(`case=${stopped}`)); await wait(2500); await shoot('11-stopped', look);

    const failed = await newCase('FAILCASE: karar yazılamayacak');
    await wait(32000);
    await open(withToken(`case=${failed}`)); await wait(2500); await shoot('12-failed', look);
    await js(`document.querySelector('.rail')?.scrollTo(0, 1e6)`); await wait(400); await shoot('13-failed-rail-end', look);

    await open(withToken()); await wait(2000);
    await js(`document.querySelector('.case-trigger')?.click()`); await wait(500); await shoot('14-case-menu', look);
    await js(`document.querySelector('.ctl.sound')?.click()`); await wait(300); await shoot('15-sound-on', look);
    console.log(`done: ${look.name}`);
  }
} finally {
  ws.close();
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  server.kill('SIGTERM');
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
