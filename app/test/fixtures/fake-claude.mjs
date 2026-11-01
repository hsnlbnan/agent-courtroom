#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: answers each kind of council prompt in
// the expected shape and appends every prompt to prompts.log next to itself
// (child processes get an allow-listed env, so the path cannot come from env).
import { appendFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const prompt = process.argv[process.argv.indexOf('-p') + 1] ?? '';
appendFileSync(join(dirname(realpathSync(process.argv[1])), 'prompts.log'), `${JSON.stringify(prompt)}\n`);
const fence = '```';
const json = (o) => `\n${fence}json\n${JSON.stringify(o)}\n${fence}`;
const say = (text) => {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: `s-${process.pid}` }));
  console.log(JSON.stringify({ type: 'result', result: text, session_id: `s-${process.pid}`, usage: {} }));
};
const answer = () => {
  if (prompt.includes('MODERATOR')) return say('NEXT: skeptic REPLY_TO: U1 WHY: answer the note');
  // T1 challenges a member, so without a pending note the reply rule would pick T2.
  if (prompt.includes('Your turn: T1')) return say('REPLY_TO: U1\nADDRESSES: optimist\nSTANCE: challenge\nI disagree with optimist (`idea.md:1`).');
  if (prompt.includes('Your turn')) return say('REPLY_TO: U1\nADDRESSES: none\nSTANCE: build\nAnswering the note (`idea.md:1`).');
  // The verdict prompt quotes the closings, so check for it first.
  // A case whose focus says FAIL_VERDICT_AUTH gets a signed-out judge.
  if (prompt.includes('Write the verdict') && prompt.includes('FAIL_VERDICT_AUTH')) {
    process.stderr.write('Invalid API key · Please run /login\n');
    process.exit(1);
  }
  if (prompt.includes('Write the verdict')) return say(`# v${json({ verdict: 'go', confidence: 0.6, reason: 'r' })}`);
  // Round-1 prompts carry the whole protocol, which mentions closing statements too.
  if (prompt.includes('Round 1')) return say('Opening. Vote: go 0.6');
  if (prompt.includes('closing statement')) return say(`Closing.${json({ role: 'x', vote: 'go', confidence: 0.6 })}`);
  return say('Opening. Vote: go 0.6');
};
// Openings are slow, so a test can add a note while they run.
setTimeout(answer, prompt.includes('Round 1') ? 800 : 10);
