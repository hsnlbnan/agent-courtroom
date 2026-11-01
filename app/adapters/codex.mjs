// Codex adapter — read-only member in both modes.
// Safety (each point verified with spike/canary-test.mjs):
// - plain `-s read-only` leaked a canary outside the cwd; a permission profile
//   that only reads `:minimal` + the cwd passed, so that profile is mandatory;
// - the cwd is an empty per-case sandbox under ~/.agent-council (not /tmp:
//   `:minimal` grants /tmp read+write);
// - Codex loads the user's global ~/.codex/AGENTS.md even with
//   --ignore-user-config (and project_doc_max_bytes=0 does not stop it), so it
//   runs with its own CODEX_HOME that only links the login file.
import { execFile } from 'node:child_process';
import { mkdirSync, chmodSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_HOME } from '../lib/paths.mjs';

export const CODEX_HOME = join(APP_HOME, 'codex-home');

export function prepareCodexHome() {
  mkdirSync(CODEX_HOME, { recursive: true, mode: 0o700 });
  chmodSync(CODEX_HOME, 0o700);
  const auth = join(homedir(), '.codex', 'auth.json');
  const link = join(CODEX_HOME, 'auth.json');
  if (existsSync(auth) && !existsSync(link)) symlinkSync(auth, link);
  return existsSync(link) && lstatSync(link).isSymbolicLink();
}

/** The models Codex lists for this account (its catalog), as `codex:<slug>`; [] if it cannot say. */
function discoverModels() {
  return new Promise((ok) => {
    execFile('codex', ['debug', 'models'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) return ok([]);
      try {
        const list = JSON.parse(stdout).models ?? [];
        ok(list.filter((m) => m.visibility === 'list' && /^[\w.-]+$/.test(m.slug ?? ''))
          .map((m) => ({ id: `codex:${m.slug}`, name: m.display_name ?? m.slug, hint: m.description ?? '' })));
      } catch { ok([]); }
    });
  });
}

export const codex = {
  vendor: 'codex',
  name: 'Codex',
  bin: 'codex',
  status: 'enabled',
  modes: ['code', 'idea'],
  // `codex` is the CLI's own default model; the catalog adds `codex:<slug>` entries.
  models: ['codex'],
  discoverModels,
  note: 'İzin profili: yalnızca hedef klasörü okur, yazamaz; ayrı CODEX_HOME. Kod modunda hedefteki .env dosyalarını da okuyabilir.',
  prepare: () => prepareCodexHome(),
  env: () => ({ CODEX_HOME }),

  argv({ prompt, sessionId, cwd, model }) {
    const profile = [
      '-c', 'default_permissions="council"',
      '-c', `permissions.council.filesystem={":minimal"="read", ${JSON.stringify(cwd)}="read"}`,
    ];
    // No model: Codex's own default. A model comes from its catalog (`codex debug models`).
    const pick = model && /^[\w.-]+$/.test(model) ? ['-m', model] : [];
    const common = ['--json', '--skip-git-repo-check', '--ignore-user-config', ...pick, ...profile];
    return sessionId
      ? ['codex', ['exec', 'resume', ...common, sessionId, prompt]]
      : ['codex', ['exec', ...common, prompt]];
  },

  // Codex usage is cumulative per thread; the orchestrator diffs consecutive values.
  parse(ev) {
    const out = [];
    if (ev.type === 'thread.started') out.push({ kind: 'session', sessionId: ev.thread_id });
    else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') out.push({ kind: 'text', text: ev.item.text });
    else if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') {
      out.push({ kind: 'tool', name: 'shell', input: { command: ev.item.command }, exitCode: ev.item.exit_code });
    } else if (ev.type === 'turn.completed') {
      const u = ev.usage ?? {};
      out.push({ kind: 'result', cumulative: true, usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, costUsd: null } });
    } else if (ev.type === 'turn.failed' || ev.type === 'error') {
      out.push({ kind: 'error', message: ev.error?.message ?? ev.message });
    }
    return out;
  },
};
