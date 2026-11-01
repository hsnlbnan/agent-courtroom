// Run one CLI call through an adapter. The adapter knows its argv, environment and event
// format; this file knows how to start a process, read JSON lines and report the outcome.
import { spawn } from 'node:child_process';
import { children } from './process.mjs';

export const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG'];
const STDERR_MAX = 64_000;

/** The only environment a member CLI inherits from the server. */
export function cleanEnv() {
  return Object.fromEntries(ENV_ALLOWLIST.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

/**
 * Start `adapter` with `opts`; `onItem` receives normalized items as they stream.
 * Returns { child, done } where `done` always resolves (never rejects) with
 * { text, sessionId, usage, cumulative, ms, exitCode, stderr }. A CLI that cannot start
 * (missing binary, missing cwd) resolves with exitCode -1 and the reason in stderr.
 */
export function run(adapter, opts, onItem = () => {}) {
  const [cmd, args] = adapter.argv(opts);
  const started = Date.now();
  // Own process group, so stopping a member also stops anything it started.
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...cleanEnv(), ...(adapter.env?.(opts.mode) ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.add(child);
  let buf = '';
  let stderr = '';
  // The answer: the CLI's final result if it gives one, else its last message, else what streamed.
  const state = { text: '', said: '', streamed: '', sessionId: opts.sessionId ?? null, usage: null, cumulative: false };
  const take = (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    for (const item of adapter.parse(ev)) {
      if (item.kind === 'session' && item.sessionId) state.sessionId = item.sessionId;
      if (item.kind === 'delta') state.streamed += item.text;
      if (item.kind === 'text') state.said = item.text;
      if (item.kind === 'result') { if (item.text) state.text = item.text; state.usage = item.usage; state.cumulative = !!item.cumulative; }
      onItem(item);
    }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      take(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-STDERR_MAX); });
  const done = new Promise((resolve) => {
    let settled = false;
    const finish = (exitCode, extra = '') => {
      if (settled) return;
      settled = true;
      take(buf); // a last line without a trailing newline
      resolve({
        text: state.text || state.said || state.streamed, sessionId: state.sessionId, usage: state.usage, cumulative: state.cumulative,
        ms: Date.now() - started, exitCode, stderr: `${stderr}${extra}`.slice(-2000),
      });
    };
    child.on('error', (e) => finish(-1, `\n${e.message}`));
    child.on('close', (exitCode) => finish(exitCode));
  });
  return { child, done };
}
