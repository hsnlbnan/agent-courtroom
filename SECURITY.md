# Security policy

Agent Council runs coding-agent CLIs on your machine against folders you point it at, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please report privately, not in a public issue: use **Security → Report a vulnerability** on the GitHub repository (private vulnerability reporting). Include what you did, what you expected, what happened, and the version (`npx agent-courtroom --version` or `package.json`).

You can expect an acknowledgement within a week. A fix or a documented mitigation follows as soon as it is understood; you are credited in the release notes unless you ask not to be.

## Supported versions

Only the latest published version gets fixes while the project is pre-1.0.

## What is in scope

- The local server (`app/`): reaching the API without the per-run token, from another origin or host, or from outside `127.0.0.1`; reading or writing files outside what a case is allowed to touch; command injection into the spawned CLIs.
- Member isolation: a member CLI reading outside its target, reading files the deny rules exclude (`.env*`, keys, `id_*`, `.npmrc`), writing files, or running commands, including through prompt injection planted in the target.
- Data handling: secrets surviving the event masking into the case database or exports.

The safety model, the flags each CLI runs with, and the known limits are in the README ("Safety model"). One limit is known and documented rather than a bug: in code mode, Codex can read `.env` and key files **inside** the target folder.

## Out of scope

- What a model provider does with text after it is sent to them; that is governed by your agreement with the provider (see "What leaves your machine" in the README).
- Attacks that need an attacker already running code as your user.
