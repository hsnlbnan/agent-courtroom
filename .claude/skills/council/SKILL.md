---
name: council
description: Run an Agent Council on a target folder - 6 role-played read-only members give blind opening assessments, then hold a live turn-by-turn conversation (replying to and challenging each other, moderated by a chair), give closing votes, and the chair writes the verdict. Use when the user types /council <path> or asks to have the council evaluate a project.
argument-hint: <path-to-target> [focus question]
---

# /council — run the Agent Council

Arguments: `$ARGUMENTS` = target path (required), optionally followed by a focus
question (e.g. "is this ready to launch?"). Without a focus question the council
does a general evaluation: is the project sound, valuable, and worth continuing,
and what should happen next.

You are the **orchestrator**. Members and the chair only read; you are the only
one who writes files. Agent results only come back to you, so write every
output to disk before moving on.

Flow: context → blind openings (parallel) → conversation (one speaker at a
time, shared transcript) → closing statements (parallel) → chair verdict.

Paths below are relative to the agent-council repo root (the folder that holds
`council.json`).

## 0. Setup
1. Resolve the target to an absolute path; stop with a clear message if it does
   not exist.
2. Read `council.json` (`members`, `chair`, `reportsDir`, `language`,
   `maxTurns`, `minTurnsBeforeEnd`) and `council/protocol.md`.
3. For each member and the chair, note its `.claude/agents/<name>.md` path and
   `model:` (used by the fallback in "Spawning").
4. Run dir: `<reportsDir>/<YYYY-MM-DD>-<target-basename>/`. If it already
   exists, append `-2`, `-3`, ...
5. Track progress with the task list: context, openings, conversation,
   closings, chair, report.

## 1. Context (written once, read by everyone)
Build `<run>/context.md` with Bash:
- Target path, focus question, date, and this line: "Line numbers in this
  file are not the target's line numbers. Cite the original file, e.g.
  `package.json:36`, after opening it."
- Filtered file tree: `find <target> -type f` excluding `node_modules`, `.git`,
  `.next`, `dist`, `build`, `coverage`, `*.lock`, `*lock.json`, `bun.lockb`,
  images/fonts/media, and `.env*` (list `.env*` names only, in a separate line
  "secret files present (not read): ..."). Collapse big content folders to a
  count plus 3 examples.
- `README*` (first 150 lines) and the main manifest (`package.json`,
  `pyproject.toml`, `Cargo.toml`, `go.mod`, ...).
- `git -C <target> log --oneline -10` if it is a repo.
Never cat `.env*` or key files.

## Spawning
- Preferred: `Agent` with `subagent_type: <name>` (e.g. `council-skeptic`).
- Fallback, if that type is "not found" (agents load at session start):
  `subagent_type: general-purpose`, `model:` = the role file's `model:`, and
  start the prompt with "Read your role brief: <abs path to role file> (ignore
  frontmatter; you are this role)" plus "Read-only: use only Read, Grep and
  Glob. Do not edit, write or run commands."
- Pass **absolute file paths, not pasted text**. Every first prompt has: the
  protocol path ("read and follow it"), target path, focus question, "Read the
  shared context first: <context.md path>", the step instruction, "Your final
  message must be only your output", and "Write in <language>. Keep file
  paths, code and JSON keys as-is."
- Keep every member's and the chair's agent id. All later steps **continue the
  same agent with `SendMessage`** (load it with ToolSearch if deferred), so each
  keeps what it already read. If continuation fails, spawn a fresh agent with
  its `round1/<role>.md` and `conversation.md` paths.
- Reading results: the agent's final report arrives as a hand-back message; its
  text is also the last `SubagentHandback` tool call in the agent's output
  file (`output_file` in the spawn result). Save it with the scripts in
  `council/tools/` instead of retyping it:
  - `python3 council/tools/agent_report.py <output_file> <run>/round1/<role>.md`
  - `python3 council/tools/append_turn.py <output_file> <run>/conversation.md <n> <role>`
    (appends `## T<n> — <role>` and prints the parsed header lines)
  - `python3 council/tools/save_closing.py <output_file> <run>/closing/<role>.md`
    (fails if the JSON vote block is missing or invalid)

## 2. Blind openings
Spawn **all members in one message**. Instruction: "Round 1 — blind
assessment. Follow the Round 1 shape." No member sees another's output. Save
each to `<run>/round1/<role>.md` (`<role>` = name without `council-`).

Then create `<run>/conversation.md`: a header, then for each member a section
`## O-<role>` with its summary line, its provisional vote line and a link to
`round1/<role>.md`, then `# Conversation`.

## 3. Conversation
Spawn the chair as **moderator** (Spawning rules). Its prompt: role brief,
protocol, context, round-1 files, `conversation.md`; the moderator job (surface
the sharpest real disagreements, let ideas be built on and challenged, pull in
quiet members, stop repetition, may end only after `minTurnsBeforeEnd` turns);
and the reply format, exactly one line:
`NEXT: <role> REPLY_TO: <T<k>|O-<role>> WHY: <≤15 words>` or `END: <reason>`.

Loop for n = 1 … `maxTurns`:
1. **Pick the speaker** with these rules, in order (no model call unless the
   rule says chair):
   - If T(n-1) has `STANCE` challenge or question and `ADDRESSES` is another
     member, that member speaks, replying to T(n-1).
   - Loop guard: if the last 4 turns alternate between the same two members,
     ask the chair instead.
   - If any member has not spoken by T8, or has been silent for 7 turns, ask
     the chair and tell it which members are quiet.
   - Otherwise ask the chair (SendMessage: "Pick the speaker for T<n>.").
   - Agreement drift: if the last 3+ turns were all `agree`/`build`, tell the
     chair so in the same message and ask it to point the next speaker at a
     real unresolved clash.
   Append the chair's line to `conversation.md` as `> Moderator: ...`. If it
   says `END`, stop the loop.
2. **Ask the member** (SendMessage to its agent): "Your turn: T<n>. Read
   `<conversation.md path>` from where you last left off. Reply to <REPLY_TO>
   (<WHY, or 'you were challenged'>). Follow the 'Conversation turn' shape: the
   three header lines, then ≤120 words with evidence. Final message = the turn
   only. Write in <language>."
3. **Append** the reply as `## T<n> — <role>` to `conversation.md`. Check the
   three header lines parse and `REPLY_TO` points to an existing turn; if not,
   ask the member once to resend in the right shape.

## 4. Closing statements
Send **all members in one message**: "The conversation is over. Read the full
`conversation.md`, then give your closing statement in the protocol's
'Closing statement' shape, ending with the JSON block." Save each to
`<run>/closing/<role>.md`. Parse each JSON block; if one is missing or invalid,
ask that member once to resend only the JSON.

## 5. Chair verdict
Continue the chair: "The conversation is over. Read `conversation.md` and every
file in `closing/`. Where a disagreement turns on a citation, open the cited
lines yourself. Write the verdict in this exact shape:"

```
# Council verdict — <target name>
**Verdict:** go | no-go | conditional — confidence 0.0–1.0
**One-line reason:** ...

## Vote tally
| Member | Model | Vote | Confidence |

## Consensus
- ... (evidence)

## Unresolved disagreements
### <topic>
- **<role>:** position — evidence (turns)
- **<role>:** position — evidence (turns)
- **Chair's read of the files:** ... (cite what you checked)

## Top actions
1. ... — why — evidence

## How the conversation moved
3–5 bullets citing turn numbers: who changed whose mind, what was conceded,
which challenge mattered most.
```
then one fenced JSON block:
`{"verdict", "confidence", "reason", "consensus": [], "disagreements": [{"topic", "positions": [{"role", "position"}], "chair_read"}], "actions": []}`.

Write the Markdown (without the JSON block) to `<run>/chair.md`.

## 6. council.json
Write `<run>/council.json`:
```json
{
  "target": "<abs path>",
  "focus": "<question or null>",
  "date": "<YYYY-MM-DD>",
  "mode": "conversation",
  "turns": 0,
  "ended_by": "cap | chair",
  "roster": [{"role": "...", "agent": "council-...", "model": "..."}],
  "chair_model": "...",
  "votes": [ /* closing JSON blocks */ ],
  "chair": { /* chair JSON block */ }
}
```
Validate it with `python3 -m json.tool`.

## 7. Secret check, then report
- Grep the run dir for likely secret values (long base64/hex strings, `sk-`,
  `AIza`, `ghp_`, `-----BEGIN`, `KEY=`, `SECRET=`, `TOKEN=`) without printing
  matches in full. Redact any real hit in place as `[REDACTED]` and tell the
  user.
- Reply to the user with: the verdict line, vote tally, top 3 actions, 2–3
  short turns from `conversation.md` that show the exchange, and links to
  `chair.md`, `conversation.md` and `council.json`.
