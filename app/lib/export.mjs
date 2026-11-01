// Turn a stored case into a portable file: Markdown for people, JSON (the raw
// event list plus case metadata) for tools. Streaming deltas and usage ticks
// are left out of both; the completed turns carry the same text.
import { dataOf } from './turns.mjs';

const HEAD = {
  en: { mode: 'Mode', code: 'codebase', idea: 'idea', target: 'Target', question: 'Question', date: 'Date', council: 'Council',
    member: 'Member', model: 'Model', vote: 'Final vote', openings: 'Blind openings', conversation: 'Conversation',
    closings: 'Closings', verdict: 'Verdict', replyTo: 'replying to', note: 'Note', status: 'Status', you: 'Note from the person running the hearing' },
  tr: { mode: 'Mod', code: 'kod tabanı', idea: 'fikir', target: 'Hedef', question: 'Soru', date: 'Tarih', council: 'Konsey',
    member: 'Üye', model: 'Model', vote: 'Son oy', openings: 'Kör açılışlar', conversation: 'Konuşma',
    closings: 'Kapanışlar', verdict: 'Karar', replyTo: 'yanıtladığı', note: 'Not', status: 'Durum', you: 'Duruşmayı yürütenin notu' },
};

const SKIP = new Set(['turn.delta', 'turn.started', 'usage']);

export function caseJson(c, events) {
  return {
    case: { id: c.id, title: c.title, mode: c.mode, target: c.target, source: c.source, status: c.status, createdAt: c.created_at },
    events: events.filter((e) => !SKIP.has(e.type)),
  };
}

const vote = (v) => (v?.vote ? `${v.vote}${v.confidence != null ? ` · ${Number(v.confidence).toFixed(2)}` : ''}` : '—');

export function caseMarkdown(c, events, lang = 'en') {
  const h = HEAD[lang] ?? HEAD.en;
  const of = (t) => dataOf(events, t);
  const started = of('case.started')[0] ?? {};
  const members = of('member.registered');
  const name = (role) => members.find((m) => m.role === role)?.label ?? role;
  const closings = Object.fromEntries(of('closing.completed').map((d) => [d.role, d]));
  const out = [`# ${c.title}`, ''];
  out.push(`- **${h.mode}:** ${h[c.mode] ?? c.mode}`);
  if (c.target) out.push(`- **${h.target}:** \`${c.target}\``);
  if (started.focus) out.push(`- **${h.question}:** ${started.focus}`);
  if (c.created_at) out.push(`- **${h.date}:** ${new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  out.push(`- **${h.status}:** ${c.status}`, '');

  out.push(`## ${h.council}`, '', `| ${h.member} | ${h.model} | ${h.vote} |`, '|---|---|---|');
  for (const m of members.filter((x) => !x.chair && x.role !== 'chair')) out.push(`| ${m.label} | ${m.model} | ${vote(closings[m.role]?.vote)} |`);
  out.push('');

  const openings = of('opening.completed');
  if (openings.length) {
    out.push(`## ${h.openings}`, '');
    for (const o of openings) out.push(`### ${name(o.role)} · ${vote(o.vote)}`, '', o.body.trim(), '');
  }

  // Conversation in event order, with moderator notes and the user's notes inline.
  const talk = events.filter((e) => ['turn.completed', 'note', 'user.note'].includes(e.type));
  if (talk.length) {
    out.push(`## ${h.conversation}`, '');
    for (const e of talk) {
      const d = e.data;
      if (e.type === 'note') { out.push(`> ${h.note}: ${d.text}`, ''); continue; }
      if (e.type === 'user.note') { out.push(`> **U${d.k} · ${h.you}:** ${d.text}`, ''); continue; }
      const meta = [d.header?.stance, d.header?.replyTo ? `${h.replyTo} ${d.header.replyTo}` : null].filter(Boolean).join(' · ');
      out.push(`### T${d.n} — ${name(d.role)}${meta ? ` (${meta})` : ''}`, '', d.body.trim(), '');
    }
  }

  const closed = of('closing.completed');
  if (closed.length) {
    out.push(`## ${h.closings}`, '');
    for (const d of closed) out.push(`### ${name(d.role)} · ${vote(d.vote)}`, '', d.body.trim(), '');
  }

  const verdict = of('verdict.completed')[0];
  if (verdict) out.push(`## ${h.verdict}`, '', verdict.markdown.replace(/^# .*\n+/, '').trim(), '');
  return `${out.join('\n').trim()}\n`;
}

/** A file name from the case title: letters, digits and dashes only. */
export const exportName = (c, ext) => {
  const slug = (c.title || c.id).replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'case';
  return `${slug}.${ext}`;
};

/** Export formats, one entry each: what the file is called, its type, and how it is written. */
export const EXPORTERS = {
  md: { mime: 'text/markdown; charset=utf-8', render: (c, events, lang) => caseMarkdown(c, events, lang) },
  json: { mime: 'application/json; charset=utf-8', render: (c, events) => JSON.stringify(caseJson(c, events), null, 2) },
};
