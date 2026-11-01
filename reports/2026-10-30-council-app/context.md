# Council context — "council app" motion

- Date: 2026-10-30
- Motion: `~/Documents/Github/agent-council/reports/2026-10-30-council-app/motion.md` (read it first)
- Line numbers in this file are not the cited files' line numbers. Cite the
  original file after opening it.

## Evidence you can read
1. **Motion:** `reports/2026-10-30-council-app/motion.md`
2. **CLI help (real, captured today):** `reports/2026-10-30-council-app/cli-help/` — claude 2.1.310,
   codex-cli 0.159.0, gemini 0.62.0, kimi 0.27.0, qwen 0.17.1,
   cursor-agent 2026.01.23. Installed on the owner's Mac: claude, codex,
   gemini, kimi, qwen, cursor-agent. Not installed: opencode, aider.
3. **The working prototype (path A)** in this repo:
   `README.md`, `council.json`, `council/protocol.md`,
   `.claude/agents/council-*.md`, `.claude/skills/council/SKILL.md`,
   design doc `docs/superpowers/specs/2026-10-30-agent-council-design.md`.
4. **A real (cancelled) prototype run** on another project:
   `reports/2026-10-30-isim-analiz/conversation.md` and `round1/` — shows
   what the turn-based conversation actually produced.

## Orchestrator observations from running the prototype today (measured, not files)
- Blind openings: 6 members in parallel, 25–180 s each (opus slowest).
- Conversation turns via resumed subagents: 17–30 s per member turn; chair
  moderator picks 6–82 s. So ~1 min per turn including moderation.
- Resuming the same agent per turn worked and kept its earlier reading.
- Members' tokens per turn context: ~100–180k (each resumes its full history).
- Problems seen: members cited context-file line numbers as if they were the
  real file's (caught by the deterministic member in T5); T3–T6 drifted into
  polite "build" agreement until the moderator was told to seek a clash;
  a member asked a question but labelled the STANCE "build", so the
  auto-reply rule didn't fire.
- Agent definitions added mid-session only became available later in the
  session (hot-load delay).
- This prototype runs **inside one Claude Code session using Claude
  subagents**, not separate CLI processes; it does not test multi-vendor
  headless CLIs at all.
