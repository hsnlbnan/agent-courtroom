#!/usr/bin/env node
// Renders every courtroom cue from web/lib/sound.ts to a WAV file and prints its
// levels, so the sounds can be listened to and checked for clipping without the app.
// The real sound.ts is transpiled and run in headless Chrome (WebAudio lives there).
//
// usage: node web/scripts/sounds.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [out] = process.argv.slice(2);
if (!out) throw new Error('usage: sounds.mjs <outDir>');
mkdirSync(out, { recursive: true });

// sound.ts as plain script: React is only used by the hooks, which are never called here.
const ts = createRequire(import.meta.url)('typescript');
const js = ts.transpileModule(readFileSync(join(HERE, '../lib/sound.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*$/gm, '').replace(/^export /gm, '');

const CUES = [['tick'], ['gavel'], ['objection'], ['verdict', 'go'], ['verdict', 'no-go'], ['verdict', 'conditional']];

const profile = mkdtempSync(join(tmpdir(), 'council-sounds-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
try {
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
  const send = (method, params) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });

  const RATE = 48_000;
  console.log('cue                    peak dBFS   RMS dBFS   audible ms');
  for (const [cue, mood] of CUES) {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${js}; const b = await render(${JSON.stringify(cue)}, ${JSON.stringify(mood ?? 'conditional')}, ${RATE}); return Array.from(b.getChannelData(0)); })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    const samples = r.result.result.value;
    const peak = Math.max(...samples.map(Math.abs));
    const rms = Math.sqrt(samples.reduce((a, x) => a + x * x, 0) / samples.length);
    const loud = samples.map((x, i) => (Math.abs(x) > 0.001 ? i : -1)).filter((i) => i >= 0);
    const audibleMs = loud.length ? Math.round(((loud.at(-1) - loud[0]) / RATE) * 1000) : 0;
    const name = mood ? `${cue}-${mood}` : cue;
    writeFileSync(join(out, `${name}.wav`), wav(samples.slice(0, (loud.at(-1) ?? 0) + RATE / 10), RATE));
    const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
    console.log(`${name.padEnd(22)} ${db(peak).padStart(9)} ${db(rms).padStart(10)} ${String(audibleMs).padStart(12)}${peak >= 1 ? '  CLIPS' : ''}`);
  }
  ws.close();
} finally {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** 16-bit mono PCM WAV. */
function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((x, i) => { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2); });
  return b;
}
