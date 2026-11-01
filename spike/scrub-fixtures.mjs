#!/usr/bin/env node
// Scrub personal/environment data from spike fixtures in place, so they can be committed.
// - drops `rate_limit_event` lines (account quota/overage state)
// - blanks installed plugins/skills/agents/slash command lists in Claude `system/init`
// - replaces home, scratchpad, TMPDIR paths and the user name with placeholders
// - replaces every session/thread/message UUID with a stable placeholder (the same id maps
//   to the same placeholder in every file, so resumed turns still point at their session)
// - replaces Anthropic msg_/req_/toolu_ ids the same way
// Idempotent; run after every new capture:  node spike/scrub-fixtures.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir, userInfo, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const USER = userInfo().username;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATHS = [
  [/\/private\/tmp\/claude-\d+\/[^/"\s]+\/[0-9a-f-]{36}\/scratchpad/g, '<SCRATCH>'],
  [new RegExp(escapeRe(tmpdir().replace(/\/$/, '')), 'g'), '<TMPDIR>'],
  [new RegExp(escapeRe(homedir()), 'g'), '<HOME>'],
  // Claude's transcript dirs encode paths with dashes (-Users-<user>-...).
  [/-private-tmp-claude-\d+-+Users-[^/"\s]*?-scratchpad/g, '<SCRATCH-SLUG>'],
  [new RegExp(escapeRe(USER), 'g'), '<user>'],
  // Event-type lists in summary.json still name the dropped events.
  [/rate_limit_event/g, '<scrubbed_event>'],
];
const INIT_LISTS = ['plugins', 'skills', 'agents', 'slash_commands', 'terminal_slash_commands'];

// Real ids could be matched to the account's local session history; placeholders keep the
// structure (version nibble 4, so they still look like UUIDs) without the link. Already
// scrubbed ids (00000000-0000-4000-8000-…) are left alone, so this stays idempotent.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PLACEHOLDER = /^00000000-0000-4000-8000-\d{12}$/;
const ids = new Map();
const scrubIds = (s) => s.replace(UUID, (id) => {
  if (PLACEHOLDER.test(id)) return id;
  const key = id.toLowerCase();
  if (!ids.has(key)) ids.set(key, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
  return ids.get(key);
});
// Anthropic message, request and tool-use ids name a specific API call; same treatment.
const API_ID = /\b(msg|req|toolu)_(?!scrubbed)[A-Za-z0-9]{12,}\b/g;
const apiIds = new Map();
const scrubApiIds = (s) => s.replace(API_ID, (id, kind) => {
  if (!apiIds.has(id)) apiIds.set(id, `${kind}_scrubbed${String(apiIds.size + 1).padStart(4, '0')}`);
  return apiIds.get(id);
});
const scrubText = (s) => scrubApiIds(scrubIds(PATHS.reduce((acc, [re, to]) => acc.replace(re, to), s)));
function scrubEvent(ev) {
  if (ev.type === 'rate_limit_event') return null;
  if (ev.type === 'system' && ev.subtype === 'init') {
    for (const k of INIT_LISTS) if (k in ev) ev[k] = '<scrubbed>';
  }
  return ev;
}

// Sorted, so the numbering of placeholders is the same on every run.
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

let changed = 0;
for (const file of walk(ROOT)) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  if (file.endsWith('.jsonl')) {
    after = before.split('\n').map((line) => {
      if (!line.trim()) return line;
      try {
        const ev = scrubEvent(JSON.parse(line));
        return ev === null ? null : JSON.stringify(ev);
      } catch { return line; }
    }).filter((l) => l !== null).join('\n');
  }
  after = scrubText(after);
  if (after !== before) { writeFileSync(file, after); changed++; }
}
console.log(`scrubbed ${changed} file(s) under ${ROOT}`);
