// Adapters written from each CLI's docs and --help (2026-10-31), not yet run
// against a real account. They stay "untested" in lib/providers.mjs, so the
// server refuses them, until `node spike/canary-test.mjs <dir> <name>-idea`
// (and `-code`) pass with A/B leaks = 0 and no writes.
//
// Every adapter runs with its own config home under ~/.agent-council, so the
// user's global settings, MCP servers, hooks and context files stay out, and
// passes through only the one API key variable its CLI needs.
import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_HOME } from '../lib/paths.mjs';

const homeFor = (name) => join(APP_HOME, `${name}-home`);
function prepareHome(name, files = {}) {
  const dir = homeFor(name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, rel), body, { mode: 0o600 });
  }
  return dir;
}
const pass = (...keys) => Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const usage = (u = {}) => ({
  inputTokens: (u.input_tokens ?? u.input ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? u.output ?? 0, costUsd: null,
});

// ---- Qwen Code (qwen 0.17.x) -------------------------------------------------
// Headless + text input auto-denies any tool that needs approval; --bare drops
// settings, MCP and hooks; --exclude-tools removes write/shell/web tools.
// Tool names for read-only file access in idea mode are [unverified].
const QWEN_WRITE_TOOLS = ['run_shell_command', 'monitor', 'edit', 'write_file', 'notebook_edit', 'web_fetch', 'web_search',
  'save_memory', 'agent', 'skill', 'cron_create', 'cron_delete', 'enter_worktree'];
const QWEN_READ_TOOLS = ['read_file', 'read_many_files', 'glob', 'grep_search', 'list_directory'];
export const qwen = {
  vendor: 'qwen',
  name: 'Qwen Code',
  bin: 'qwen',
  // Off until the canary passes on this machine ("Connect" in the UI, app/lib/connect.mjs).
  status: 'untested',
  modes: ['code', 'idea'],
  models: ['qwen'],
  note: 'Adaptör hazır: --bare, plan modu, yazma/shell araçları hariç; headless onay isteyen araçları reddediyor. Hesapla canary testi bekliyor.',
  // What the CLI needs before the canary can pass: key variables (checked for presence only) or a sign-in.
  setup: { env: ['OPENAI_API_KEY'], optional: ['OPENAI_BASE_URL', 'OPENAI_MODEL'], login: null },
  prepare: () => prepareHome('qwen'),
  env: () => ({ QWEN_HOME: homeFor('qwen'), ...pass('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL') }),
  argv({ prompt, sessionId, mode }) {
    const exclude = mode === 'idea' ? [...QWEN_WRITE_TOOLS, ...QWEN_READ_TOOLS] : QWEN_WRITE_TOOLS;
    const a = ['--bare', '--auth-type', 'openai', '--approval-mode', 'plan', '--exclude-tools', exclude.join(','),
      '--max-tool-calls', '40', '--max-wall-time', '10m', '-o', 'stream-json', '--include-partial-messages'];
    if (sessionId) a.push('-r', sessionId);
    return ['qwen', [...a, prompt]];
  },
  parse(ev) {
    const out = [];
    if (ev.type === 'system' && ev.session_id) out.push({ kind: 'session', sessionId: ev.session_id });
    else if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') out.push({ kind: 'delta', text: ev.event.delta.text });
    else if (ev.type === 'assistant') {
      const text = (ev.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text) out.push({ kind: 'text', text });
      for (const c of ev.message?.content ?? []) if (c.type === 'tool_use') out.push({ kind: 'tool', name: c.name, input: c.input });
    } else if (ev.type === 'result') {
      out.push({ kind: 'result', text: ev.result ?? '', isError: !!ev.is_error, sessionId: ev.session_id, usage: usage(ev.usage) });
    }
    return out;
  },
};

// ---- Cursor CLI (cursor-agent) -----------------------------------------------
// Print mode "has access to all tools, including write and bash": the isolated
// cli-config.json denies shell, writes, web and MCP; --mode ask is read-only per
// --help [enforcement unverified]. Never pass -f/--force/--yolo or --approve-mcps.
// Headless runs stop at a workspace-trust prompt. --trust answers it, but trusting a folder also
// loads its own .cursor config (permissions, hooks, MCP), so it is passed only for folders without one.
const ownCursorConfig = (cwd) => !!cwd && existsSync(join(cwd, '.cursor'));
export const cursor = {
  vendor: 'cursor',
  name: 'Cursor',
  bin: 'cursor-agent',
  // Off until the canary passes on this machine ("Connect" in the UI, app/lib/connect.mjs).
  status: 'untested',
  modes: ['code', 'idea'],
  models: ['cursor'],
  note: 'Adaptör hazır: --mode ask ve ayrı ayarda Shell/Write/WebFetch/MCP yasak. Hesapla canary testi bekliyor.',
  // What the CLI needs before the canary can pass: key variables (checked for presence only) or a sign-in.
  setup: { env: ['CURSOR_API_KEY'], optional: [], login: 'CURSOR_CONFIG_DIR=~/.agent-council/cursor-home cursor-agent login' },
  prepare: (mode) => prepareHome('cursor', {
    'cli-config.json': JSON.stringify({ permissions: {
      allow: mode === 'idea' ? [] : ['Read(**)'],
      deny: ['Shell(*)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)', ...(mode === 'idea' ? ['Read(**)'] : [])],
    } }, null, 2),
  }),
  env: () => ({ CURSOR_CONFIG_DIR: homeFor('cursor'), ...pass('CURSOR_API_KEY') }),
  /** Why this folder cannot be a code-mode target for Cursor, as an API error code; null if it can. */
  refuses: (cwd) => (ownCursorConfig(cwd) ? 'target_has_cursor_config' : null),
  argv({ prompt, sessionId, cwd }) {
    const a = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--mode', 'ask', '--workspace', cwd];
    if (!ownCursorConfig(cwd)) a.push('--trust');
    if (sessionId) a.push('--resume', sessionId);
    return ['cursor-agent', [...a, prompt]];
  },
  parse(ev) {
    const out = [];
    if (ev.type === 'system' && ev.subtype === 'init') out.push({ kind: 'session', sessionId: ev.session_id, model: ev.model });
    else if (ev.type === 'assistant') {
      const text = (ev.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text) out.push({ kind: 'text', text });
    } else if (ev.type === 'tool_call' && ev.subtype === 'started') out.push({ kind: 'tool', name: Object.keys(ev.tool_call ?? {})[0] ?? 'tool', input: ev.tool_call });
    else if (ev.type === 'result') out.push({ kind: 'result', text: ev.result ?? '', isError: ev.subtype !== 'success', sessionId: ev.session_id, usage: null });
    return out;
  },
};

// ---- opencode (OpenRouter models) --------------------------------------------
// Most permissions default to "allow", bash and edit included, so everything is
// denied first and only read/grep/glob come back (code mode). The last matching
// rule wins, so "*" goes first. Never pass --auto.
export const opencode = {
  vendor: 'opencode',
  name: 'opencode (OpenRouter)',
  bin: 'opencode',
  // Off until the canary passes on this machine ("Connect" in the UI, app/lib/connect.mjs).
  status: 'untested',
  modes: ['code', 'idea'],
  models: ['opencode'],
  note: 'Adaptör hazır: OPENCODE_PERMISSION ile her şey yasak, yalnızca read/grep/glob açık. Kurulum ve canary testi bekliyor.',
  // What the CLI needs before the canary can pass: key variables (checked for presence only) or a sign-in.
  setup: { env: ['OPENROUTER_API_KEY'], optional: [], login: null },
  prepare: () => prepareHome('opencode'),
  env: (mode) => ({
    OPENCODE_CONFIG_DIR: homeFor('opencode'), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_PERMISSION: JSON.stringify(mode === 'idea' ? { '*': 'deny' } : { '*': 'deny', read: 'allow', grep: 'allow', glob: 'allow' }),
    ...pass('OPENROUTER_API_KEY'),
  }),
  argv({ prompt, sessionId, cwd, model }) {
    const a = ['run', '--format', 'json', '--dir', cwd];
    if (model && model !== 'opencode') a.push('-m', model);
    if (sessionId) a.push('-s', sessionId);
    return ['opencode', [...a, prompt]];
  },
  parse(ev) {
    const out = [];
    if (ev.sessionID) out.push({ kind: 'session', sessionId: ev.sessionID });
    if (ev.type === 'text' && ev.part?.text) out.push({ kind: 'text', text: ev.part.text });
    else if (ev.type === 'tool_use') out.push({ kind: 'tool', name: ev.part?.tool ?? 'tool', input: ev.part?.state?.input });
    else if (ev.type === 'step_finish') out.push({ kind: 'result', text: '', isError: false, sessionId: ev.sessionID, usage: usage(ev.part?.tokens), cumulative: false });
    else if (ev.type === 'error') out.push({ kind: 'error', message: ev.error?.message ?? String(ev.error) });
    return out;
  },
};

// ---- Kimi Code (kimi 0.27.x) -------------------------------------------------
// -p runs in "auto" permission and asks nothing, so the isolated config.toml is
// the only guard: a tool allowlist (Read/Grep/Glob, or none in idea mode) and
// deny rules for Bash/Write/Edit. Project AGENTS.md still loads. The stream-json
// field names are [unverified]; the parser accepts the OpenAI-style message shape.
export const kimi = {
  vendor: 'kimi',
  name: 'Kimi Code',
  bin: 'kimi',
  // Off until the canary passes on this machine ("Connect" in the UI, app/lib/connect.mjs).
  status: 'untested',
  modes: ['code', 'idea'],
  models: ['kimi'],
  note: 'Adaptör hazır ama riskli: -p modu her aracı onaysız çalıştırıyor; koruma yalnızca ayrı config.toml araç listesi. Canary testi bekliyor.',
  // What the CLI needs before the canary can pass: key variables (checked for presence only) or a sign-in.
  setup: { env: [], optional: [], login: 'KIMI_CODE_HOME=~/.agent-council/kimi-home kimi login' },
  prepare: (mode) => prepareHome('kimi', {
    'config.toml': [
      '[tools]', `enabled = ${mode === 'idea' ? '[]' : '["Read", "Grep", "Glob"]'}`, '',
      ...['Bash', 'Write', 'Edit', 'Agent', 'Skill', 'WebSearch', 'FetchURL'].flatMap((p) => ['[[permission.rules]]', 'decision = "deny"', `pattern = "${p}"`, '']),
    ].join('\n'),
    'skills/.keep': '',
  }),
  env: () => ({ KIMI_CODE_HOME: homeFor('kimi'), KIMI_DISABLE_TELEMETRY: '1', KIMI_CODE_NO_AUTO_UPDATE: '1' }),
  argv({ prompt, sessionId }) {
    const a = ['-p', prompt, '--output-format', 'stream-json', '--skills-dir', join(homeFor('kimi'), 'skills')];
    if (sessionId) a.push('-S', sessionId);
    return ['kimi', a];
  },
  parse(ev) {
    const out = [];
    const sid = ev.session_id ?? ev.sessionId;
    if (sid) out.push({ kind: 'session', sessionId: sid });
    if (ev.role === 'assistant') {
      const text = typeof ev.content === 'string' ? ev.content : (ev.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text) out.push({ kind: 'text', text });
      for (const c of ev.tool_calls ?? []) out.push({ kind: 'tool', name: c.function?.name ?? 'tool', input: c.function?.arguments });
    }
    return out;
  },
};

export const UNTESTED = { qwen, cursor, opencode, kimi };
