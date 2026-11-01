import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { startCase, chairFailure } from '../lib/orchestrator.mjs';
import { caseCitations } from '../lib/turns.mjs';
import { customRoles } from '../lib/roles.mjs';

// A fake `claude` that never answers, so the case is still in its openings when stopped.
function withHangingClaude() {
  const bin = mkdtempSync(join(homedir(), '.council-test-bin-'));
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nsleep 30\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  return () => { process.env.PATH = old; rmSync(bin, { recursive: true, force: true }); };
}

test('stop: a stopped case ends with exactly one case.ended (endedBy: stopped)', async () => {
  const restore = withHangingClaude();
  const target = mkdtempSync(join(homedir(), '.council-test-target-'));
  mkdirSync(join(target, 'src'));
  writeFileSync(join(target, 'README.md'), '# test\n');
  const events = [];
  let status = 'running';
  const store = { createCase() {}, append: (_id, type, data) => events.push({ type, data }), setStatus: (_id, s) => { status = s; } };
  try {
    const h = startCase(store, { target, mode: 'code', members: ['optimist', 'skeptic'], maxTurns: 1, minTurns: 1 });
    await new Promise((r) => setTimeout(r, 300));
    h.stop('test');
    await h.done;
    const types = events.map((e) => e.type);
    assert.equal(types.filter((t) => t === 'case.stopped').length, 1);
    const ended = events.filter((e) => e.type === 'case.ended');
    assert.equal(ended.length, 1);
    assert.equal(ended[0].data.endedBy, 'stopped');
    assert.equal(types.at(-1), 'case.ended');
    assert.equal(status, 'stopped');
  } finally { restore(); rmSync(target, { recursive: true, force: true }); }
});

// The scripted fake from fixtures/, installed as `claude` in a temp bin folder.
function withScriptedClaude() {
  const bin = mkdtempSync(join(homedir(), '.council-test-bin-'));
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs'), join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  return { log: join(bin, 'prompts.log'), restore: () => { process.env.PATH = old; rmSync(bin, { recursive: true, force: true }); } };
}

test('note: a note from the user reaches the moderator, the next speaker and the chair', async () => {
  const { log, restore } = withScriptedClaude();
  const target = mkdtempSync(join(homedir(), '.council-test-target-'));
  writeFileSync(join(target, 'README.md'), '# test\n');
  const events = [];
  let h;
  const store = { createCase() {}, append: (_id, type, data) => {
    const ev = { seq: events.length + 1, type, data }; events.push(ev);
    // A second note right after T1, which challenged a member: it must still steer T2.
    if (type === 'turn.completed' && data.n === 1) h.addNote('Second note: cover pricing.');
    return ev;
  }, setStatus() {} };
  try {
    h = startCase(store, { target, mode: 'code', members: ['optimist', 'skeptic'], maxTurns: 2, minTurns: 1, models: { optimist: 'haiku', skeptic: 'haiku' } });
    await new Promise((r) => setTimeout(r, 200)); // still in the openings
    const ev = h.addNote('Please focus on the install steps.');
    assert.equal(ev.type, 'user.note');
    await h.done;
    const prompts = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const mod = prompts.find((p) => p.includes('MODERATOR'));
    assert.match(mod, /added U1: make the next turn answer it/);
    assert.match(mod, /focus on the install steps/);
    const turn = prompts.find((p) => p.includes('Your turn: T1'));
    assert.match(turn, /## U1 — user\n\[Note from the person running this hearing/);
    assert.match(prompts.find((p) => p.includes('Write the verdict')), /focus on the install steps/);
    assert.equal(events.find((e) => e.type === 'moderator.pick').data.replyTo, 'U1');
    const picks = events.filter((e) => e.type === 'moderator.pick');
    assert.equal(picks[1].data.source, 'chair', 'the reply rule must not pre-empt a pending note');
    assert.ok(prompts.some((p) => p.includes('MODERATOR') && /added U2/.test(p)));
    assert.equal(h.addNote('too late'), null);
    assert.equal(events.at(-1).type, 'case.ended');
  } finally { restore(); rmSync(target, { recursive: true, force: true }); }
});

test('idea mode: an idea.md target is cited and verified as idea.md:<line>', async () => {
  const { restore } = withScriptedClaude();
  const dir = mkdtempSync(join(homedir(), '.council-test-idea-'));
  writeFileSync(join(dir, 'idea.md'), '# Idea\nA marketplace.\n');
  const events = [];
  const store = { createCase() {}, append: (_id, type, data) => { const ev = { seq: events.length + 1, type, data }; events.push(ev); return ev; }, setStatus() {} };
  try {
    const h = startCase(store, { target: join(dir, 'idea.md'), mode: 'idea', members: ['optimist', 'skeptic'], maxTurns: 1, minTurns: 1, models: { optimist: 'haiku', skeptic: 'haiku' } });
    await h.done;
    const turn = events.find((e) => e.type === 'turn.completed');
    assert.deepEqual(turn.data.citations.map((c) => [c.ref, c.verified]), [['idea.md:1', true]]);
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('failure: a signed-out judge ends the case with cause auth and the CLI message as detail', async () => {
  const { restore } = withScriptedClaude();
  const dir = mkdtempSync(join(homedir(), '.council-test-fail-'));
  writeFileSync(join(dir, 'idea.md'), '# Idea\nA marketplace.\n');
  const events = [];
  let status;
  const store = { createCase() {}, append: (_id, type, data) => { const ev = { seq: events.length + 1, type, data }; events.push(ev); return ev; }, setStatus: (_id, s) => { status = s; } };
  try {
    const h = startCase(store, { target: join(dir, 'idea.md'), mode: 'idea', focus: 'FAIL_VERDICT_AUTH', members: ['optimist', 'skeptic'], maxTurns: 1, minTurns: 1, models: { optimist: 'haiku', skeptic: 'haiku' } });
    await h.done;
    const ended = events.filter((e) => e.type === 'case.ended');
    assert.deepEqual(ended.map((e) => e.data), [{ endedBy: 'error', cause: 'auth' }]);
    const note = events.find((e) => e.type === 'note' && e.data.code === 'error');
    assert.equal(note.data.params.cause, 'auth');
    assert.match(note.data.params.detail, /exit 1: Invalid API key/);
    assert.equal(status, 'failed');
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('failure: the cause is read from how the judge failed', () => {
  assert.equal(chairFailure({ timedOut: true, exitCode: null, stderr: '' }).cause, 'timeout');
  assert.equal(chairFailure({ exitCode: 1, stderr: 'Not logged in' }).cause, 'auth');
  assert.equal(chairFailure({ exitCode: 1, stderr: 'Claude usage limit reached' }).cause, 'limit');
  assert.equal(chairFailure({ exitCode: 1, stderr: 'API Error: 529 overloaded' }).cause, 'limit');
  assert.equal(chairFailure({ exitCode: 2, stderr: 'segfault' }).cause, 'exit');
  assert.equal(chairFailure({ exitCode: 0, stderr: '', text: '' }).cause, 'empty');
  assert.equal(chairFailure(null).cause, 'empty');
});

test('turkish case: openings are asked for Turkish headings, vote words stay as tokens', async () => {
  const { log, restore } = withScriptedClaude();
  const dir = mkdtempSync(join(homedir(), '.council-test-tr-'));
  writeFileSync(join(dir, 'idea.md'), '# Fikir\nBir pazar yeri.\n');
  const store = { createCase() {}, append: (_id, type, data) => ({ type, data }), setStatus() {} };
  try {
    await startCase(store, { target: join(dir, 'idea.md'), mode: 'idea', lang: 'tr', members: ['optimist', 'skeptic'], maxTurns: 1, minTurns: 1, models: { optimist: 'haiku', skeptic: 'haiku' } }).done;
    const openings = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((p) => p.includes('Round 1'));
    assert.equal(openings.length, 2);
    for (const p of openings) {
      assert.match(p, /1\. tur/);
      assert.match(p, /### Geçici oy/);
      assert.match(p, /go, no-go or conditional/);
      assert.match(p, /önem: yüksek\|orta\|düşük/);
    }
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('citations: in idea mode only the idea file verifies; code mode checks the codebase', () => {
  const dir = mkdtempSync(join(homedir(), '.council-test-cite-'));
  writeFileSync(join(dir, 'idea.md'), 'one\ntwo\n');
  writeFileSync(join(dir, 'other.md'), 'x\n');
  try {
    const idea = caseCitations('See `idea.md:2` and `other.md:1`.', 'idea', join(dir, 'idea.md'));
    assert.deepEqual(idea.map((c) => [c.ref, c.verified]), [['idea.md:2', true], ['other.md:1', false]]);
    const code = caseCitations('See `other.md:1` and `idea.md:9`.', 'code', dir);
    assert.deepEqual(code.map((c) => [c.ref, c.verified]), [['other.md:1', true], ['idea.md:9', false]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('citations: a bare file name resolves when it is one file in the target, not when it is ambiguous', () => {
  const dir = mkdtempSync(join(homedir(), '.council-test-bare-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(dir, 'a'));
  mkdirSync(join(dir, 'b'));
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'a\nb\nc\n');
  writeFileSync(join(dir, 'a', 'index.js'), 'x\n');
  writeFileSync(join(dir, 'b', 'index.js'), 'y\n');
  try {
    const c = caseCitations('`ci.yml:2-3`, `ci.yml:9`, `index.js:1` and `workflows/ci.yml:1`.', 'code', dir);
    assert.deepEqual(c.map((x) => [x.ref, x.verified, x.resolved ?? null]), [
      ['ci.yml:2-3', true, '.github/workflows/ci.yml'],
      ['ci.yml:9', false, '.github/workflows/ci.yml'],
      ['index.js:1', false, null],
      ['workflows/ci.yml:1', true, '.github/workflows/ci.yml'],
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('custom roles: their lens reaches the member, the roster and the protocol keys; the label is registered', async () => {
  const { log, restore } = withScriptedClaude();
  const dir = mkdtempSync(join(homedir(), '.council-test-custom-'));
  writeFileSync(join(dir, 'idea.md'), '# Idea\nA marketplace.\n');
  const events = [];
  const store = { createCase() {}, append: (_id, type, data) => { const ev = { seq: events.length + 1, type, data }; events.push(ev); return ev; }, setStatus() {} };
  const custom = customRoles([{ key: 'custom-lawyer-a1', label: 'Hukukçu', brief: 'KVKK ve sözleşme risklerine bakar; her iddiada hangi maddeye dayandığını sorar.' }]);
  try {
    await startCase(store, { target: join(dir, 'idea.md'), mode: 'idea', members: ['optimist', 'custom-lawyer-a1'], maxTurns: 1, minTurns: 1,
      models: { optimist: 'haiku', 'custom-lawyer-a1': 'haiku' }, custom }).done;
    const reg = events.find((e) => e.type === 'member.registered' && e.data.role === 'custom-lawyer-a1').data;
    assert.equal(reg.label, 'Hukukçu');
    assert.match(reg.brief, /KVKK/);
    const prompts = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const opening = prompts.find((p) => p.includes('Round 1') && p.includes('You are **Hukukçu**'));
    assert.ok(opening, 'the custom member got its own lens');
    assert.match(opening, /> KVKK ve sözleşme/);
    assert.match(opening, /^Role keys: optimist, custom-lawyer-a1\.$/m);
    assert.match(opening, /COUNCIL: optimist, custom-lawyer-a1 \(Hukukçu/);
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('custom roles: malformed ones are dropped, at most four, text is bounded', () => {
  const r = customRoles([
    { key: 'custom-ok', label: '  Pazarlamacı  ', brief: 'Konumlandırma ve rakiplere bakar.' },
    { key: 'optimist', label: 'x', brief: 'takes over a built-in role' },
    { key: 'custom-short', label: 'Kısa', brief: 'az' },
    { key: 'custom-nolabel', label: '', brief: 'a long enough brief' },
    { key: 'custom-long', label: 'L'.repeat(80), brief: 'B'.repeat(4000) },
  ]);
  assert.deepEqual(Object.keys(r), ['custom-ok', 'custom-long']);
  assert.equal(r['custom-ok'].label, 'Pazarlamacı');
  assert.equal(r['custom-long'].label.length, 40);
  assert.equal(r['custom-long'].brief.length, 1500);
  assert.equal(Object.keys(customRoles(Array.from({ length: 9 }, (_, i) => ({ key: `custom-r${i}`, label: `R${i}`, brief: 'a long enough brief' })))).length, 4);
});

test('chair: the moderator follows the chair file, and an idea verdict sees the idea text', async () => {
  const { log, restore } = withScriptedClaude();
  const dir = mkdtempSync(join(homedir(), '.council-test-chair-'));
  writeFileSync(join(dir, 'idea.md'), '# Fikir\nKampüs kargo dolapları.\n');
  const store = { createCase() {}, append: (_id, type, data) => ({ type, data }), setStatus() {} };
  try {
    await startCase(store, { target: join(dir, 'idea.md'), mode: 'idea', members: ['optimist', 'skeptic'], maxTurns: 2, minTurns: 1, models: { optimist: 'haiku', skeptic: 'haiku' } }).done;
    const prompts = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const mod = prompts.find((p) => p.includes('You are the MODERATOR'));
    assert.match(mod, /## As moderator/);
    assert.doesNotMatch(mod, /## As synthesizer/);
    const verdict = prompts.find((p) => p.includes('Write the verdict'));
    assert.match(verdict, /Kampüs kargo dolapları/);
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('startCase: runs a whole hearing on an injected caller, no CLI needed', async () => {
  const events = [];
  const store = { createCase() {}, append: (_id, type, data) => events.push({ type, data }), setStatus() {} };
  const said = [];
  const createCaller = () => ({
    call: async (role) => {
      said.push(role);
      const vote = '```json\n{"vote":"go","confidence":0.8,"verdict":"go","reason":"fine"}\n```';
      return { text: `${role} speaks\n${vote}`, sessionId: `s-${role}`, exitCode: 0, stderr: '' };
    },
    stopAll: async () => {},
  });
  const target = mkdtempSync(join(homedir(), '.council-test-target-'));
  writeFileSync(join(target, 'idea.md'), 'An idea.\n');
  try {
    await startCase(store, { target: join(target, 'idea.md'), mode: 'idea', members: ['optimist', 'skeptic'], maxTurns: 1, minTurns: 1 },
      { createCaller, buildContext: () => 'the idea' }).done;
    const types = events.map((e) => e.type);
    assert.equal(types.filter((t) => t === 'opening.completed').length, 2);
    assert.ok(types.includes('verdict.completed'));
    assert.equal(types.at(-1), 'case.ended');
    assert.equal(said.at(-1), 'chair');
  } finally { rmSync(target, { recursive: true, force: true }); }
});
