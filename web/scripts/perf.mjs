#!/usr/bin/env node
// Measures the 3D courtroom in a real (headless) Chrome while a case replays:
// frame times, long tasks and JS heap, on desktop and on an emulated phone with
// a 4x slower CPU. Needs a running server and its token.
//
// usage: node web/scripts/perf.mjs <url-with-#token=...> [caseId]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base, caseId] = process.argv.slice(2);
if (!base) throw new Error('usage: perf.mjs <http://127.0.0.1:PORT/#token=...> [caseId]');
const url = caseId ? base.replace('/#', `/?case=${encodeURIComponent(caseId)}#`) : base;

const profile = mkdtempSync(join(tmpdir(), 'council-perf-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--enable-gpu', '--use-angle=metal', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((ok, fail) => {
  let err = '';
  chrome.stderr.on('data', (d) => { err += d; const m = err.match(/ws:\/\/[^\s]+/); if (m) ok(m[0]); });
  chrome.on('exit', () => fail(new Error(err)));
});
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

// Runs in the page: replay at 2x and record 10 s of frames.
const MEASURE = `(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const settled = [...(window.__lt ?? [])];
  [...document.querySelectorAll('.seg button')].find((x) => x.textContent === '2×')?.click();
  const longTasks = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration); });
  po.observe({ type: 'longtask' });
  const frames = [];
  let last = performance.now();
  let on = true;
  const loop = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 10000));
  on = false;
  po.disconnect();
  const d = frames.slice(3).sort((a, b) => a - b);
  const pct = (p) => +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1);
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  const c = document.querySelector('canvas');
  return { fps: Math.round(1000 / avg), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), framesOver50ms: d.filter((x) => x > 50).length,
    longTasks: longTasks.length, longestTaskMs: Math.round(Math.max(0, ...longTasks)),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    canvas: c ? c.width + 'x' + c.height : 'none', viewport: innerWidth + 'x' + innerHeight,
    pageWidth: document.documentElement.scrollWidth, startupLongTasks: settled,
    resources: performance.getEntriesByType('resource').filter((e) => e.name.includes('.js')).map((e) => [e.name.split('/').pop().slice(0, 24), Math.round(e.startTime), Math.round(e.responseEnd)]), ruling: document.querySelector('.ruling')?.textContent?.slice(0, 50) };
})()`;

const runs = [
  { name: 'desktop 1440x900 @2x', metrics: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, cpu: 1 },
  { name: 'phone 375x812 @3x, CPU 4x slower', metrics: { width: 375, height: 812, deviceScaleFactor: 3, mobile: true }, cpu: 4 },
];
const results = {};
try {
  for (const r of runs) {
    await send('Emulation.setDeviceMetricsOverride', r.metrics);
    await send('Emulation.setCPUThrottlingRate', { rate: r.cpu });
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__lt=[];new PerformanceObserver((l)=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:'longtask',buffered:true});" });
    // A hash-only change would keep the old document: go through a blank page first.
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url });
    await new Promise((ok) => setTimeout(ok, 1500));
    results[r.name] = await evaluate(MEASURE);
  }
  const gpu = await evaluate(`(() => { try { const g = document.createElement('canvas').getContext('webgl'); return g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch { return 'unknown'; } })()`);
  console.log(JSON.stringify({ gpu, ...results }, null, 2));
} finally {
  ws.close();
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
