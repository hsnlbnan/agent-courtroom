// Parsing helpers for council turns: the REPLY_TO / ADDRESSES / STANCE header,
// the stance–text mismatch flag, and `path:line` citation checks.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';


export function parseTurn(text) {
  const get = (k) => (text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'mi')) ?? [])[1]?.trim() ?? null;
  const header = {
    replyTo: get('REPLY_TO'),
    addresses: get('ADDRESSES'),
    stance: get('STANCE')?.toLowerCase().split(/[\s|]/)[0] ?? null,
  };
  const body = text.replace(/^\s*(REPLY_TO|ADDRESSES|STANCE):.*$\n?/gim, '').trim();
  return { header, body };
}

// Primary reply target: "T6 | O-security" -> "T6".
export function primaryReply(replyTo) {
  return replyTo?.split('|')[0].trim() || null;
}

export function hasMismatch(stance, body) {
  return /\?/.test(body) && !['question', 'challenge'].includes(stance);
}

const CITE = /`([\w./@-]+\.[\w]+):(\d+)(?:-(\d+))?/g;

// roots: one directory or a list; a citation is verified if it resolves in any.
export function citations(body, roots) {
  const rootList = [roots].flat().filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(CITE)) {
    const ref = `${m[1]}:${m[2]}${m[3] ? `-${m[3]}` : ''}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const last = Number(m[3] ?? m[2]);
    let verified = verifyAny(m[1], last, rootList);
    // Agents often cite a file by its name or the end of its path (`ci.yml:30`, `cli-help/codex.txt:5`).
    // If that matches one file in the target, check the lines there; an ambiguous match stays unverified.
    let resolved;
    if (verified === false && !m[1].startsWith('/') && !m[1].includes('..')) {
      for (const r of rootList) {
        const hits = filesNamed(r, m[1].split('/').at(-1)).filter((p) => p === m[1] || p.endsWith(`/${m[1]}`));
        if (hits.length === 1) { resolved = hits[0]; verified = verify(hits[0], last, r); break; }
      }
    }
    out.push({ ref, path: m[1], line: Number(m[2]), verified, ...(resolved ? { resolved } : {}) });
  }
  return out;
}

// Bounded caches for a long-running server: line counts keyed by file and mtime (an edited file
// is counted again), and a file-name index per target that is rebuilt after a minute.
const CACHE_MAX = 2000;
const INDEX_TTL_MS = 60_000;
const lineCounts = new Map(); // `${abs}:${mtimeMs}` -> lines
const remember = (map, key, value) => {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'build', 'coverage']);
const nameIndex = new Map(); // root -> { at, index: Map(name -> [relative paths]) }

/** Relative paths of files with this exact name under root (a bounded walk, indexed once per root). */
function filesNamed(root, name) {
  const cached = nameIndex.get(root);
  if (!cached || Date.now() - cached.at > INDEX_TTL_MS) {
    const index = new Map();
    let budget = 20_000;
    const walk = (dir, depth) => {
      if (depth > 8 || budget <= 0) return;
      let entries;
      try { entries = readdirSync(resolve(root, dir), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (--budget <= 0) return;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(rel, depth + 1);
        else if (e.isFile()) index.set(e.name, [...(index.get(e.name) ?? []), rel]);
      }
    };
    walk('', 0);
    remember(nameIndex, root, { at: Date.now(), index });
  }
  return nameIndex.get(root).index.get(name) ?? [];
}

function verifyAny(path, lastLine, roots) {
  if (!roots.length) return null;
  return roots.some((r) => verify(path, lastLine, r));
}

function verify(path, lastLine, root) {
  if (!root) return null;
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return false; // outside the target
  if (!existsSync(abs)) return false;
  const st = statSync(abs);
  if (!st.isFile()) return false;
  const key = `${abs}:${st.mtimeMs}`;
  const lines = lineCounts.get(key) ?? remember(lineCounts, key, readFileSync(abs, 'utf8').split('\n').length);
  return lastLine <= lines;
}

// Last fenced ```json block in a text, parsed, or null.
export function jsonBlock(text) {
  const blocks = [...text.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g)];
  if (!blocks.length) return null;
  try { return JSON.parse(blocks.at(-1)[1]); } catch { return null; }
}

/** Citations as a case checks them: under the codebase in code mode; in idea mode only the
 * idea file itself counts, since members saw nothing else. Shared by verdicts and follow-ups. */
export function caseCitations(text, mode, target) {
  const root = mode === 'code' ? target : dirname(target);
  return citations(text, root).map((c) => (mode === 'idea' && c.path !== basename(target) ? { ...c, verified: false } : c));
}

/** The data of every event of one type, in order. */
export const dataOf = (events, type) => events.filter((e) => e.type === type).map((e) => e.data);

/** A model without tools sometimes writes tool calls as text; never show or store those. */
export const stripToolCalls = (t) => String(t ?? '').replace(/<invoke[\s\S]*?<\/invoke>\s*/g, '').replace(/<\/?function_calls>\s*/g, '').trim();

export function stripJsonBlock(text) {
  return text.replace(/```json\s*\{[\s\S]*?\}\s*```\s*$/m, '').trim();
}

// Provisional vote from a round-1 text: the first go/no-go/conditional after a
// "vote"/"oy" heading (or anywhere), plus the first 0.x number on that line.
export function provisionalVote(text) {
  const lines = text.split('\n');
  const start = Math.max(0, lines.findIndex((l) => /^#+.*(vote|oy)\b/i.test(l)));
  for (const l of lines.slice(start)) {
    const v = l.match(/\b(no-go|go|conditional|koşullu)\b/i);
    if (!v) continue;
    const c = l.match(/\b(0?\.\d+|1\.0+|[01])\b/);
    const vote = v[1].toLowerCase() === 'koşullu' ? 'conditional' : v[1].toLowerCase();
    return { vote, confidence: c ? Number(c[1]) : null };
  }
  return null;
}
