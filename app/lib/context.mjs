// The shared context every member starts from: the idea text (line-numbered) in idea mode,
// or a file tree plus README and manifest in code mode. Never follows symlinks, never opens
// secret files, never reads outside the target.
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/** How much of an idea is read: the same limit the server applies to ideas typed in the form. */
export const IDEA_MAX = 12_000;
const TREE_MAX = 400;
const TREE_SHOWN = 250;

const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.venv|__pycache__)(\/|$)|(^|\/)\.env[^/]*$|\.(lock|lockb|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|mp4|pem|key)$|package-lock\.json$|(^|\/)id_[^/]*$/;
export const isIdeaFile = (name) => /\.(md|txt)$/i.test(name);

/** The idea file with line numbers, so members without file tools can still cite `file:line`. */
function ideaContext(target) {
  const st = lstatSync(target);
  if (!st.isFile() || SKIP.test(basename(target)) || !isIdeaFile(target)) return '';
  const lines = readFileSync(target, 'utf8').slice(0, IDEA_MAX).split('\n');
  return `### ${basename(target)} (full text, line-numbered)\n${lines.map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n')}`;
}

/** Relative paths of the target's files (bounded), and the secret files found on the way. */
function walkTarget(target) {
  const files = [];
  const secrets = [];
  const walk = (dir, depth = 0) => {
    if (files.length >= TREE_MAX || depth > 12) return;
    for (const name of readdirSync(dir)) {
      if (files.length >= TREE_MAX) return;
      const abs = join(dir, name);
      const rel = relative(target, abs);
      if (/^\.env/.test(name)) { secrets.push(rel); continue; }
      if (SKIP.test(rel)) continue;
      const st = lstatSync(abs); // never follow symlinks: they can point outside the target
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(abs, depth + 1);
      else files.push(rel);
    }
  };
  walk(target);
  return { files, secrets };
}

function codeContext(target) {
  const { files, secrets } = walkTarget(target);
  const inside = (f) => realpathSync(join(target, f)).startsWith(`${realpathSync(target)}/`);
  const readme = files.find((f) => /^readme(\.md)?$/i.test(f));
  const manifest = files.find((f) => /^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(f));
  return [
    'Line numbers below are NOT the target files\' line numbers; open the file before citing it.',
    secrets.length ? `Secret files present (never open them): ${secrets.join(', ')}` : '',
    `## File tree (${files.length} files)\n${files.slice(0, TREE_SHOWN).join('\n')}`,
    readme && inside(readme) ? `## ${readme} (first 60 lines)\n${readFileSync(join(target, readme), 'utf8').split('\n').slice(0, 60).join('\n')}` : '',
    manifest && inside(manifest) ? `## ${manifest}\n${readFileSync(join(target, manifest), 'utf8').slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildContext(target, mode) {
  return mode === 'idea' ? ideaContext(target) : codeContext(target);
}
