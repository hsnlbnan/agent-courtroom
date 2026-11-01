// Which paths a case may target, and folder suggestions for the new-case form.
// Fence: under $HOME (not $HOME itself), no credential dirs, no dotfiles/symlinks in suggestions.
import { statSync, realpathSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, sep, basename } from 'node:path';

// Targets must live under $HOME (not $HOME itself) and outside credential dirs.
export const HOME = realpathSync(homedir());
// Credential and app-data folders, matched as the FIRST segment under $HOME only, so a
// repo that happens to contain a `Library/` or `.config/` folder is still a valid target.
const SENSITIVE_TOP = new Set(['.ssh', '.aws', '.gnupg', '.config', '.kube', '.docker', '.claude', '.codex', '.agent-council',
  '.azure', '.gcloud', '.password-store', 'Library']);
// The one carve-out: the user's own iCloud Drive documents (not other app containers in Library).
const ICLOUD_DRIVE = 'Library/Mobile Documents/com~apple~CloudDocs';
/** rel: a path relative to $HOME, with '/' separators. */
export function isSensitive(rel) {
  if (rel === ICLOUD_DRIVE || rel.startsWith(`${ICLOUD_DRIVE}/`)) return false;
  return SENSITIVE_TOP.has(rel.split('/')[0]);
}

/** Classify what the user typed: a folder (code), a .md/.txt file (idea file), or free text (idea text). */
export function inferInput(raw) {
  const s = String(raw ?? '').trim();
  const pathLike = /^(~(\/|$)|\/|\.{1,2}\/)/.test(s) && !s.includes('\n');
  if (!pathLike) return { kind: s ? 'text' : 'empty' };
  return { kind: /\.(md|txt)$/i.test(s) ? 'file' : 'dir' };
}

export function checkTarget(raw, mode) {
  let p;
  try { p = realpathSync(resolve(raw.replace(/^~(?=\/|$)/, HOME))); } catch { return { error: 'Target not found', code: 'target_not_found' }; }
  const rel = p.startsWith(HOME + sep) ? p.slice(HOME.length + 1) : null;
  if (!rel) return { error: 'Target must be inside your home folder (not the home folder itself)', code: 'target_outside_home' };
  if (isSensitive(rel)) return { error: 'This folder may hold credentials and cannot be a target', code: 'target_sensitive' };
  const st = statSync(p);
  if (mode === 'code' && !st.isDirectory()) return { error: 'Code mode needs a folder', code: 'target_needs_dir' };
  if (mode === 'idea' && !(st.isFile() && /\.(md|txt)$/i.test(p) && !/^\.env/.test(basename(p)))) return { error: 'Idea mode needs a single .md or .txt file', code: 'target_needs_file' };
  return { path: p };
}

// Folder/file suggestions for the new-case form. Same fence as checkTarget:
// only under $HOME, never credential dirs, no dotfiles, no symlinks.
export function suggest(raw, mode, home = HOME) {
  const typed = String(raw ?? '').replace(/^~(?=\/|$)/, home) || `${home}/`;
  const dir = typed.endsWith('/') ? typed : dirname(typed);
  const prefix = typed.endsWith('/') ? '' : basename(typed).toLowerCase();
  let real;
  try { real = realpathSync(resolve(dir)); } catch { return []; }
  if (real !== home && !real.startsWith(home + sep)) return [];
  if (real !== home && isSensitive(real.slice(home.length + 1))) return [];
  let entries;
  try { entries = readdirSync(real, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => !e.name.startsWith('.') && e.name.toLowerCase().startsWith(prefix) && !e.isSymbolicLink())
    .filter((e) => real !== home || !isSensitive(e.name))
    .filter((e) => e.isDirectory() || (mode === 'idea' && e.isFile() && /\.(md|txt)$/i.test(e.name)))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((e) => ({ path: `~/${join(real, e.name).slice(home.length + 1)}${e.isDirectory() ? '/' : ''}`, kind: e.isDirectory() ? 'dir' : 'file' }));
}


/**
 * One folder's contents for the in-app picker: its sub-folders and the .md/.txt files in it.
 * Same fence as suggest: only $HOME and below, no credential dirs, no dotfiles, no symlinks.
 * `raw` is `~/…` or an absolute path; anything outside the fence answers with $HOME itself.
 */
export function browse(raw, home = HOME) {
  let real;
  try { real = realpathSync(resolve(String(raw || '~').replace(/^~(?=\/|$)/, home))); } catch { real = home; }
  const inside = real === home || real.startsWith(home + sep);
  if (!inside || (real !== home && isSensitive(real.slice(home.length + 1)))) real = home;
  let entries = [];
  try { entries = readdirSync(real, { withFileTypes: true }); } catch {}
  const rel = real === home ? '' : real.slice(home.length + 1);
  const shown = (name) => `~/${rel ? `${rel}/` : ''}${name}`;
  const items = entries
    .filter((e) => !e.name.startsWith('.') && !e.isSymbolicLink())
    .filter((e) => (e.isDirectory() && !(real === home && isSensitive(e.name))) || (e.isFile() && /\.(md|txt)$/i.test(e.name)))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, 500)
    .map((e) => ({ name: e.name, path: shown(e.name), kind: e.isDirectory() ? 'dir' : 'file' }));
  // iCloud Drive lives under the fenced Library folder; offer it at the top level.
  if (real === home) {
    try { if (statSync(join(home, ICLOUD_DRIVE)).isDirectory()) items.unshift({ name: 'iCloud Drive', path: `~/${ICLOUD_DRIVE}`, kind: 'dir' }); } catch {}
  }
  return {
    path: rel ? `~/${rel}` : '~',
    parent: rel ? (dirname(rel) === '.' ? '~' : `~/${dirname(rel)}`) : null,
    // A target can be any folder below $HOME, but not $HOME itself.
    selectable: rel !== '',
    entries: items,
  };
}
