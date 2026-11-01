// Every prompt the council sends, as pure functions of the case. The role briefs and the shared
// protocol are files (.claude/agents/council-*.md, council/protocol.md); this module stitches
// them to the case and the moment. Test fakes key on some literal phrases here ("Round 1",
// "MODERATOR", "Your turn", "closing statement", "Write the verdict"); keep them.
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customBrief } from './roles.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROTOCOL = readFileSync(join(REPO, 'council/protocol.md'), 'utf8');

const fileBrief = (role) => readFileSync(join(REPO, `.claude/agents/council-${role}.md`), 'utf8')
  .replace(/^---[\s\S]*?---\s*/, '');
/** The chair file's "As moderator" section, so the live moderator follows the same rules as the written chair. */
const moderatorBrief = () => (fileBrief('chair').match(/## As moderator[\s\S]*?(?=\n## |$)/)?.[0] ?? '').trim();

/**
 * What every prompt for one case shares. `c` is the case: { mode, target, focus, prior, members,
 * custom, maxTurns, minTurns, lang }.
 */
export function promptKit(c) {
  const custom = c.custom ?? {};
  const language = c.lang === 'tr' ? 'Turkish' : 'English';
  const brief = (role) => (custom[role] ? customBrief(custom[role]) : fileBrief(role));
  // The protocol lists the role keys members may address: this case's bench, custom roles included.
  const protocol = PROTOCOL.replace(/^Role keys:.*$/m, `Role keys: ${c.members.join(', ')}.`);
  const header = [
    `TARGET (${c.mode === 'code' ? 'codebase, read-only' : 'idea'}): ${c.mode === 'idea' ? basename(c.target) : c.target}`,
    c.mode === 'idea' ? `IDEA MODE: you have no file tools and no shell. The whole idea is in this prompt with line numbers; cite it as \`${basename(c.target)}:<line>\`. Do not try to read files, run commands or write tool calls.` : '',
    `FOCUS: ${c.focus || 'General evaluation: is it sound, valuable, worth continuing, and what next?'}`,
    `COUNCIL: ${c.members.map((r) => (custom[r] ? `${r} (${custom[r].label}, a role written by the person running the hearing)` : r)).join(', ')}; the chair moderates and writes the verdict.`,
    c.prior ? `PRIOR HEARING (this is an appeal; argue the open questions, do not just repeat the earlier verdict):\n${c.prior}` : '',
  ].filter(Boolean).join('\n');
  const memberList = c.members.map((r) => (custom[r] ? `${r} (${custom[r].label})` : r)).join(', ');
  return { c, language, brief, protocol, header, memberList, tr: c.lang === 'tr' };
}

/** The shared conversation as text: `## T3 — skeptic` blocks, each optionally cut to `max` characters. */
export const formatLog = (entries, max = Infinity) =>
  entries.map((l) => `## ${l.key} — ${l.role}\n${l.text.slice(0, max)}`).join('\n\n');

export function openingPrompt(kit, role, context) {
  return [
    kit.brief(role), '---', kit.protocol, '---', kit.header, '', '## Shared context', context, '',
    `Round 1 — blind assessment. Nobody has seen anyone else's view. Follow the Round 1 shape, at most 180 words and 3–5 findings. Final message = only your output. Write in ${kit.language}; keep paths, code and JSON keys as-is.`,
    // The headings are for people; the vote words stay as tokens the server parses.
    kit.tr ? 'Use these headings in Turkish: "## <rolün Türkçe adı> — 1. tur", "**Özet:**", "### Bulgular", "### Geçici oy"; write "kanıt:" for evidence, "varsayım" for [assumption] and "önem: yüksek|orta|düşük" for severity. Keep the vote word itself as go, no-go or conditional.' : '',
  ].join('\n');
}

/** `state`: { n, quiet, looping, drift, pendingNote, log }. */
export function moderatorPrompt(kit, { n, quiet, looping, drift, pendingNote, log }) {
  const { c, language } = kit;
  return [
    'You are the MODERATOR of a council conversation. Pick who speaks next and which turn/opening they answer.',
    moderatorBrief(),
    pendingNote ? `The person running this hearing added ${pendingNote}: make the next turn answer it (REPLY_TO: ${pendingNote}).` : '',
    `Members: ${kit.memberList}. Quiet so far: ${quiet.join(', ') || 'none'}.${looping ? ' The last 4 turns alternated between two members: pick someone else.' : ''}${drift ? ' The last 3 turns were all agree/build: point the speaker at a real unresolved clash.' : ''}`,
    `This is T${n} of at most ${c.maxTurns}. You may END only after T${c.minTurns} if positions are stable.`,
    '', formatLog(log, 700), '',
    `Reply with exactly one line: NEXT: <member> REPLY_TO: <T<k> or O-<member>> WHY: <≤15 words, ${language}>  — or —  END: <reason, ${language}>`,
  ].join('\n');
}

export function turnPrompt(kit, { n, pick, fresh, firstTime }) {
  return [
    firstTime ? 'The council is now a live conversation, one member at a time. Follow the protocol\'s "Conversation turn" section.' : '',
    `New in the conversation since you last spoke:\n\n${fresh}`, '',
    `Your turn: T${n}. Reply to ${pick.replyTo} (moderator: ${pick.why}). Start with the three header lines REPLY_TO / ADDRESSES / STANCE (if you ask anyone anything, STANCE question or challenge), then at most 120 words with path:line evidence. Final message = the turn only. Write in ${kit.language}.`,
  ].filter(Boolean).join('\n');
}

export function closingPrompt(kit, role, fresh) {
  return [
    fresh ? `New since you last spoke:\n\n${fresh}\n` : '',
    `The conversation is over. Give your closing statement in the protocol's "Closing statement" shape: 3–5 sentences citing turn numbers, then exactly one fenced JSON block with "role": "${role}". Write in ${kit.language}; JSON keys as-is.`,
  ].join('\n');
}

const VERDICT_SHAPE = {
  tr: '"# Konsey kararı — <name>", "**Karar:** go|no-go|conditional — güven 0.0–1.0", "**Tek satır gerekçe:**", "## Uzlaşma", "## Çözülmemiş ayrılıklar" (keep minority views), "## İlk adımlar" (3, each with evidence), "## Konuşma nasıl ilerledi" (turn numbers).',
  en: '"# Council verdict — <name>", "**Verdict:** go|no-go|conditional — confidence 0.0–1.0", "**One-line reason:**", "## Consensus", "## Unresolved disagreements" (keep minority views), "## First steps" (3, each with evidence), "## How the conversation went" (turn numbers).',
};

export function verdictPrompt(kit, { log, closings, context }) {
  const { c, language } = kit;
  return [
    kit.brief('chair'), '---', kit.header, '',
    c.mode === 'idea'
      ? `The idea itself is below with line numbers (you have no tools); where a disagreement turns on a citation, check it against these lines.\n${context}`
      : 'The conversation and closings are below. Where a disagreement turns on a citation, open the cited lines yourself.',
    '', formatLog(log), '', closings.map((x) => `## Closing — ${x.role}\n${x.text}`).join('\n\n'), '',
    `Write the verdict in ${language}, in this shape: ${kit.tr ? VERDICT_SHAPE.tr : VERDICT_SHAPE.en} Then exactly one fenced JSON block: {"verdict","confidence","reason","consensus":[],"disagreements":[{"topic","positions":[{"role","position"}],"chair_read"}],"actions":[]}. Final message = the verdict only.`,
  ].join('\n');
}
