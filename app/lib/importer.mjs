// Import a finished /council run folder (reports/<date>-<name>/) as a replayable
// case: openings, moderator picks, turns, closings and the chair verdict become
// events with synthetic timing. Absolute home paths are scrubbed on the way in.
//
// usage: node lib/importer.mjs <run-dir> [case-id]
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { roleLabel } from './roles.mjs';
import { parseTurn, hasMismatch, citations, primaryReply, jsonBlock, stripJsonBlock, provisionalVote } from './turns.mjs';


const scrub = (s) => s.replaceAll(homedir(), '~').replace(/\/Users\/[^/\s`"]+/g, '~');
const read = (p) => scrub(readFileSync(p, 'utf8'));

// Split conversation.md into ordered blocks: moderator picks, turns, notes.
function conversationBlocks(md) {
  const after = md.split(/^# Conversation\s*$/m)[1] ?? '';
  const blocks = [];
  let cur = null;
  for (const line of after.split('\n')) {
    const turn = line.match(/^## T(\d+) — (\S+)/);
    const mod = line.match(/^> Moderator(?: \(T(\d+)\))?:\s*(.+)$/);
    const note = line.match(/^> Orchestrator[^:]*:\s*(.*)$/);
    if (turn) { cur = { kind: 'turn', n: Number(turn[1]), role: turn[2], text: '' }; blocks.push(cur); }
    else if (mod) { cur = null; blocks.push({ kind: 'mod', n: mod[1] ? Number(mod[1]) : null, text: mod[2] }); }
    else if (note) { cur = { kind: 'note', text: note[1] }; blocks.push(cur); }
    else if (cur?.kind === 'note' && line.startsWith('>')) cur.text += `\n${line.replace(/^>\s?/, '')}`;
    else if (cur?.kind === 'turn') cur.text += `${line}\n`;
    else if (!line.startsWith('>')) cur = null;
  }
  return blocks;
}

function chunks(text, words = 6) {
  const parts = text.split(/(\s+)/);
  const out = [];
  for (let i = 0; i < parts.length; i += words * 2) out.push(parts.slice(i, i + words * 2).join(''));
  return out;
}

export function importRun(store, runDir, caseId) {
  runDir = resolve(runDir);
  const council = JSON.parse(read(join(runDir, 'council.json')));
  const repoRoot = resolve(runDir, '../..');
  const roots = [repoRoot, runDir, join(runDir, 'cli-help')];
  const id = caseId ?? `import-${basename(runDir)}`;
  const title = council.focus ?? basename(runDir);
  store.createCase({ id, title, mode: 'idea', target: scrub(council.target ?? ''), source: 'import' });
  let ts = 0;
  const emit = (type, data, gap = 0) => { ts += gap; store.append(id, type, data, ts); };

  emit('case.started', { title, mode: 'idea', target: scrub(council.target ?? ''), focus: council.focus,
    vendors: ['claude'], maxTurns: council.turns ?? 18, date: council.date });
  council.roster.forEach((m, seat) => {
    emit('member.registered', { role: m.role, label: roleLabel(m.role), model: m.model, vendor: 'claude', seat });
  });
  emit('member.registered', { role: 'chair', label: roleLabel('chair'), model: council.chair_model, vendor: 'claude', seat: council.roster.length, chair: true });

  // Openings ran in parallel; they land a few hundred ms apart.
  for (const m of council.roster) {
    const body = read(join(runDir, 'round1', `${m.role}.md`)).trim();
    emit('opening.completed', { role: m.role, body, vote: provisionalVote(body) }, 700);
  }

  let pendingPick = null;
  for (const b of conversationBlocks(read(join(runDir, 'conversation.md')))) {
    if (b.kind === 'mod') {
      const m = b.text.match(/NEXT:\s*(\S+)\s+REPLY_TO:\s*(\S+)\s+WHY:\s*(.+)/);
      if (m) pendingPick = { n: b.n, role: m[1], replyTo: m[2], why: m[3].trim(), source: 'chair' };
      else if (/^END/.test(b.text)) emit('note', { text: b.text.replace(/^END[:\s—-]*/, 'Moderatör: '), kind: 'end' }, 600);
    } else if (b.kind === 'note') {
      emit('note', { text: b.text.trim(), kind: 'orchestrator' }, 400);
    } else if (b.kind === 'turn') {
      const { header, body } = parseTurn(b.text.trim());
      const replyTo = primaryReply(header.replyTo);
      const pick = pendingPick ?? { n: b.n, role: b.role, replyTo, why: 'Doğrudan cevap hakkı', source: 'rule' };
      pendingPick = null;
      emit('moderator.pick', pick, 900);
      emit('turn.started', { n: b.n, role: b.role, replyTo }, 500);
      for (const c of chunks(body)) emit('turn.delta', { n: b.n, text: c }, 90);
      emit('turn.completed', { n: b.n, role: b.role, header, body,
        mismatch: hasMismatch(header.stance, body), citations: citations(body, roots) }, 200);
    }
  }

  const closingDir = join(runDir, 'closing');
  for (const m of council.roster) {
    const p = join(closingDir, `${m.role}.md`);
    if (!existsSync(p)) continue;
    const text = read(p);
    emit('closing.completed', { role: m.role, body: stripJsonBlock(text), vote: jsonBlock(text),
      citations: citations(text, roots) }, 600);
  }
  emit('verdict.completed', { markdown: read(join(runDir, 'chair.md')), chair: council.chair }, 1500);
  emit('case.ended', { endedBy: council.ended_by ?? 'cap' }, 300);
  store.setStatus(id, 'done');
  return { id, events: store.events(id).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../../reports/2026-10-30-council-app');
  const store = openStore();
  console.log(importRun(store, runDir, process.argv[3]), '→', store.path);
}
