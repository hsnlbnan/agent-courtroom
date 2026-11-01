// Live council: blind openings (parallel) → turn-by-turn conversation with hybrid moderation →
// closings (parallel) → chair verdict. This file is the flow and the case's lifecycle; the
// prompts (prompts.mjs), who speaks next (moderation.mjs), running a CLI call (caller.mjs) and
// the shared context (context.mjs) live in their own modules.
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { claude } from '../adapters/claude.mjs';
import { resolveModel } from '../adapters/index.mjs';
import { createCaller } from './caller.mjs';
import { buildContext } from './context.mjs';
import { conversationState, parseModeratorLine, quietestPick, rulePick } from './moderation.mjs';
import { sandboxFor } from './paths.mjs';
import { closingPrompt, formatLog, moderatorPrompt, openingPrompt, promptKit, turnPrompt, verdictPrompt } from './prompts.mjs';
import { roleLabel } from './roles.mjs';
import { caseCitations, hasMismatch, jsonBlock, parseTurn, provisionalVote, stripJsonBlock, stripToolCalls } from './turns.mjs';

const DEFAULTS = { members: ['optimist', 'skeptic', 'security'], memberModel: 'sonnet', chairModel: 'opus', moderatorModel: 'sonnet',
  maxTurns: 6, minTurns: 4, lang: 'en', perCallBudgetUsd: 2 };
const OPENING_MS = { claude: 240_000, other: 360_000 }; // Codex explores a codebase first; a real opening took ~4 min.
const MODERATOR_MS = 90_000;
const VERDICT_MS = 300_000;

/** Why the chair produced no verdict, in a form the UI can turn into the right fix. */
export function chairFailure(r) {
  const stderr = (r?.stderr ?? '').trim();
  const cause = r?.timedOut ? 'timeout'
    : /not logged in|log ?in|auth|unauthori[sz]ed|401|credential|api key/i.test(stderr) ? 'auth'
      : /rate.?limit|usage limit|quota|429|overloaded|529/i.test(stderr) ? 'limit'
        : r && r.exitCode !== 0 ? 'exit' : 'empty';
  const e = new Error('The chair did not produce a verdict');
  e.cause = cause;
  e.detail = r?.timedOut ? '' : `${r?.exitCode != null ? `exit ${r.exitCode}` : ''}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`.trim();
  return e;
}

/**
 * The CLIs this case uses, prepared before anything is recorded: a case that cannot start
 * must not leave a "running" row behind. Returns where each adapter runs and a cleanup.
 */
function prepareWorkspace(o, id) {
  const adapters = [...new Set(o.members.map((r) => resolveModel(o.models?.[r] ?? o.memberModel).adapter))];
  const others = adapters.some((a) => a !== claude);
  // Idea mode: non-Claude members run in an empty per-case folder with the idea text in the prompt.
  const sandbox = others && o.mode === 'idea' ? sandboxFor(id) : null;
  if (sandbox) mkdirSync(sandbox, { recursive: true, mode: 0o700 });
  for (const a of adapters) a.prepare?.(o.mode);
  return {
    vendors: adapters.map((a) => a.vendor),
    cwdFor: (adapter) => (o.mode === 'code' ? o.target : adapter !== claude ? sandbox : dirname(o.target)),
    // The sandbox only held throwaway state for non-Claude members; nothing reads it after the case.
    cleanup: () => { if (sandbox) rmSync(sandbox, { recursive: true, force: true }); },
  };
}

/**
 * `deps` swaps the parts that reach outside the process: how CLIs are called, how the target is
 * read, the clock. The defaults are the real ones; tests pass fakes.
 */
export function startCase(store, opts, { createCaller: makeCaller = createCaller, buildContext: contextFor = buildContext, now = Date.now } = {}) {
  const o = { ...DEFAULTS, ...opts, target: resolve(opts.target) };
  const custom = o.custom ?? {};
  const modelOf = (role) => o.models?.[role] ?? o.memberModel;
  const labelOf = (role) => custom[role]?.label ?? roleLabel(role);
  const id = o.id ?? `live-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
  const title = o.title || o.focus || (o.lang === 'tr' ? `${basename(o.target)} değerlendirmesi` : `${basename(o.target)} review`);
  const workspace = prepareWorkspace(o, id);
  store.createCase({ id, title, mode: o.mode, target: o.target, source: 'live' });

  const t0 = now();
  const emit = (type, data) => store.append(id, type, data, now() - t0);
  let stopped = false;
  let ended = false;
  let pendingNote = null; // key of a user note the next turn should answer
  const log = []; // the shared conversation: { key: 'O-role' | 'T<n>' | 'U<k>', role, text }
  const caller = makeCaller({ emit, isStopped: () => stopped, cwdFor: workspace.cwdFor, mode: o.mode, budgetUsd: o.perCallBudgetUsd });
  const { call } = caller;
  const kit = promptKit({ ...o, custom });
  const cite = (t) => caseCitations(stripToolCalls(t), o.mode, o.target);

  async function openings(context, sessions) {
    await Promise.all(o.members.map(async (role) => {
      const vendor = resolveModel(modelOf(role)).adapter.vendor;
      const r = await call(role, openingPrompt(kit, role, context),
        { model: modelOf(role), timeoutMs: vendor === 'claude' ? OPENING_MS.claude : OPENING_MS.other });
      if (!r?.text.trim()) return;
      sessions[role] = r.sessionId;
      const text = stripToolCalls(r.text);
      emit('opening.completed', { role, body: text, vote: provisionalVote(r.text) });
      log.push({ key: `O-${role}`, role, text });
    }));
  }

  /** The moderator's pick for turn n, or { end } when it closes the conversation. */
  async function nextSpeaker(n, turns, spoken) {
    const state = conversationState({ turns, members: o.members, spoken });
    const byRule = rulePick({ n, turns, members: o.members, pendingNote, state });
    if (byRule) return { pick: byRule };
    const r = await call('chair', moderatorPrompt(kit, { n, ...state, pendingNote, log }), { model: o.moderatorModel, tools: 'none', timeoutMs: MODERATOR_MS });
    if (!r) return { stopped: true };
    const parsed = parseModeratorLine(r.text, { n, members: o.members, minTurns: o.minTurns });
    return parsed ?? { pick: quietestPick({ n, turns, members: o.members, spoken }) };
  }

  /** Returns how the conversation ended: 'cap' (turn limit) or 'chair' (the moderator closed it). */
  async function conversation(sessions, seen) {
    const turns = [];
    const spoken = Object.fromEntries(o.members.map((r) => [r, 0]));
    for (let n = 1; n <= o.maxTurns && !stopped; n++) {
      const next = await nextSpeaker(n, turns, spoken);
      if (next.stopped) break;
      if (next.end !== undefined) {
        emit('note', { kind: 'end', code: 'moderator_end', params: { reason: next.end }, text: `Moderator: ${next.end}` });
        return 'chair';
      }
      const { pick } = next;
      pendingNote = null;
      emit('moderator.pick', pick);
      const { role } = pick;
      const fresh = formatLog(log.slice(seen[role]));
      const seenUpTo = log.length;
      emit('turn.started', { n, role, replyTo: pick.replyTo });
      const r = await call(role, turnPrompt(kit, { n, pick, fresh, firstTime: n === 1 || spoken[role] === 0 }),
        { sessionId: sessions[role], model: modelOf(role), onDelta: (text) => emit('turn.delta', { n, text }) });
      if (!r) break;
      if (!r.text.trim()) continue; // noted by call(); the member sees the same log next time
      seen[role] = seenUpTo;
      if (r.sessionId) sessions[role] = r.sessionId;
      const text = stripToolCalls(r.text);
      const { header, body } = parseTurn(text);
      turns.push({ n, role, header, body });
      spoken[role]++;
      log.push({ key: `T${n}`, role, text });
      emit('turn.completed', { n, role, header, body, mismatch: hasMismatch(header.stance, body), citations: cite(body) });
    }
    return 'cap';
  }

  async function closings(sessions, seen) {
    const said = await Promise.all(o.members.map(async (role) => {
      const r = await call(role, closingPrompt(kit, role, formatLog(log.slice(seen[role]))), { sessionId: sessions[role], model: modelOf(role) });
      if (!r) return null;
      emit('closing.completed', { role, body: stripJsonBlock(stripToolCalls(r.text)), vote: jsonBlock(r.text), citations: cite(r.text) });
      return { role, text: r.text };
    }));
    return said.filter(Boolean);
  }

  async function verdict(context, closingTexts) {
    const r = await call('chair', verdictPrompt(kit, { log, closings: closingTexts, context }),
      { model: o.chairModel, tools: o.mode === 'code' ? undefined : 'none', timeoutMs: VERDICT_MS });
    if (stopped) return;
    if (r?.exitCode !== 0 || !r.text.trim()) throw chairFailure(r);
    emit('verdict.completed', { markdown: stripJsonBlock(stripToolCalls(r.text)), chair: jsonBlock(r.text), citations: cite(r.text) });
  }

  async function hearing() {
    emit('case.started', { startedAt: t0, title, mode: o.mode, target: o.target, focus: o.focus ?? null, appealOf: o.appealOf ?? null,
      vendors: [...new Set(['claude', ...workspace.vendors])], maxTurns: o.maxTurns });
    o.members.forEach((role, seat) => {
      emit('member.registered', { role, label: labelOf(role), model: modelOf(role), vendor: resolveModel(modelOf(role)).adapter.vendor, seat,
        ...(custom[role] ? { brief: custom[role].brief } : {}) });
    });
    emit('member.registered', { role: 'chair', label: roleLabel('chair'), model: o.chairModel, vendor: 'claude', seat: o.members.length, chair: true });
    const context = contextFor(o.target, o.mode);
    const sessions = {};
    await openings(context, sessions);
    const seen = Object.fromEntries(o.members.map((r) => [r, 0])); // role -> how much of the log it has seen
    const endedBy = await conversation(sessions, seen);
    if (stopped) return;
    const closingTexts = await closings(sessions, seen);
    if (stopped) return;
    await verdict(context, closingTexts);
    if (!stopped) emit('case.ended', { endedBy });
  }

  // Every case ends with exactly one case.ended and a final status, however it ends.
  const done = hearing()
    .then(() => {
      if (stopped) emit('case.ended', { endedBy: 'stopped' });
      store.setStatus(id, stopped ? 'stopped' : 'done');
    }, (e) => {
      if (stopped) { emit('case.ended', { endedBy: 'stopped' }); store.setStatus(id, 'stopped'); return; }
      emit('note', { kind: 'orchestrator', code: 'error', params: { message: e.message, cause: e.cause ?? 'unknown', detail: e.detail ?? '' }, text: `Error: ${e.message}` });
      emit('case.ended', { endedBy: 'error', cause: e.cause ?? 'unknown' });
      store.setStatus(id, 'failed');
    })
    .finally(() => { ended = true; workspace.cleanup(); })
    // `done` never rejects: a failure while recording the end is logged, not left to crash the server.
    .catch((e) => console.error(`[council] case ${id} could not be finalized: ${e.stack ?? e}`));

  return {
    id,
    done,
    // A note from the person running the hearing joins the shared log: every member sees it
    // on their next turn, the moderator steers the next turn to it, the chair reads it.
    addNote(text) {
      if (stopped || ended) return null;
      const k = log.filter((l) => l.role === 'user').length + 1;
      log.push({ key: `U${k}`, role: 'user', text: `[Note from the person running this hearing: a question or steer, not evidence]\n${text}` });
      pendingNote = `U${k}`;
      return emit('user.note', { k, text });
    },
    stop(reason = 'user') {
      if (stopped) return;
      stopped = true;
      void caller.stopAll(); // a CLI that ignores SIGTERM must not keep a stopped case open
      emit('case.stopped', { reason });
    },
  };
}
