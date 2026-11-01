// One member's (or the chair's) CLI call within a case: the right adapter for the model, a time
// limit, one retry after a timeout, per-turn usage, and a note in the record when a call fails.
// The case's children are tracked here so stopping the case stops all of them.
import { resolveModel } from '../adapters/index.mjs';
import { terminate } from '../adapters/process.mjs';
import { run } from '../adapters/run.mjs';

const TIMEOUT_MS = 180_000;

/**
 * `emit(type, data)` writes to the case record; `isStopped()` says the case was stopped;
 * `cwdFor(adapter)` is where that adapter runs; `mode` is the case mode.
 */
export function createCaller({ emit, isStopped, cwdFor, mode, budgetUsd }) {
  const running = new Set();
  const lastCumulative = {}; // role -> usage so far (CLIs that report running totals)

  const attempt = (prompt, { sessionId, model, tools, onDelta, timeoutMs }) => {
    const { adapter, cliModel } = resolveModel(model);
    const { child, done } = run(adapter, {
      prompt, sessionId, model: cliModel, cwd: cwdFor(adapter), mode: tools === 'none' ? 'idea' : mode, budgetUsd,
    }, (it) => { if (it.kind === 'delta' && onDelta) onDelta(it.text); });
    running.add(child);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void terminate(child, 3000); }, timeoutMs);
    return done.then((r) => { clearTimeout(timer); running.delete(child); return { ...r, timedOut }; });
  };

  // Codex reports running totals per thread; the record wants this turn's share.
  const perTurn = (role, r) => {
    if (!r.usage || !r.cumulative) return r.usage;
    const prev = lastCumulative[role] ?? { inputTokens: 0, outputTokens: 0 };
    lastCumulative[role] = r.usage;
    return { ...r.usage, inputTokens: r.usage.inputTokens - prev.inputTokens, outputTokens: r.usage.outputTokens - prev.outputTokens };
  };

  /** Resolves with the CLI result, or null if the case was stopped meanwhile. */
  async function call(role, prompt, { sessionId, model, tools, onDelta, timeoutMs = TIMEOUT_MS } = {}) {
    if (isStopped()) return null;
    const seconds = Math.round(timeoutMs / 1000);
    let r = await attempt(prompt, { sessionId, model, tools, onDelta, timeoutMs });
    if (r.timedOut && !isStopped()) {
      emit('note', { kind: 'orchestrator', code: 'retry', params: { role, seconds }, text: `${role}: no reply in ${seconds} s, retrying.` });
      r = await attempt(prompt, { sessionId: r.sessionId ?? sessionId, model, tools, onDelta, timeoutMs });
    }
    if (isStopped()) return null;
    const usage = perTurn(role, r);
    if (usage) emit('usage', { role, ...usage, ms: r.ms });
    if (r.timedOut) emit('note', { kind: 'orchestrator', code: 'gave_up', params: { role }, text: `${role}: no reply on the second try either; the case goes on without it.` });
    else if (r.exitCode !== 0) emit('note', { kind: 'orchestrator', code: 'cli_exit', params: { role, exitCode: r.exitCode }, text: `${role}: CLI exit ${r.exitCode}. ${r.stderr.slice(0, 200)}` });
    return { ...r, usage };
  }

  /** Stop every CLI this case still has running (SIGTERM, then SIGKILL). */
  const stopAll = () => Promise.all([...running].map((c) => terminate(c, 2000)));

  return { call, stopAll };
}
