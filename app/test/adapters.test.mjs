// Adapter parsers against the real (scrubbed) spike fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claude } from '../adapters/claude.mjs';
import { codex } from '../adapters/codex.mjs';
import { parseTurn, hasMismatch, citations, primaryReply, jsonBlock } from '../lib/turns.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../spike/fixtures');
const items = (adapter, file) => readFileSync(join(FIX, file), 'utf8').split('\n').filter(Boolean)
  .flatMap((l) => adapter.parse(JSON.parse(l)));

test('claude: session, final text and per-turn usage from a resumed turn', () => {
  const it = items(claude, 'claude-turn3.jsonl');
  const session = it.find((i) => i.kind === 'session');
  const result = it.find((i) => i.kind === 'result');
  assert.ok(session.sessionId);
  assert.match(result.text, /KARGA-/);
  assert.ok(result.usage.inputTokens > 0 && result.usage.outputTokens > 0);
  assert.ok(result.usage.costUsd > 0 && result.usage.costUsd < 0.05, 'per-turn cost, not cumulative');
});

test('claude: tool calls are surfaced', () => {
  assert.ok(items(claude, 'claude-turn1.jsonl').some((i) => i.kind === 'tool' && i.name === 'Read'));
});

test('claude: argv keeps --tools last and pins read-only tools', () => {
  const [, a] = claude.argv({ prompt: 'x', mode: 'code' });
  assert.deepEqual(a.slice(-2), ['--tools', 'Read,Glob,Grep']);
  assert.deepEqual(claude.argv({ prompt: 'x', mode: 'idea' })[1].slice(-2), ['--tools', '']);
});

test('codex: thread id, message and cumulative usage; enabled', () => {
  const it = items(codex, 'codex-turn3.jsonl');
  assert.ok(it.find((i) => i.kind === 'session').sessionId);
  assert.match(it.find((i) => i.kind === 'text').text, /KARGA-/);
  assert.equal(it.find((i) => i.kind === 'result').cumulative, true);
  assert.equal(codex.status, 'enabled');
});

test('turn header, mismatch flag and reply target', () => {
  const { header, body } = parseTurn('REPLY_TO: T6 | O-security\nADDRESSES: security\nSTANCE: build\n\nKabul eder misin?');
  assert.deepEqual(header, { replyTo: 'T6 | O-security', addresses: 'security', stance: 'build' });
  assert.equal(primaryReply(header.replyTo), 'T6');
  assert.equal(hasMismatch(header.stance, body), true);
  assert.equal(hasMismatch('question', body), false);
});

test('citations are verified against the target root', () => {
  const root = join(FIX, '..');
  const c = citations('see `canary-test.mjs:3` and `canary-test.mjs:99999` and `nope.md:1`', root);
  assert.deepEqual(c.map((x) => x.verified), [true, false, false]);
  assert.equal(citations('`a.md:1`', null)[0].verified, null);
});

test('json block extraction', () => {
  assert.deepEqual(jsonBlock('x\n```json\n{"vote":"go"}\n```'), { vote: 'go' });
  assert.equal(jsonBlock('no block'), null);
});

test('provisional vote parses both opening formats', async () => {
  const { provisionalVote } = await import('../lib/turns.mjs');
  assert.deepEqual(provisionalVote('### Provisional vote\n**conditional** — confidence 0.72 — x'), { vote: 'conditional', confidence: 0.72 });
  assert.deepEqual(provisionalVote('### Ön oy\n**conditional** — güven 0.7 — x'), { vote: 'conditional', confidence: 0.7 });
  assert.deepEqual(provisionalVote('### Provizyonel oy\n**conditional — güven 0.6 —** x'), { vote: 'conditional', confidence: 0.6 });
});

test('context walk skips symlinks and secret files', async () => {
  const { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { buildContext } = await import('../lib/context.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ctx-'));
  const outside = mkdtempSync(join(tmpdir(), 'out-'));
  writeFileSync(join(outside, 'secret.txt'), 'CANARY-OUTSIDE');
  writeFileSync(join(root, 'README.md'), '# hi');
  writeFileSync(join(root, '.env'), 'TOKEN=CANARY-ENV');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'x');
  symlinkSync(outside, join(root, 'link'));
  const ctx = buildContext(root, 'code');
  assert.match(ctx, /src\/a\.js/);
  assert.match(ctx, /Secret files present.*\.env/);
  assert.doesNotMatch(ctx, /CANARY|secret\.txt|link\//);
});

test('secret files are denied to Read/Grep and credential shapes are redacted', async () => {
  const [, a] = claude.argv({ prompt: 'x', mode: 'code' });
  const settings = JSON.parse(a[a.indexOf('--settings') + 1]);
  assert.ok(settings.permissions.deny.includes('Read(**/.env*)'));
  assert.deepEqual(a.slice(-2), ['--tools', 'Read,Glob,Grep'], '--tools still last');
  const { redact } = await import('../lib/store.mjs');
  assert.equal(redact('key sk-ant-abcdefghijklmnopqrstuvwxyz123 ok'), 'key [REDACTED] ok');
  assert.equal(redact('plain text CANARY-1'), 'plain text CANARY-1');
});

test('providers: codex is enabled in both modes', async () => {
  const { listProviders } = await import('../lib/providers.mjs');
  const cx = (await listProviders()).find((p) => p.id === 'codex');
  assert.equal(cx.status, 'enabled');
  assert.deepEqual(cx.modes, ['code', 'idea']);
});

// Adapters written from docs (adapters/untested.mjs): safety of what they would run,
// and parsing of the event shapes their docs show.
import { qwen, cursor, opencode, kimi } from '../adapters/untested.mjs';

const AUTO_APPROVE = ['--yolo', '-y', '-f', '--force', '--auto', '--approve-mcps', '--dangerously-skip-permissions', 'yolo', '--sandbox'];

test('untested adapters: no auto-approve flag in any mode, prompt passed as one argv item', () => {
  for (const a of [qwen, cursor, opencode, kimi]) {
    for (const mode of ['code', 'idea']) {
      const [bin, args] = a.argv({ prompt: 'p; rm -rf ~', sessionId: 's1', cwd: '/tmp/x', mode, model: a.vendor });
      assert.equal(typeof bin, 'string');
      for (const flag of AUTO_APPROVE) assert.ok(!args.includes(flag), `${a.vendor} ${mode}: ${flag}`);
      assert.ok(args.includes('p; rm -rf ~'), `${a.vendor}: prompt stays one argument`);
    }
  }
});

test('qwen: write and shell tools excluded; idea mode also drops read tools', () => {
  const code = qwen.argv({ prompt: 'p', mode: 'code' })[1];
  const idea = qwen.argv({ prompt: 'p', mode: 'idea' })[1];
  const excluded = (args) => args[args.indexOf('--exclude-tools') + 1].split(',');
  for (const t of ['run_shell_command', 'write_file', 'edit', 'web_fetch']) assert.ok(excluded(code).includes(t), t);
  assert.ok(!excluded(code).includes('read_file'));
  assert.ok(excluded(idea).includes('read_file'));
  assert.ok(code.includes('--bare'));
  assert.equal(code[code.indexOf('--approval-mode') + 1], 'plan');
});

test('opencode: permissions start from deny-all; idea mode allows nothing', () => {
  const code = JSON.parse(opencode.env('code').OPENCODE_PERMISSION);
  assert.equal(Object.keys(code)[0], '*');
  assert.equal(code['*'], 'deny');
  assert.equal(code.bash, undefined);
  assert.deepEqual(JSON.parse(opencode.env('idea').OPENCODE_PERMISSION), { '*': 'deny' });
  assert.equal(opencode.env('code').OPENCODE_DISABLE_PROJECT_CONFIG, '1');
});

test('untested adapters: parse the documented stream events', () => {
  const q = [
    { type: 'system', subtype: 'session_start', session_id: 'q1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'read_file', input: {} }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'q1', usage: { input_tokens: 5, output_tokens: 2 } },
  ].flatMap((e) => qwen.parse(e));
  assert.deepEqual(q.map((i) => i.kind), ['session', 'text', 'tool', 'result']);
  assert.equal(q.at(-1).usage.outputTokens, 2);

  const c = [
    { type: 'system', subtype: 'init', session_id: 'c1', model: 'm' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
    { type: 'tool_call', subtype: 'started', tool_call: { readToolCall: { args: { path: 'a' } } } },
    { type: 'result', subtype: 'success', result: 'done', session_id: 'c1' },
  ].flatMap((e) => cursor.parse(e));
  assert.deepEqual(c.map((i) => i.kind), ['session', 'text', 'tool', 'result']);
  assert.equal(c[2].name, 'readToolCall');

  const o = [
    { type: 'step_start', sessionID: 'o1' },
    { type: 'text', sessionID: 'o1', part: { text: 'hi' } },
    { type: 'step_finish', sessionID: 'o1', part: { tokens: { input: 7, output: 3 } } },
  ].flatMap((e) => opencode.parse(e));
  assert.ok(o.some((i) => i.kind === 'text' && i.text === 'hi'));
  assert.equal(o.find((i) => i.kind === 'result').usage.inputTokens, 7);
});

test('codex: a catalog model is passed with -m (also on resume); anything odd is dropped', () => {
  const args = (o) => codex.argv({ prompt: 'p', cwd: '/tmp/x', ...o })[1];
  assert.deepEqual(args({ model: 'gpt-6-luna' }).slice(args({ model: 'gpt-6-luna' }).indexOf('-m'), args({ model: 'gpt-6-luna' }).indexOf('-m') + 2), ['-m', 'gpt-6-luna']);
  assert.ok(args({ model: 'gpt-6-luna', sessionId: 's1' }).includes('-m'));
  assert.ok(!args({}).includes('-m'));
  assert.ok(!args({ model: 'x; rm -rf ~' }).includes('-m'));
});

test('cursor: trusts the workspace only when it has no .cursor config of its own', async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const clean = mkdtempSync(join(tmpdir(), 'council-cursor-'));
  const rigged = mkdtempSync(join(tmpdir(), 'council-cursor-'));
  mkdirSync(join(rigged, '.cursor'));
  try {
    assert.ok(cursor.argv({ prompt: 'p', cwd: clean, mode: 'code' })[1].includes('--trust'));
    assert.equal(cursor.refuses(clean), null);
    // A repo's own .cursor folder could grant itself tools or hooks once trusted.
    assert.ok(!cursor.argv({ prompt: 'p', cwd: rigged, mode: 'code' })[1].includes('--trust'));
    assert.equal(cursor.refuses(rigged), 'target_has_cursor_config');
  } finally { rmSync(clean, { recursive: true, force: true }); rmSync(rigged, { recursive: true, force: true }); }
});
