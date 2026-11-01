# Agent Council app — architecture (v0)

Zero runtime dependencies: Node ≥ 22.5 (`node:http`, `node:sqlite`,
`node:child_process`) and plain HTML/CSS/JS in `public/`.

```
CLI (claude -p / codex exec)            reports/<case>/ folder
        │ stream-json / JSONL                    │
        ▼                                        ▼
  adapters/<cli>.mjs  ── normalized ──►  lib/importer.mjs
        │                                        │
        ▼                                        ▼
  lib/orchestrator.mjs ──► events ──► lib/store.mjs (SQLite, ~/.agent-council/council.db, 0600)
                                            │
                                            ▼
                              server.mjs (127.0.0.1, token, SSE)
                                            │  live: as events happen
                                            │  replay: stored events, re-timed
                                            ▼
                                     public/ (one consumer path)
```

Replay and live use the same event stream and the same UI code.

## Modules

Each module has one reason to change. Adding a provider, a route, a follow-up kind or an export
format is one entry in one place.

| Module | Owns |
|---|---|
| `server.mjs` | Configuration (port, token, data dir) and wiring; Host/Origin/token checks; shutdown that stops every child process |
| `lib/api.mjs` | The `/api` route table (`method`, `path`, `auth`, `handle`) and route matching (404 vs 405) |
| `lib/http.mjs`, `lib/static.mjs`, `lib/sse.mjs` | JSON responses and bodies (413 over 64 KB), static files with per-page CSP hashes, the event stream (replay + live tail) |
| `lib/new-case.mjs` | A new-case request checked and turned into `startCase` options (error codes are API) |
| `lib/cases.mjs` | Live cases (at most 3 at once, `too_many_live`) and ideas typed in the form (`cases/<id>/idea.md`, 0600) |
| `lib/orchestrator.mjs` | The hearing flow and a case's lifecycle (exactly one `case.ended`, a final status) |
| `lib/prompts.mjs` | Every prompt, as pure functions of the case; role briefs and the protocol are files |
| `lib/moderation.mjs` | Who speaks next: right of reply, the moderator's answer, the quietest-member fallback |
| `lib/caller.mjs` | One CLI call in a case: adapter, time limit, one retry, per-turn usage, notes on failure |
| `lib/context.mjs` | The shared context (idea text, or file tree + README + manifest) |
| `lib/followup.mjs` | Follow-up kinds (`FOLLOWUPS`), analyses with their event bookkeeping, appeal options |
| `lib/export.mjs` | Export formats (`EXPORTERS`: md, json) |
| `lib/providers.mjs`, `lib/connect.mjs` | What this machine can run (installed, version, catalog models, connected modes); the canary that connects an untested provider |
| `adapters/index.mjs` | The adapter registry: one descriptor per CLI (`vendor`, `bin`, `status`, `modes`, `models`, `setup`, `argv`, `parse`, `env`, `prepare`, `discoverModels`); `resolveModel` maps `sonnet` / `codex` / `codex:<slug>` to an adapter |
| `adapters/run.mjs`, `adapters/process.mjs` | Running one CLI call (never rejects; a CLI that cannot start resolves with exit -1); process groups, SIGTERM→SIGKILL, the registry of every running child |

Vocabulary: a **provider** is a CLI as the user sees it (Claude Code, Codex); its **adapter** is the
code that runs it; events call the same thing `vendor` (kept for compatibility with stored cases).

## Event envelope

Every event: `{ seq, ts, type, data }`. `seq` is per case and starts at 1.
`ts` is milliseconds since the case started.

| type | data |
|---|---|
| `case.started` | `{ title, mode: "code"\|"idea", target, focus, vendors: ["claude"], maxTurns }` |
| `member.registered` | `{ role, label, model, vendor, seat, chair? }` |
| `opening.completed` | `{ role, body, vote: { vote, confidence } \| null }` |
| `moderator.pick` | `{ n, role, replyTo, why, source: "rule"\|"chair" }` |
| `turn.started` | `{ n, role, replyTo }` |
| `turn.delta` | `{ n, text }` (appended to the live turn) |
| `turn.completed` | `{ n, role, header: { replyTo, addresses, stance }, body, mismatch, citations: [{ ref, verified }] }` |
| `closing.completed` | `{ role, body, vote: { role, vote, confidence, conditions, findings } \| null }` |
| `verdict.completed` | `{ markdown, chair: { verdict, confidence, reason, consensus, disagreements, actions, ... } }` |
| `usage` | `{ role, phase, inputTokens, outputTokens, costUsd, ms }` |
| `note` | `{ text, kind: "orchestrator"\|"end", code?, params? }`: `text` is the English fallback; the UI translates known `code`s (`retry`, `gave_up`, `cli_exit`, `moderator_end`, `error`) |
| `user.note` | `{ k, text }`: a note from the person running a live hearing (log key `U<k>`); the next turn answers it |
| `case.stopped` | `{ reason }` |
| `case.ended` | `{ endedBy: "cap"\|"chair"\|"replay"\|"stopped"\|"error" }`; every case ends with exactly one |

- `mismatch` is true when the body asks a question (`?`) but the stance is not `question` or `challenge`.
- `verified` is true when the cited file exists under the target and the line is in range, false when it doesn't, and null when the citation can't be checked (idea mode, or not a path).

## SQLite

```
cases(id TEXT PK, title, mode, target, source "live"|"import", status, created_at)
events(case_id, seq, ts, type, data JSON, PRIMARY KEY(case_id, seq))
```

## HTTP

The server binds only to 127.0.0.1. It prints one random token in the start URL.

| Route | Auth | |
|---|---|---|
| `GET /` + static | none | No data is in static files |
| `GET /api/cases` | header `X-Council-Token` | |
| `GET /api/cases/:id/stream?token=&speed=` | query token (EventSource can't send headers) | SSE: stored events re-timed, then live tail |
| `GET /api/providers` | header token | Provider list with install state. The `--version` probes run in parallel off the event loop, are cached for 5 minutes and warmed at startup (a synchronous probe used to freeze every stream for several seconds) |
| `GET /api/roles` | header token | Selectable council roles (model from `.claude/agents/*.md`) |
| `GET /api/suggest?path=&mode=` | header token | Folder suggestions for the new-case form. It lists only under `$HOME`; never dotfiles, symlinks or credential directories (`lib/targets.mjs`, tests in `test/targets.test.mjs`) |
| `POST /api/cases/:id/followup` | header token | `{ kind: "ideas"\|"risks"\|"appeal", lang }` on a finished case with a verdict. `ideas`/`risks`: one chair-led analysis over the transcript (long cases keep their start and end, the middle is trimmed), stored on the case as `followup.started` / `followup.completed` / `followup.failed`, returned as Markdown. `appeal`: a new case on the same target and bench whose question is the open disagreements, with the earlier verdict as context (`case.started.appealOf`). 409 while live or without a verdict |
| `POST /api/cases/:id/note` | header token | `{ text }` (≤ 500 chars) into a live hearing: every member sees it on their next turn, the moderator points the next turn at it, the chair reads it. 409 when not live |
| `GET /api/cases/:id/export?format=md\|json&lang=en\|tr` | header token | The case as a Markdown report or JSON (case + events, without deltas and usage) |
| `POST /api/cases` | header token | `{ idea \| target, mode?, members, models, chairModel, focus, maxTurns, custom, lang }` → `{ id }` (201). 409 `too_many_live` past 3 live cases |
| `GET /api/browse?path=` | header token | One folder's sub-folders and .md/.txt files for the in-app picker (same fence as suggest) |
| `GET\|POST\|DELETE /api/providers/:id/connect` | header token | The canary connection test of an untested provider: status, start, forget |
| `POST /api/cases/:id/stop` | header token | Stops the running CLIs (SIGTERM, then SIGKILL) and emits `case.stopped` |

A wrong method on a known path is 405; an unknown export format is 400 `bad_format`.

Every `/api` request checks that `Host` is `127.0.0.1:<port>` or `localhost:<port>`, and that `Origin`, if present, is the same.

## CLI safety

- Claude, code mode: `-p … --output-format stream-json --verbose --include-partial-messages --restricted --strict-mcp-config --tools Read,Glob,Grep` (`--tools` goes last).
- Claude, idea mode: the same flags, with `--tools ""`.
- Both modes also pass `--settings` with `permissions.deny` for `Read(**/.env*)`, keys, `id_*`, `.git/config` and `.npmrc`.
- Targets must be under `$HOME` and cannot be `$HOME` itself (so `/Volumes/...` is refused too). The credential/app-data list (`.ssh`, `.aws`, `.gnupg`, `.config`, `.kube`, `.docker`, `.claude`, `.codex`, `.agent-council`, `.azure`, `.gcloud`, `.password-store`, `Library`) is matched only as the first folder under `$HOME`, so a repo with its own `Library/` is fine. The one carve-out is iCloud Drive documents, `~/Library/Mobile Documents/com~apple~CloudDocs`; other app containers in `Library` stay refused.
- `POST /api/cases` takes either `idea` (inline text, ≤ 12,000 chars) or `target` (a path; free text in `target` is treated as an inline idea). Without `mode`, a folder means code mode and a `.md`/`.txt` file idea mode. An inline idea is written by the server to `<db dir>/cases/<id>/idea.md` (dir 0700, file 0600) and runs like an idea file, so citations stay `idea.md:<line>`; that file skips `checkTarget` because the server wrote it.
- Stored events are redacted for common credential shapes.
- Codex is enabled in both modes and is never the chair. In code mode its profile reads the target folder, so it can read `.env` files there (Claude's deny rules have no Codex equivalent); the composer warns about this. It runs with the permission profile (`:minimal` + cwd read-only; plain `-s read-only` leaked the canary), an empty per-case cwd under `~/.agent-council/sandbox/`, and its own `CODEX_HOME` so the global `AGENTS.md` is not loaded.
- In idea mode members get the idea text inline with line numbers and are told they have no tools; stray `<invoke>` text is stripped from stored turns.
- Each CLI call has a timeout (opening 240 s, turn 180 s, pick 90 s, verdict 300 s) and one retry.
- Each member CLI is spawned in its own process group (`detached: true`) and stopped as a group (SIGTERM, then SIGKILL after 2–3 s), so anything it started stops too. The server stops live cases on SIGINT, SIGTERM and SIGHUP; if it crashes outright, member CLIs run on to their own completion.
- Every child process gets `spawn(argv[])` with no shell, `stdio: ['ignore','pipe','pipe']`, and an env allowlist: `PATH HOME USER SHELL TMPDIR LANG`.
- Model output is rendered with `textContent` only, never with `innerHTML`.

## Languages

The web UI is English or Turkish (`web/lib/i18n.tsx`). `POST /api/cases` takes `lang: "en"|"tr"` (default `en`); the council writes openings, turns, moderator reasons and the verdict in that language. API errors are English and carry a `code` the UI translates. Rule-based moderator picks carry `whyCode` (`direct`, `quiet`).
