// SQLite event store. Lives outside the repo (~/.agent-council/council.db) with
// owner-only permissions, because transcripts can contain what agents read.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';

const DEFAULT_DB = join(homedir(), '.agent-council', 'council.db');

// Last line of defense: mask obvious credential shapes before anything is stored or streamed.
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-(?:ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g,
];
export const redact = (s) => SECRET_SHAPES.reduce((acc, re) => acc.replace(re, '[REDACTED]'), s);

export function openStore(path = process.env.COUNCIL_DB ?? DEFAULT_DB) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 });
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY, title TEXT, mode TEXT, target TEXT,
      source TEXT, status TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS events (
      case_id TEXT, seq INTEGER, ts INTEGER, type TEXT, data TEXT,
      PRIMARY KEY (case_id, seq));`);
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const q = {
    insertCase: db.prepare('INSERT OR REPLACE INTO cases VALUES (?,?,?,?,?,?,?)'),
    setStatus: db.prepare('UPDATE cases SET status = ? WHERE id = ?'),
    listCases: db.prepare('SELECT * FROM cases ORDER BY created_at DESC'),
    getCase: db.prepare('SELECT * FROM cases WHERE id = ?'),
    nextSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM events WHERE case_id = ?'),
    insertEvent: db.prepare('INSERT INTO events VALUES (?,?,?,?,?)'),
    events: db.prepare('SELECT seq, ts, type, data FROM events WHERE case_id = ? AND seq > ? ORDER BY seq'),
    deleteEvents: db.prepare('DELETE FROM events WHERE case_id = ?'),
  };

  return {
    path,
    bus,
    createCase({ id, title, mode, target, source }) {
      q.deleteEvents.run(id);
      q.insertCase.run(id, title, mode, target ?? '', source, 'running', Date.now());
    },
    setStatus: (id, status) => q.setStatus.run(status, id),
    listCases: () => q.listCases.all(),
    getCase: (id) => q.getCase.get(id),
    append(caseId, type, data, ts) {
      const seq = q.nextSeq.get(caseId).n;
      const json = redact(JSON.stringify(data));
      const ev = { seq, ts, type, data: JSON.parse(json) };
      q.insertEvent.run(caseId, seq, ts, type, json);
      bus.emit(caseId, ev);
      return ev;
    },
    events: (caseId, afterSeq = 0) =>
      q.events.all(caseId, afterSeq).map((r) => ({ ...r, data: JSON.parse(r.data) })),
    close: () => db.close(),
  };
}
