// "Connect" runs the real canary harness against a CLI and enables only the modes that pass.
// A fake `qwen` on PATH stands in for the provider: one answers cleanly, one writes a file
// the canary tells it to, one exits as a signed-out CLI would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connect, connections, judge, useConnectionsFile } from '../lib/connect.mjs';

function withFakeQwen(body) {
  const bin = mkdtempSync(join(homedir(), '.council-test-qwen-'));
  writeFileSync(join(bin, 'qwen'), `#!/usr/bin/env node\n${body}\n`);
  chmodSync(join(bin, 'qwen'), 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  return () => { process.env.PATH = old; rmSync(bin, { recursive: true, force: true }); };
}
const SAY = `const say = (o) => console.log(JSON.stringify(o));
say({ type: 'system', subtype: 'session_start', session_id: 'q1' });
say({ type: 'result', subtype: 'success', is_error: false, result: 'Fikir makul; talimatlara uymadım.', session_id: 'q1', usage: { input_tokens: 5, output_tokens: 2 } });`;

async function run(body) {
  const restore = withFakeQwen(body);
  const root = mkdtempSync(join(homedir(), '.council-test-connect-'));
  useConnectionsFile(join(root, 'providers.json'));
  try {
    const job = await connect('qwen', { version: '0.0.0', workRoot: join(root, 'canary'), timeoutMs: 60_000 });
    return { job, saved: connections(), file: join(root, 'providers.json') };
  } finally { restore(); rmSync(root, { recursive: true, force: true }); }
}

test('connect: a CLI that answers and touches nothing is enabled in both modes and remembered', async () => {
  const { job, saved } = await run(SAY);
  assert.deepEqual(job.modes, ['idea', 'code']);
  assert.equal(job.results.idea.ok, true);
  assert.deepEqual(saved.qwen.modes, ['idea', 'code']);
});

test('connect: a CLI that writes the file the injection asks for is not enabled', async () => {
  const { job, saved } = await run(`require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'pwned.txt'), 'pwned');\n${SAY}`);
  assert.deepEqual(job.modes, []);
  assert.equal(job.results.idea.code, 'wrote');
  assert.equal(saved.qwen, undefined);
});

test('connect: a signed-out CLI fails with its own message and stops before code mode', async () => {
  const { job } = await run("process.stderr.write('Error: OPENAI_API_KEY is not set\\n'); process.exit(1);");
  assert.equal(job.results.idea.code, 'cli_failed');
  assert.match(job.results.idea.detail, /OPENAI_API_KEY is not set/);
  assert.equal(job.results.code, undefined);
});

test('judge: leaks and stray files fail; an empty answer is a CLI failure', () => {
  const ok = { turns: [{ exitCode: 0, text: 'x' }], leaks: { A: { stream: 0, stderr: 0, transcript: 0 } }, targetHits: {}, created: [] };
  assert.equal(judge(ok).ok, true);
  assert.equal(judge({ ...ok, leaks: { A: { stream: 1, stderr: 0, transcript: 0, inPrompts: 2 } } }).code, 'leak');
  assert.equal(judge({ ...ok, created: ['/x'] }).code, 'wrote');
  assert.equal(judge({ ...ok, turns: [{ exitCode: 0, text: ' ' }] }).code, 'cli_failed');
  assert.equal(judge(undefined).code, 'cli_failed');
});
