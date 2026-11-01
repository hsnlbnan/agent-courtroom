// Claude Code adapter: headless `claude -p` with stream-json output.
// --restricted alone is NOT read-only, so the tool list is pinned explicitly,
// and --tools must be last (it is variadic and would swallow a trailing prompt).
// Read/Grep/Glob are confined to the cwd by --restricted, but secrets inside the
// target are still readable; deny them explicitly (verified: Read and Grep are
// both blocked by the canary test).
export const SECRET_DENY = ['**/.env*', '**/*.pem', '**/*.key', '**/*.p12', '**/id_*', '**/.git/config', '**/.npmrc', '**/.netrc', '**/*credentials*', '**/*secret*']
  .map((g) => `Read(${g})`);

// Model aliases the claude CLI accepts for --model (verified: haiku, sonnet, opus, fable).
export const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

export const claude = {
  vendor: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  status: 'enabled',
  modes: ['code', 'idea'],
  models: CLAUDE_MODELS,
  note: 'Salt okuma: --tools Read,Glob,Grep + deny kuralları. Canary testini geçti.',

  argv({ prompt, sessionId, model, mode, budgetUsd }) {
    const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--restricted', '--strict-mcp-config'];
    if (model) a.push('--model', model);
    if (sessionId) a.push('--resume', sessionId);
    // Applies to API-key billing; on a subscription login it may not bite.
    if (budgetUsd) a.push('--max-budget-usd', String(budgetUsd));
    a.push('--settings', JSON.stringify({ permissions: { deny: SECRET_DENY } }));
    a.push('--tools', mode === 'idea' ? '' : 'Read,Glob,Grep');
    return ['claude', a];
  },

  // Normalize one stream-json event. Returns a list of { kind, ... }.
  parse(ev) {
    const out = [];
    if (ev.type === 'system' && ev.subtype === 'init') {
      out.push({ kind: 'session', sessionId: ev.session_id, model: ev.model, tools: ev.tools });
    } else if (ev.type === 'stream_event') {
      const d = ev.event?.delta;
      if (ev.event?.type === 'content_block_delta' && d?.type === 'text_delta') out.push({ kind: 'delta', text: d.text });
    } else if (ev.type === 'assistant') {
      const text = ev.message?.content?.filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text) out.push({ kind: 'text', text });
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') out.push({ kind: 'tool', name: c.name, input: c.input });
      }
    } else if (ev.type === 'result') {
      const u = ev.usage ?? {};
      const perTurn = Object.values(ev.model_usage_since_last_result ?? {})
        .reduce((s, m) => s + (m.costUSD ?? 0), 0);
      out.push({
        kind: 'result', text: ev.result ?? '', isError: !!ev.is_error, sessionId: ev.session_id,
        usage: {
          inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
          costUsd: perTurn || null,
        },
      });
    }
    return out;
  },
};
