# Motion before the council

> Build and open-source a multi-agent "council/courtroom" app where different
> coding agents debate an idea or a codebase live, shown in a polished web UI.

Owner: a frontend developer who wants to build this and publish it as open
source, with a very good interface. Hard requirement from the owner: members
run as **agent CLIs in headless mode**, NOT through direct model APIs.

## Proposal on the table

**Courtroom UI**
- Chair = judge, skeptic = prosecutor, optimist = defense,
  deterministic / security = expert witnesses, others = jury.
- Each seat shows its model/agent name and colour; the active speaker is
  highlighted and its reply streams in live.
- "Objection!" when a member challenges a specific earlier message (linked).
- Judge rulings; verdict panel with jury vote and minority opinion.
- The user can intervene as "the court": ask a question, call a witness, stop
  the debate.
- Token / cost meter.

**Integration (headless CLIs)**
- Members are agent CLIs: Claude Code (`claude -p --output-format
  stream-json`), Codex, Gemini CLI, Kimi CLI and similar, so each member can
  read the repo with its own tools and use the user's existing subscriptions.
- Known downsides to debate: per-turn process start-up is slow; every CLI has
  different flags and versions that change often (Spotify's Xirp keeps
  per-agent version gates for this); session resume and streaming formats
  differ per CLI.
- Help output of the CLIs installed on the owner's machine is in
  `cli-help/<cli>.txt` next to this file (captured 2026-10-30). Anything not
  shown there is unverified: label it `[assumption]`.

**Architecture sketch**
Node/TS orchestrator → one adapter per CLI → event stream (SSE) → web UI;
transcripts in local SQLite so past "cases" can be replayed. Rough MVP
estimate 4–6 days (unverified).

**Open-source angle**
Licence, install story (users must already have the CLIs installed and logged
in), cross-platform support, each vendor's ToS for automated/headless use,
naming, what makes it stand out.

## What the council must deliver
Chair verdict: go / no-go, MVP scope, the riskiest assumption, and the first
3 build steps.
