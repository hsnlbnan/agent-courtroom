// Council roles available to a new case: read from .claude/agents/council-*.md
// (model from frontmatter), with a short Turkish lens for the picker.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Display names for the built-in roles in the case record (the UI translates them itself).
const ROLE_LABELS = {
  optimist: 'İyimser', skeptic: 'Şüpheci', deterministic: 'Deterministik',
  'user-advocate': 'Kullanıcı savunucusu', 'cost-ops': 'Maliyet / ops', security: 'Güvenlik', chair: 'Başkan',
};
export const roleLabel = (r) => ROLE_LABELS[r] ?? r;

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '../../.claude/agents');

const LENS = {
  optimist: 'Projenin en güçlü, kanıtlı savunmasını yapar.',
  skeptic: 'Nasıl çökeceğini arar; en zayıf varsayımı hedefler.',
  deterministic: 'Yalnızca dosyaların kanıtladığını söyler; atıfları denetler.',
  'user-advocate': 'Son kullanıcının gözünden bakar: değer, akış, erişilebilirlik.',
  'cost-ops': 'Kurma, çalıştırma ve bakım maliyetini tartar.',
  security: 'Sırlar, yetki, girdi ve tedarik zinciri risklerine bakar.',
};
export const DEFAULT_MEMBERS = ['optimist', 'skeptic', 'security'];
// Claude's model aliases; the judge always runs on one of these.
export { CLAUDE_MODELS as MODELS } from '../adapters/claude.mjs';

export function listRoles() {
  return readdirSync(AGENTS)
    .filter((f) => /^council-.+\.md$/.test(f) && f !== 'council-chair.md')
    .map((f) => {
      const role = f.slice('council-'.length, -3);
      const model = readFileSync(join(AGENTS, f), 'utf8').match(/^model:\s*(\S+)/m)?.[1] ?? 'sonnet';
      return { role, label: roleLabel(role), model, lens: LENS[role] ?? '', default: DEFAULT_MEMBERS.includes(role) };
    })
    .sort((a, b) => Object.keys(LENS).indexOf(a.role) - Object.keys(LENS).indexOf(b.role));
}

// Member roles the person running the hearing defines in the new-case form. Their words become
// the role's lens; the protocol (read-only, citations, secrets, output shapes) still applies.
const CUSTOM_MAX = 4;
const clean = (v, max) => String(v ?? '').replace(/(?![\n\t])\p{Cc}/gu, '').trim().slice(0, max);

/** Valid custom roles from a request body, keyed by role key; anything malformed is dropped. */
export function customRoles(list) {
  const out = {};
  for (const r of Array.isArray(list) ? list.slice(0, 20) : []) {
    if (Object.keys(out).length >= CUSTOM_MAX) break;
    const key = String(r?.key ?? '');
    const label = clean(r?.label, 40).replace(/\s+/g, ' ');
    const brief = clean(r?.brief, 1500);
    if (!/^custom-[a-z0-9-]{1,40}$/.test(key) || !label || brief.length < 10) continue;
    out[key] = { label, brief };
  }
  return out;
}

/** The prompt body for a custom role, in the same voice as the built-in .claude/agents files. */
export function customBrief({ label, brief }) {
  return [
    `You are **${label}** on the council: a member role written by the person running this hearing. Your lens, in their words:`,
    '',
    ...brief.split('\n').map((l) => `> ${l}`),
    '',
    'Work strictly through that lens and bring what the other members will not: if a point belongs to another member\'s lens, leave it to them. Be concrete: name the file and line (or idea line) that a finding rests on, rank by how much it matters, and say what would change your mind. In the conversation, press the claims your lens is best placed to test, concede openly when the evidence is against you, and never repeat a point you already made.',
    '',
    'Follow the council protocol you are given in every prompt: read-only, never open',
    'or quote secrets, every claim cites `path:line` or is labelled `[assumption]`,',
    'and use the exact output shape for the round you are in.',
  ].join('\n');
}
