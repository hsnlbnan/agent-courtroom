// "What next" after a finished case. Two kinds are a short chair-led analysis
// that reads the whole transcript (new ideas, risks to test next); the third,
// an appeal, opens a new case on the same target that argues the unresolved
// disagreements, with the earlier verdict as context.
import { dirname } from 'node:path';
import { claude } from '../adapters/claude.mjs';
import { terminate } from '../adapters/process.mjs';
import { run } from '../adapters/run.mjs';
import { customRoles } from './roles.mjs';
import { caseCitations, dataOf as of, stripJsonBlock, stripToolCalls } from './turns.mjs';

/** The case as one text the chair can read: openings, turns, notes, closings, verdict. */
export function transcriptText(events, max = 120_000) {
  const name = (role) => of(events, 'member.registered').find((m) => m.role === role)?.label ?? role;
  const parts = [];
  for (const e of events) {
    const d = e.data;
    if (e.type === 'opening.completed') parts.push(`## Opening — ${name(d.role)}\n${d.body}`);
    else if (e.type === 'turn.completed') parts.push(`## T${d.n} — ${name(d.role)} (${d.header?.stance ?? '?'} → ${d.header?.replyTo ?? '?'})\n${d.body}`);
    else if (e.type === 'user.note') parts.push(`## U${d.k} — note from the person running the hearing\n${d.text}`);
    else if (e.type === 'closing.completed') parts.push(`## Closing — ${name(d.role)} (${d.vote?.vote ?? '?'} ${d.vote?.confidence ?? ''})\n${d.body}`);
    else if (e.type === 'verdict.completed') parts.push(`## Verdict\n${d.markdown}`);
  }
  const text = parts.join('\n\n');
  // A long case keeps its start (blind openings) and its end (closings, verdict).
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.3);
  return `${text.slice(0, head)}\n\n[middle turns trimmed]\n\n…${text.slice(-(max - head))}`;
}

/** Short context for an appeal: the earlier verdict, its open disagreements and first steps. */
export function priorSummary(events) {
  const v = of(events, 'verdict.completed')[0];
  if (!v) return '';
  const c = v.chair ?? {};
  const lines = [`Earlier verdict: ${c.verdict ?? '?'} (confidence ${c.confidence ?? '?'}). ${c.reason ?? ''}`];
  for (const d of c.disagreements ?? []) {
    lines.push(`Open: ${d.topic}${d.chair_read ? ` — chair: ${d.chair_read}` : ''}`);
    for (const p of d.positions ?? []) lines.push(`  - ${p.role}: ${p.position}`);
  }
  for (const s of c.first_steps ?? c.actions ?? []) lines.push(`Step: ${s}`);
  return lines.join('\n').slice(0, 3000);
}

/** The appeal's question: the unresolved disagreements, or the verdict itself if none are recorded. */
export function appealFocus(events, lang) {
  const c = of(events, 'verdict.completed')[0]?.chair ?? {};
  const topics = (c.disagreements ?? []).map((d) => d.topic).filter(Boolean);
  const head = lang === 'tr' ? 'Temyiz' : 'Appeal';
  const body = topics.length ? topics.join(' · ') : (lang === 'tr' ? `Önceki karar (${c.verdict ?? '?'}) doğru mu?` : `Was the earlier verdict (${c.verdict ?? '?'}) right?`);
  return `${head}: ${body}`.slice(0, 300);
}

const ASK = {
  ideas: 'From this hearing, propose new directions the council did not fully explore: 3–5 ideas or alternatives. For each: one line on what it is, why the debate points to it (cite turn numbers like T3 or files as path:line), and the smallest experiment that would test it.',
  risks: 'From this hearing, list the 3–5 risks most worth testing next, most dangerous first. For each: what could go wrong, what in the debate or the files suggests it (cite turn numbers or path:line), and a concrete check that would confirm or rule it out, with a pass/fail signal.',
};

/** Run one chair-led analysis over a finished case. Resolves to { markdown, ms } or throws. */
export async function runAnalysis({ kind, events, mode, target, cwd, lang, model = 'opus', timeoutMs = 240_000 }) {
  if (!ASK[kind]) throw new Error(`unknown analysis: ${kind}`);
  const language = lang === 'tr' ? 'Turkish' : 'English';
  const prompt = [
    'You are the chair of a council of coding agents. The hearing below has ended. You now advise the person who ran it.',
    `TARGET (${mode === 'code' ? 'codebase, read-only' : 'idea'}): ${target}`,
    mode === 'code' ? 'You may open cited files (read-only) to check a claim.' : 'You have no tools; everything you need is below.',
    '', '--- HEARING ---', transcriptText(events), '--- END ---', '',
    ASK[kind],
    `Write in ${language}, as Markdown: a one-line summary, then a numbered list. No preamble.`,
  ].join('\n');
  const { child, done } = run(claude, { prompt, model, cwd, mode });
  const timer = setTimeout(() => void terminate(child, 3000), timeoutMs);
  const r = await done.finally(() => clearTimeout(timer));
  const text = stripToolCalls(stripJsonBlock(r.text ?? ''));
  if (r.exitCode !== 0 || !text) throw new Error(r.exitCode === null ? 'timed out' : `chair CLI exited ${r.exitCode}`);
  return { markdown: text, ms: r.ms };
}

/**
 * The options for an appeal: the same target and bench as the finished case, arguing its open
 * questions with the earlier verdict as context. `usable(model)` says whether a member's model
 * would pass a new case today (a provider may have been turned off since).
 */
export function appealOptions(c, events, { target, lang, usable, claudeModels }) {
  const bench = of(events, 'member.registered');
  const members = bench.filter((m) => !m.chair && m.role !== 'chair').map((m) => m.role);
  const models = Object.fromEntries(bench.filter((m) => !m.chair && usable(m.model)).map((m) => [m.role, m.model]));
  const chairModel = bench.find((m) => m.chair || m.role === 'chair')?.model;
  return {
    target, mode: c.mode, focus: appealFocus(events, lang), maxTurns: 6, minTurns: 3, members, models, lang,
    chairModel: claudeModels.includes(chairModel) ? chairModel : 'opus',
    prior: priorSummary(events), appealOf: c.id,
    // Custom roles travel with the case, so the appeal hears the same members.
    custom: customRoles(bench.filter((m) => m.brief).map((m) => ({ key: m.role, label: m.label, brief: m.brief }))),
  };
}

/** Follow-up kinds: an analysis written onto the case, or a new case. One entry per kind. */
export const FOLLOWUPS = {
  ideas: { type: 'analysis' },
  risks: { type: 'analysis' },
  appeal: { type: 'case' },
};

/**
 * Analyses on finished cases: at most one of each kind per case at a time, each recorded as
 * followup.started → followup.completed | followup.failed on the case.
 */
export function createAnalyses(store, analyse = runAnalysis) {
  const running = new Set();
  return {
    isRunning: (id, kind) => running.has(`${id}:${kind}`),
    async run(c, kind, lang) {
      const key = `${c.id}:${kind}`;
      running.add(key);
      const startedAt = Date.now();
      const events = store.events(c.id);
      const t0 = events.at(-1)?.ts ?? 0;
      store.append(c.id, 'followup.started', { kind }, t0 + 1);
      try {
        const mode = c.mode === 'idea' ? 'idea' : 'code';
        const r = await analyse({ kind, events, mode, target: c.target, cwd: mode === 'code' ? c.target : dirname(c.target), lang });
        const citations = c.target ? caseCitations(r.markdown, mode, c.target) : [];
        store.append(c.id, 'followup.completed', { kind, markdown: r.markdown, ms: r.ms, citations }, t0 + 2);
        return { kind, markdown: r.markdown, citations, ms: Date.now() - startedAt };
      } catch (e) {
        store.append(c.id, 'followup.failed', { kind, message: e.message }, t0 + 2);
        throw e;
      } finally { running.delete(key); }
    },
  };
}
