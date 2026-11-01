// Who speaks next. A rule decides when it can (a member challenged or asked someone directly);
// otherwise the chair-as-moderator is asked, and a rule picks the quietest member if its answer
// cannot be used. All pure functions of the conversation so far.

/** Signals about the conversation the moderator is told about. `turns`: [{ n, role, header }]. */
export function conversationState({ turns, members, spoken }) {
  const lastFour = turns.slice(-4).map((t) => t.role);
  return {
    // Two members trading turns: A B A B.
    looping: lastFour.length === 4 && new Set(lastFour).size === 2 && lastFour[0] === lastFour[2],
    // Three agreeing turns in a row: nobody is testing anything.
    drift: turns.length >= 3 && turns.slice(-3).every((t) => ['agree', 'build'].includes(t.header.stance)),
    quiet: members.filter((r) => spoken[r] === 0),
  };
}

/**
 * The right of reply: a member challenged or questioned someone else, so that member answers,
 * unless the two are looping, quiet members are being left out too long, or a note is waiting.
 */
export function rulePick({ n, turns, members, pendingNote, state }) {
  const last = turns.at(-1);
  if (!last || pendingNote || state.looping) return null;
  const { stance, addresses } = last.header;
  if (!['challenge', 'question'].includes(stance) || !members.includes(addresses) || addresses === last.role) return null;
  if (state.quiet.length && n > members.length + 1) return null;
  return { n, role: addresses, replyTo: `T${last.n}`, why: 'Direct challenge or question: right of reply', whyCode: 'direct', source: 'rule' };
}

/**
 * Read the moderator's one-line answer. Returns { end: reason } (allowed only after the
 * minimum turns), a pick, or null when the line cannot be used.
 */
export function parseModeratorLine(line, { n, members, minTurns }) {
  const text = String(line ?? '').trim();
  if (/^END/i.test(text) && n > minTurns) return { end: text.replace(/^END[:\s—-]*/i, '') };
  const m = text.match(/NEXT:\s*(\S+)\s+REPLY_TO:\s*(\S+)\s+WHY:\s*(.+)/);
  if (m && members.includes(m[1])) return { pick: { n, role: m[1], replyTo: m[2], why: m[3].trim(), source: 'chair' } };
  return null;
}

/** When the moderator's answer is unusable: the member who has spoken least answers the last turn. */
export function quietestPick({ n, turns, members, spoken }) {
  const role = [...members].sort((a, b) => spoken[a] - spoken[b])[0];
  const last = turns.at(-1);
  return { n, role, replyTo: last ? `T${last.n}` : `O-${members.find((x) => x !== role)}`, why: 'Quietest member', whyCode: 'quiet', source: 'rule' };
}
