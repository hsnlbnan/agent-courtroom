// Pure modules and the process runner, without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveModel } from '../adapters/index.mjs';
import { run } from '../adapters/run.mjs';
import { matchRoute } from '../lib/api.mjs';
import { createLiveCases } from '../lib/cases.mjs';
import { conversationState, parseModeratorLine, quietestPick, rulePick } from '../lib/moderation.mjs';
import { parseNewCase } from '../lib/new-case.mjs';

const turn = (n, role, stance, addresses = 'none') => ({ n, role, header: { stance, addresses } });
const members = ['optimist', 'skeptic', 'security'];

test('moderation: a challenge gives the challenged member the right of reply', () => {
  const turns = [turn(1, 'skeptic', 'challenge', 'optimist')];
  const spoken = { optimist: 0, skeptic: 1, security: 0 };
  const state = conversationState({ turns, members, spoken });
  assert.deepEqual(rulePick({ n: 2, turns, members, pendingNote: null, state }),
    { n: 2, role: 'optimist', replyTo: 'T1', why: 'Direct challenge or question: right of reply', whyCode: 'direct', source: 'rule' });
});

test('moderation: no right of reply when a note waits, when two members loop, or for a self-address', () => {
  const spoken = { optimist: 2, skeptic: 2, security: 1 };
  const challenge = [turn(1, 'skeptic', 'challenge', 'optimist')];
  const state = conversationState({ turns: challenge, members, spoken });
  assert.equal(rulePick({ n: 2, turns: challenge, members, pendingNote: 'U1', state }), null);
  const loop = [turn(1, 'skeptic', 'challenge', 'optimist'), turn(2, 'optimist', 'challenge', 'skeptic'),
    turn(3, 'skeptic', 'challenge', 'optimist'), turn(4, 'optimist', 'challenge', 'skeptic')];
  const loopState = conversationState({ turns: loop, members, spoken });
  assert.equal(loopState.looping, true);
  assert.equal(rulePick({ n: 5, turns: loop, members, pendingNote: null, state: loopState }), null);
  const self = [turn(1, 'skeptic', 'question', 'skeptic')];
  assert.equal(rulePick({ n: 2, turns: self, members, pendingNote: null, state: conversationState({ turns: self, members, spoken }) }), null);
});

test('moderation: the moderator line is read strictly; END only after the minimum turns', () => {
  const ctx = { n: 5, members, minTurns: 4 };
  assert.deepEqual(parseModeratorLine('NEXT: security REPLY_TO: T3 WHY: checks the claim', ctx).pick,
    { n: 5, role: 'security', replyTo: 'T3', why: 'checks the claim', source: 'chair' });
  assert.deepEqual(parseModeratorLine('END: positions are stable', ctx), { end: 'positions are stable' });
  assert.equal(parseModeratorLine('END: too early', { ...ctx, n: 3 }), null);
  assert.equal(parseModeratorLine('NEXT: stranger REPLY_TO: T1 WHY: x', ctx), null);
  assert.equal(quietestPick({ n: 1, turns: [], members, spoken: { optimist: 1, skeptic: 0, security: 2 } }).role, 'skeptic');
});

test('models: a model id names its adapter and the model that CLI is given', () => {
  assert.deepEqual([resolveModel('sonnet').adapter.vendor, resolveModel('sonnet').cliModel], ['claude', 'sonnet']);
  assert.deepEqual([resolveModel('codex').adapter.vendor, resolveModel('codex').cliModel], ['codex', undefined]);
  assert.deepEqual([resolveModel('codex:gpt-6-luna').adapter.vendor, resolveModel('codex:gpt-6-luna').cliModel], ['codex', 'gpt-6-luna']);
});

const providers = [
  { id: 'claude', status: 'enabled', installed: true, modes: ['code', 'idea'], models: ['haiku', 'sonnet', 'opus', 'fable'] },
  { id: 'codex', status: 'enabled', installed: true, modes: ['code', 'idea'], models: ['codex', 'codex:gpt-6-luna'] },
  { id: 'qwen', status: 'enabled', installed: true, connected: true, modes: ['idea'], models: ['qwen'] },
  { id: 'kimi', status: 'untested', installed: true, modes: ['code', 'idea'], models: ['kimi'] },
];
const roles = [{ role: 'optimist', model: 'sonnet' }, { role: 'skeptic', model: 'opus' }];
const okPath = (p, mode) => ({ path: `/home/u/${p}`, mode });
const parse = (body) => parseNewCase(body, { providers, roles, check: okPath });

test('new case: an idea, a folder or a file decides the mode; errors carry the API codes', () => {
  assert.equal(parse({ idea: 'A marketplace.', members: ['optimist', 'skeptic'] }).options.mode, 'idea');
  assert.equal(parse({ target: '~/proj', members: ['optimist', 'skeptic'] }).options.mode, 'code');
  assert.equal(parse({ target: '~/notes/x.md', members: ['optimist', 'skeptic'] }).options.mode, 'idea');
  assert.equal(parse({ idea: 'x'.repeat(12_001), members: ['optimist', 'skeptic'] }).code, 'idea_too_long');
  assert.equal(parse({ members: ['optimist', 'skeptic'] }).code, 'target_required');
  assert.equal(parse({ idea: 'x', members: ['optimist'] }).code, 'min_members');
  assert.equal(parseNewCase({ target: '~/x' }, { providers, roles, check: () => ({ error: 'nope', code: 'target_sensitive' }) }).code, 'target_sensitive');
});

test('new case: provider models must be usable, and cleared for the mode', () => {
  const base = { members: ['optimist', 'skeptic'] };
  assert.equal(parse({ ...base, idea: 'x', models: { optimist: 'kimi' } }).code, 'provider_unavailable');
  assert.equal(parse({ ...base, target: '~/proj', models: { optimist: 'qwen' } }).code, 'provider_unavailable'); // idea only
  assert.equal(parse({ ...base, idea: 'x', models: { optimist: 'qwen' } }).options.models.optimist, 'qwen');
  assert.equal(parse({ ...base, idea: 'x', models: { optimist: 'codex:gpt-6-luna' } }).options.models.optimist, 'codex:gpt-6-luna');
  assert.equal(parse({ ...base, idea: 'x', models: { optimist: 'nonsense' } }).options.models.optimist, 'sonnet'); // role default
  assert.equal(parse({ ...base, idea: 'x', chairModel: 'codex' }).options.chairModel, 'opus'); // the judge stays on Claude
});

test('routes: unknown paths are 404, known paths with another method 405, parameters are named', () => {
  const routes = [{ method: 'GET', pattern: /^\/api\/cases\/(?<id>[\w-]+)\/export$/ }];
  assert.equal(matchRoute(routes, 'GET', '/api/nope').status, 404);
  assert.equal(matchRoute(routes, 'POST', '/api/cases/a1/export').status, 405);
  assert.deepEqual(matchRoute(routes, 'GET', '/api/cases/a1/export').params, { id: 'a1' });
});

test('live cases: at most `max` at a time, then 409 too_many_live; a finished case frees its slot', async () => {
  let finish;
  const startCase = (_store, o) => ({ id: o.id, done: new Promise((r) => { finish = r; }), stop() {}, addNote() {} });
  const live = createLiveCases({ store: {}, startCase, max: 1 });
  live.start({ id: 'a' });
  assert.throws(() => live.start({ id: 'b' }), (e) => e.code === 'too_many_live' && e.status === 409);
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(live.start({ id: 'c' }).id, 'c');
});

const fakeAdapter = (bin) => ({ argv: ({ prompt }) => [bin, [prompt]], parse: (ev) => (ev.result ? [{ kind: 'result', text: ev.result }] : []) });

test('run: a CLI that cannot start resolves with exit -1 instead of crashing the server', async () => {
  const r = await run(fakeAdapter('council-no-such-cli-xyz'), { prompt: 'p', cwd: tmpdir() }).done;
  assert.equal(r.exitCode, -1);
  assert.match(r.stderr, /ENOENT/);
});

test('run: the last line counts even without a trailing newline', async () => {
  const dir = mkdtempSync(join(homedir(), '.council-test-run-'));
  const bin = join(dir, 'cli');
  writeFileSync(bin, '#!/bin/sh\nprintf \'{"result":"done"}\'\n');
  chmodSync(bin, 0o755);
  try {
    const r = await run(fakeAdapter(bin), { prompt: 'p', cwd: dir }).done;
    assert.equal(r.text, 'done');
    assert.equal(r.exitCode, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
