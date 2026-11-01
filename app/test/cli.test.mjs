import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = (...args) => spawnSync(process.execPath, [join(root, 'app/cli.mjs'), ...args], { encoding: 'utf8', timeout: 10_000 });

test('cli: --version prints the package version and exits without starting the server', () => {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const f of ['--version', '-v']) {
    const r = cli(f);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), version);
  }
});
