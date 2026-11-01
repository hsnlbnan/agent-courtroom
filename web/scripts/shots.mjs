#!/usr/bin/env node
// Screenshots of the UI in headless Chrome at phone and desktop sizes, for
// layout checks: a replay mid-debate, the verdict and the new-case form.
//
// usage: node web/scripts/shots.mjs <url-with-#token=...> <caseId> <outDir>
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base, caseId, out] = process.argv.slice(2);
if (!out) throw new Error('usage: shots.mjs <http://127.0.0.1:PORT/#token=...> <caseId> <outDir>');
mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'council-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--lang=en-US', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result?.result?.value);
const at = (query) => base.replace('/#', `/?${query}#`);

const sizes = [
  { name: 'phone', width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
];
const states = [
  { name: 'debate', url: at(`case=${caseId}&upto=3`), settle: 9000 },
  { name: 'verdict', url: at(`case=${caseId}`), settle: 2500, act: `document.querySelector('.seg:not(.lang) button:last-child')?.click()`, after: 3500 },
  { name: 'new-case', url: at(`case=${caseId}`), settle: 2500, act: `document.querySelector('.ctl.new')?.click()`, after: 1500 },
];
const report = {};
try {
  await send('Page.enable');
  for (const s of sizes) {
    await send('Emulation.setDeviceMetricsOverride', s);
    for (const st of states) {
      await send('Page.navigate', { url: 'about:blank' });
      await send('Page.navigate', { url: st.url });
      await wait(st.settle);
      if (st.act) { await js(st.act); await wait(st.after); }
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = join(out, `${s.name}-${st.name}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      report[`${s.name}-${st.name}`] = await js(`({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth,
        overflow: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')) })`);
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws.close();
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
