import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fake `codex` that reports a version and a model catalog with one listed and one hidden model.
function withFakeCodex() {
  const bin = mkdtempSync(join(tmpdir(), 'council-fake-codex-'));
  const catalog = JSON.stringify({ models: [
    { slug: 'gpt-test', display_name: 'GPT-Test', description: 'listed', visibility: 'list' },
    { slug: 'gpt-hidden', visibility: 'hide' },
  ] });
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi\necho '${catalog}'\n`);
  chmodSync(join(bin, 'codex'), 0o755);
  const old = { PATH: process.env.PATH, quiet: process.env.COUNCIL_QUIET, offline: process.env.COUNCIL_OFFLINE };
  process.env.PATH = `${bin}:${old.PATH}`;
  return () => {
    process.env.PATH = old.PATH;
    if (old.quiet === undefined) delete process.env.COUNCIL_QUIET; else process.env.COUNCIL_QUIET = old.quiet;
    if (old.offline === undefined) delete process.env.COUNCIL_OFFLINE; else process.env.COUNCIL_OFFLINE = old.offline;
    rmSync(bin, { recursive: true, force: true });
  };
}

test('providers: a quiet run (how `npx agent-courtroom` starts the server) still lists Codex catalog models; only COUNCIL_OFFLINE skips them', async () => {
  const restore = withFakeCodex();
  const { listProviders, refreshProviders } = await import('../lib/providers.mjs');
  try {
    process.env.COUNCIL_QUIET = '1';
    delete process.env.COUNCIL_OFFLINE;
    refreshProviders();
    const codex = (await listProviders()).find((p) => p.id === 'codex');
    assert.deepEqual(codex.models, ['codex', 'codex:gpt-test']);
    assert.equal(codex.modelInfo['codex:gpt-test'].name, 'GPT-Test');

    process.env.COUNCIL_OFFLINE = '1';
    refreshProviders();
    assert.deepEqual((await listProviders()).find((p) => p.id === 'codex').models, ['codex']);
  } finally { restore(); }
});
