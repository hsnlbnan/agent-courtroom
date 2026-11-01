// The folder-suggestion endpoint must never list outside $HOME, credential
// dirs, dotfiles or symlinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suggest, browse } from '../lib/targets.mjs';
import { versionOf } from '../lib/providers.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'home-')));
const outside = realpathSync(mkdtempSync(join(tmpdir(), 'out-')));
mkdirSync(join(home, 'proj'));
mkdirSync(join(home, 'Projects'));
mkdirSync(join(home, '.ssh'));
mkdirSync(join(home, 'Library'));
writeFileSync(join(home, 'notes.md'), '# idea');
writeFileSync(join(home, 'secret.env'), 'x');
symlinkSync(outside, join(home, 'link'));
mkdirSync(join(outside, 'leak'));

const paths = (r) => r.map((x) => x.path);

test('lists only plain directories under home in code mode', () => {
  assert.deepEqual(paths(suggest('~/', 'code', home)), ['~/proj/', '~/Projects/']);
});

test('idea mode adds .md/.txt files, nothing else', () => {
  assert.deepEqual(paths(suggest('~/', 'idea', home)), ['~/proj/', '~/Projects/', '~/notes.md']);
});

test('prefix filtering is case-insensitive', () => {
  assert.deepEqual(paths(suggest('~/pro', 'code', home)), ['~/proj/', '~/Projects/']);
});

test('never escapes home, never lists credential dirs or symlink targets', () => {
  assert.deepEqual(suggest('~/../', 'code', home), []);
  assert.deepEqual(suggest('/etc/', 'code', home), []);
  assert.deepEqual(suggest('~/.ssh/', 'code', home), []);
  assert.deepEqual(suggest('~/Library/', 'code', home), []);
  assert.deepEqual(suggest('~/link/', 'code', home), [], 'symlink resolving outside home is refused');
  assert.deepEqual(suggest(`${outside}/`, 'code', home), []);
});

import { isSensitive, inferInput } from '../lib/targets.mjs';

test('sensitive folders: matched only as the first segment under home', () => {
  for (const rel of ['.ssh', '.ssh/id_x', 'Library', 'Library/Keychains', '.config/gh', '.agent-council/cases/x', 'Library/Mobile Documents/iCloud~md~obsidian']) {
    assert.ok(isSensitive(rel), rel);
  }
  for (const rel of ['proj', 'proj/Library/Foo', 'Documents/app/.config/x', 'code/.ssh-notes']) assert.ok(!isSensitive(rel), rel);
});

test('iCloud Drive: only the CloudDocs folder is allowed under Library', () => {
  assert.ok(!isSensitive('Library/Mobile Documents/com~apple~CloudDocs'));
  assert.ok(!isSensitive('Library/Mobile Documents/com~apple~CloudDocs/Notes/idea.md'));
  assert.ok(isSensitive('Library/Mobile Documents'));
  assert.ok(isSensitive('Library/Mobile Documents/com~apple~CloudDocsX'));
});

test('suggestions inside a project list its nested Library folder', () => {
  mkdirSync(join(home, 'proj', 'Library'));
  assert.ok(paths(suggest('~/proj/', 'code', home)).includes('~/proj/Library/'));
  assert.ok(!paths(suggest('~/', 'code', home)).includes('~/Library/'));
});

test('input inference: folder, idea file, or free text', () => {
  assert.equal(inferInput('~/code/app').kind, 'dir');
  assert.equal(inferInput('/Users/x/notes/idea.md').kind, 'file');
  assert.equal(inferInput('./plan.txt').kind, 'file');
  assert.equal(inferInput('A marketplace for used lab gear').kind, 'text');
  assert.equal(inferInput('~/x\nsecond line').kind, 'text');
  assert.equal(inferInput('   ').kind, 'empty');
});

test('browse: lists folders then idea files, hides dotfiles, symlinks and credential dirs', () => {
  const r = browse('~', home);
  assert.equal(r.path, '~');
  assert.equal(r.parent, null);
  assert.equal(r.selectable, false); // home itself is never a target
  assert.deepEqual(r.entries.map((e) => [e.name, e.kind]), [['proj', 'dir'], ['Projects', 'dir'], ['notes.md', 'file']]);
});

test('browse: a sub-folder can be chosen and walks back up', () => {
  mkdirSync(join(home, 'proj', 'src'), { recursive: true });
  const r = browse('~/proj', home);
  assert.deepEqual([r.path, r.parent, r.selectable], ['~/proj', '~', true]);
  // A nested Library is an ordinary folder (only ~/Library itself is fenced).
  assert.deepEqual(r.entries.map((e) => e.path), ['~/proj/Library', '~/proj/src']);
  assert.equal(browse('~/proj/src', home).parent, '~/proj');
});

test('browse: outside home, through a symlink or into a credential dir falls back to home', () => {
  for (const p of [outside, '~/link', '~/.ssh', '~/Library', '/etc', '~/../..']) assert.equal(browse(p, home).path, '~', p);
});

test('versionOf: keeps only the version number a CLI prints', () => {
  assert.equal(versionOf('2.1.4 (Claude Code)'), '2.1.4');
  assert.equal(versionOf('codex-cli 0.159.0'), '0.159.0');
  assert.equal(versionOf('{"type":"system","subtype":"init"}'), null);
});
