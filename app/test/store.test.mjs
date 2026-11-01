import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openStore, redact } from '../lib/store.mjs';
import { importRun } from '../lib/importer.mjs';

const DEMO = join(dirname(fileURLToPath(import.meta.url)), '../../reports/2026-10-30-council-app');
const withStore = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'council-store-'));
  const store = openStore(join(dir, 'data', 'council.db'));
  try { return fn(store, dir); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
};

test('redact: masks common credential shapes and leaves prose alone', () => {
  const samples = [
    `sk-ant-${'a'.repeat(40)}`, `sk-${'B'.repeat(32)}`, `ghp_${'c'.repeat(36)}`, `github_pat_${'d'.repeat(40)}`,
    `AIza${'e'.repeat(35)}`, `xoxb-${'1'.repeat(24)}`, 'AKIAABCDEFGHIJKLMNOP',
    '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
  ];
  for (const s of samples) assert.equal(redact(`key: ${s} end`), 'key: [REDACTED] end', s.slice(0, 12));
  const prose = 'skeptic says sk-short is fine; see app/server.mjs:42 and AKIA in docs';
  assert.equal(redact(prose), prose);
});

test('store: database folder is 0700 and the file 0600', () => {
  withStore((store) => {
    assert.equal(statSync(dirname(store.path)).mode & 0o777, 0o700);
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
  });
});

test('store: events are numbered, redacted before writing, and replayable after a seq', () => {
  withStore((store) => {
    store.createCase({ id: 'c1', title: 't', mode: 'code', target: '/x', source: 'live' });
    const seen = [];
    store.bus.on('c1', (ev) => seen.push(ev.seq));
    store.append('c1', 'note', { text: `leak ghp_${'z'.repeat(36)}` }, 1);
    store.append('c1', 'note', { text: 'second' }, 2);
    const all = store.events('c1');
    assert.deepEqual(all.map((e) => e.seq), [1, 2]);
    assert.equal(all[0].data.text, 'leak [REDACTED]');
    assert.deepEqual(store.events('c1', 1).map((e) => e.seq), [2]);
    assert.deepEqual(seen, [1, 2]);
    // Nothing unredacted reaches the file either (journal_mode DELETE: commits land in the file).
    assert.ok(!readFileSync(store.path).includes('ghp_zzzz'));
  });
});

test('store: createCase resets earlier events for the same id; status updates', () => {
  withStore((store) => {
    store.createCase({ id: 'c2', title: 't', mode: 'idea', source: 'live' });
    store.append('c2', 'note', {}, 0);
    store.createCase({ id: 'c2', title: 't', mode: 'idea', source: 'live' });
    assert.equal(store.events('c2').length, 0);
    store.setStatus('c2', 'stopped');
    assert.equal(store.getCase('c2').status, 'stopped');
  });
});

test('importer: the bundled demo becomes a complete, path-free case', () => {
  withStore((store) => {
    const { id, events } = importRun(store, DEMO, 'demo-test');
    assert.equal(id, 'demo-test');
    const evs = store.events(id);
    assert.equal(evs.length, events);
    const types = evs.map((e) => e.type);
    assert.equal(types[0], 'case.started');
    assert.equal(types.at(-1), 'case.ended');
    for (const t of ['member.registered', 'opening.completed', 'turn.completed', 'closing.completed', 'verdict.completed']) {
      assert.ok(types.includes(t), t);
    }
    assert.ok(evs.every((e, i) => i === 0 || e.ts >= evs[i - 1].ts), 'timestamps never go back');
    const raw = JSON.stringify(evs);
    assert.ok(!raw.includes(homedir()), 'home path scrubbed');
    assert.ok(!/\/Users\/[^~]/.test(raw), 'no /Users/<name> paths');
    assert.equal(store.getCase(id).status, 'done');
  });
});

test('export: markdown and json carry the whole case, without streaming noise', async () => {
  const { caseMarkdown, caseJson, exportName } = await import('../lib/export.mjs');
  withStore((store) => {
    importRun(store, DEMO, 'demo-export');
    store.append('demo-export', 'user.note', { k: 1, text: 'Focus on install steps.' }, 99_999);
    const c = store.getCase('demo-export');
    const events = store.events('demo-export');
    const md = caseMarkdown(c, events, 'en');
    for (const s of ['## Council', '## Blind openings', '## Conversation', '### T1', '## Closings', '## Verdict']) assert.ok(md.includes(s), s);
    assert.ok(caseMarkdown(c, events, 'tr').includes('## Kör açılışlar'));
    assert.ok(md.includes('> **U1 · Note from the person running the hearing:** Focus on install steps.'));
    const json = caseJson(c, events);
    assert.equal(json.case.id, 'demo-export');
    assert.ok(json.events.every((e) => !['turn.delta', 'turn.started', 'usage'].includes(e.type)));
    assert.ok(json.events.some((e) => e.type === 'case.ended'));
    assert.equal(exportName({ title: 'Yayına hazır mı? Şüpheli: ÇÖZÜM!' }, 'md'), 'yayina-hazir-mi-supheli-cozum.md');
    assert.ok(!exportName({ title: `${'a'.repeat(59)} b c` }, 'md').includes('-.'), 'no dash before the extension');
  });
});

test('follow-up: transcript text, appeal focus and prior summary come from the case', async () => {
  const { transcriptText, appealFocus, priorSummary } = await import('../lib/followup.mjs');
  withStore((store) => {
    importRun(store, DEMO, 'demo-fu');
    store.append('demo-fu', 'user.note', { k: 1, text: 'Focus on install.' }, 99_999);
    const events = store.events('demo-fu');
    const text = transcriptText(events, 1e6);
    for (const s of ['## Opening —', '## T1 —', '## U1 — note from the person running the hearing', '## Closing —', '## Verdict']) assert.ok(text.includes(s), s);
    const short = transcriptText(events, 2000);
    assert.ok(short.startsWith('## Opening —') && short.includes('[middle turns trimmed]'));
    assert.ok(short.endsWith(text.slice(-200)), 'keeps the end of the case');
    assert.match(appealFocus(events, 'tr'), /^Temyiz: /);
    assert.match(appealFocus(events, 'en'), /^Appeal: /);
    assert.ok(appealFocus(events, 'en').length <= 300);
    assert.match(priorSummary(events), /^Earlier verdict: /);
  });
});
