// Agent Council UI. One consumer path for replay and live events.
// Model output is only ever inserted with textContent / text nodes.

import { $, el, icon, STANCE, VOTE } from './dom.js';

const ICON_REPLY = '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v5"/>';
const ICON_MOD = '<path d="M5 12h14M13 6l6 6-6 6"/>';
const ICON_CHEV = '<path d="M9 6l6 6-6 6"/>';

// ---- token ---------------------------------------------------------------
const hashToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (hashToken) {
  try { sessionStorage.setItem('council-token', hashToken); } catch {}
  history.replaceState(null, '', location.pathname + location.search);
}
let TOKEN = hashToken;
try { TOKEN ??= sessionStorage.getItem('council-token'); } catch {}

const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'X-Council-Token': TOKEN ?? '', 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};


// ---- safe mini-markdown ----------------------------------------------------
function inline(text, cites) {
  const out = [];
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = part.slice(1, -1);
      const c = cites?.get(code) ?? cites?.get(code.replace(/^.*?([\w./@-]+\.[\w]+:\d+(?:-\d+)?)$/, '$1'));
      if (c && c.verified !== null) {
        out.push(el('span', { class: `cite ${c.verified ? 'cite-ok' : 'cite-bad'}`, title: c.verified ? 'Atıf doğrulandı: dosya ve satır var' : 'Atıf doğrulanamadı' },
          el('code', {}, code), el('span', { class: 'cite-mark', 'aria-label': c.verified ? 'doğrulandı' : 'doğrulanamadı' }, c.verified ? '✓' : '✗')));
      } else out.push(el('code', {}, code));
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push(el('strong', {}, part.slice(2, -2)));
    else out.push(part);
  }
  return out;
}

function renderBody(text, citations = []) {
  const cites = new Map(citations.map((c) => [c.ref, c]));
  const root = el('div', { class: 'body' });
  const lines = text.replace(/\r/g, '').split('\n');
  let list = null;
  let para = [];
  const flush = () => { if (para.length) { root.append(el('p', {}, inline(para.join(' '), cites))); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush(); list = null;
      const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      root.append(el('pre', {}, el('code', {}, buf.join('\n'))));
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)/);
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (h) { flush(); list = null; root.append(el('h4', {}, inline(h[1], cites))); }
    else if (li) {
      flush();
      if (!list) { list = el(/^\s*\d/.test(line) ? 'ol' : 'ul'); root.append(list); }
      list.append(el('li', {}, inline(li[1], cites)));
    } else if (!line.trim()) { flush(); list = null; }
    else if (list && /^\s{2,}/.test(line)) list.lastChild.append(' ', ...inline(line.trim(), cites));
    else { list = null; para.push(line.trim()); }
  }
  flush();
  return root;
}

// ---- state -----------------------------------------------------------------
let state;
let es = null;
let tick = null;
let currentCase = null;
const reset = () => {
  state = { members: new Map(), maxTurns: 0, turns: 0, lastTs: 0, tokens: 0, live: false, speaking: null, groups: new Set(), startedAt: Date.now() };
  $('#transcript').replaceChildren();
  $('#seat-list')?.replaceChildren();
  $('#verdict').hidden = true;
  $('#verdict').replaceChildren();
  $('#case-chips').replaceChildren();
  updateStats();
};

const seatVar = (role) => `var(--seat-${state.members.get(role)?.seat ?? 6})`;
const label = (role) => state.members.get(role)?.label ?? role;
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || '—'));

function updateStats() {
  $('#stat-turn').textContent = `${state.turns} / ${state.maxTurns || '—'}`;
  $('#stat-time').textContent = fmtTime(state.live ? Date.now() - state.startedAt : state.lastTs);
  $('#stat-tokens').textContent = state.tokens ? fmtTokens(state.tokens) : '—';
  $('#progress-bar').style.width = state.maxTurns ? `${Math.min(100, (state.turns / state.maxTurns) * 100)}%` : '0';
}

function group(key, text) {
  if (state.groups.has(key)) return;
  state.groups.add(key);
  $('#transcript').append(el('li', { class: 'group-label', 'aria-hidden': 'true' }, text));
}

function who(role) {
  const m = state.members.get(role);
  return el('span', { class: 'who' }, el('span', { class: 'who-dot', 'aria-hidden': 'true' }), label(role),
    m?.model ? el('span', { class: 'model' }, m.model) : null);
}

function voteChip(v) {
  if (!v?.vote) return null;
  const key = String(v.vote).toLowerCase();
  return el('span', { class: `vote vote-${key}` }, `${VOTE[key] ?? key}${v.confidence != null ? ` · ${Number(v.confidence).toFixed(2)}` : ''}`);
}

function stanceBadge(stance) {
  const s = STANCE[stance];
  if (!s) return stance ? el('span', { class: 'stance' }, stance) : null;
  return el('span', { class: `stance stance-${stance}` }, icon(s.icon), s.label);
}

function anchorId(key) {
  if (!key) return null;
  const t = key.match(/^T(\d+)$/);
  if (t) return `turn-${t[1]}`;
  const o = key.match(/^O-(.+)$/);
  return o ? `open-${o[1]}` : null;
}

function jumpTo(key) {
  const id = key === 'verdict' ? 'verdict' : anchorId(key);
  const target = id && document.getElementById(id);
  if (!target) return;
  if (target.tagName === 'DETAILS') target.open = true;
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.classList.add('is-flash');
  setTimeout(() => target.classList.remove('is-flash'), 1600);
}

function replyLink(key) {
  if (!anchorId(key)) return null;
  return el('button', { class: 'reply-link', type: 'button', 'aria-label': `${key} numaralı konuşmaya git`, onclick: () => jumpTo(key) },
    icon(ICON_REPLY), key);
}

function renderSeats() {
  const list = $('#seat-list');
  if (!list) return;
  list.replaceChildren(...[...state.members.values()].sort((a, b) => a.seat - b.seat).map((m) => {
    const speaking = state.speaking === m.role;
    return el('li', { class: `seat${speaking ? ' is-speaking' : ''}`, style: `--c: ${seatVar(m.role)}` },
      el('span', { class: 'seat-mark', 'aria-hidden': 'true' }, m.label.slice(0, 2)),
      el('span', { class: 'seat-name' }, m.label),
      el('span', { class: 'seat-meta' }, `${m.chair ? 'Başkan · ' : ''}${m.vendor} · ${m.model}`),
      el('span', { class: 'seat-vote' }, m.closingVote ? voteChip(m.closingVote) : m.openingVote ? voteChip(m.openingVote) : ''),
      speaking ? el('span', { class: 'seat-speaking' }, 'konuşuyor…') : null);
  }));
}

function announce(text) { $('#announcer').textContent = text; }

// ---- event handlers ----------------------------------------------------------
const handlers = {
  'case.started'(d) {
    state.maxTurns = d.maxTurns;
    $('#case-title').textContent = d.title;
    $('#case-kind').textContent = d.mode === 'code' ? 'Kod tabanı davası' : 'Fikir davası';
    $('#case-chips').append(...[
      el('li', { class: 'chip' }, d.mode === 'code' ? 'Kod modu · salt okuma' : 'Fikir modu · araç yok'),
      el('li', { class: 'chip', title: 'Codex kapalı: -s read-only canary testini geçemedi' }, 'Tek satıcı modu: Claude'),
      d.date ? el('li', { class: 'chip' }, d.date) : null,
      el('li', { class: `chip${state.live ? ' chip-live' : ''}`, id: 'mode-chip' }, el('span', { class: 'chip-dot', 'aria-hidden': 'true' }), state.live ? 'Canlı' : 'Tekrar oynatma'),
    ].filter(Boolean));
    if (state.live) $('#transcript').append(el('li', { class: 'note', id: 'waiting' }, 'Kör açılışlar hazırlanıyor: üyeler hedefi okuyor, birbirini görmüyor…'));
  },
  'member.registered'(d) { state.members.set(d.role, { ...d }); renderSeats(); },
  'opening.completed'(d) {
    document.getElementById('waiting')?.remove();
    group('open', 'Açılış · kör değerlendirmeler');
    const m = state.members.get(d.role);
    if (m) m.openingVote = d.vote;
    const firstLine = d.body.split('\n').find((l) => /\*\*(Summary|Özet)/i.test(l))?.replace(/\*\*[^*]+\*\*\s*/, '') ?? d.body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
    $('#transcript').append(el('li', {},
      el('details', { class: 'card', id: `open-${d.role}`, tabindex: '-1', style: `--c: ${seatVar(d.role)}` },
        el('summary', {}, el('div', { class: 'card-head' }, icon(ICON_CHEV, 'chev'), who(d.role), el('span', { class: 'turn-no' }, `O-${d.role}`), el('span', { class: 'spacer' }), voteChip(d.vote)),
          el('p', { class: 'excerpt' }, firstLine)),
        renderBody(d.body))));
    renderSeats();
  },
  'moderator.pick'(d) {
    group('talk', 'Konuşma');
    $('#transcript').append(el('li', { class: 'mod' }, icon(ICON_MOD),
      el('span', {}, el('strong', {}, `T${d.n} · ${label(d.role)}`), ` → ${d.replyTo}: ${d.why}`),
      el('span', { class: 'src' }, d.source === 'rule' ? 'kural' : 'başkan')));
  },
  'turn.started'(d) {
    state.speaking = d.role;
    renderSeats();
    announce(`T${d.n}: ${label(d.role)} konuşuyor`);
    $('#transcript').append(el('li', { id: `live-${d.n}`, 'aria-hidden': 'true' },
      el('article', { class: 'card streaming', style: `--c: ${seatVar(d.role)}` },
        el('div', { class: 'card-head' }, who(d.role), el('span', { class: 'turn-no' }, `T${d.n}`)),
        el('div', { class: 'body' }))));
  },
  'turn.delta'(d) {
    const body = document.querySelector(`#live-${d.n} .body`);
    if (body) body.textContent = (body.textContent + d.text).replace(/^\s*(REPLY_TO|ADDRESSES|STANCE):.*$\n?/gim, '');
  },
  'turn.completed'(d) {
    document.getElementById(`live-${d.n}`)?.remove();
    state.turns = Math.max(state.turns, d.n);
    state.speaking = null;
    const h = d.header ?? {};
    const reply = h.replyTo?.split('|')[0].trim();
    const addressed = h.addresses && h.addresses !== 'none' ? label(h.addresses) : null;
    $('#transcript').append(el('li', {},
      el('article', { class: 'card', id: `turn-${d.n}`, tabindex: '-1', style: `--c: ${seatVar(d.role)}`, 'aria-label': `T${d.n}, ${label(d.role)}` },
        el('div', { class: 'card-head' },
          who(d.role), el('span', { class: 'turn-no' }, `T${d.n}`), stanceBadge(h.stance),
          reply ? replyLink(reply) : null,
          addressed ? el('span', { class: 'model' }, `→ ${addressed}`) : null,
          el('span', { class: 'spacer' }),
          d.mismatch ? el('span', { class: 'mismatch', title: `Etiket "${STANCE[h.stance]?.label ?? h.stance}" ama metinde soru var: otomatik cevap kuralı tetiklenmez` }, el('b', { 'aria-hidden': 'true' }, '?'), 'etiket ≠ metin') : null),
        renderBody(d.body, d.citations))));
    renderSeats();
    updateStats();
  },
  note(d) { $('#transcript').append(el('li', { class: 'note' }, d.text)); },
  usage(d) { state.tokens += (d.inputTokens ?? 0) + (d.outputTokens ?? 0); updateStats(); },
  'closing.completed'(d) {
    group('close', 'Kapanış · son oylar');
    const m = state.members.get(d.role);
    if (m) m.closingVote = d.vote;
    $('#transcript').append(el('li', {},
      el('details', { class: 'card', style: `--c: ${seatVar(d.role)}` },
        el('summary', {}, el('div', { class: 'card-head' }, icon(ICON_CHEV, 'chev'), who(d.role), el('span', { class: 'turn-no' }, 'kapanış'), el('span', { class: 'spacer' }), voteChip(d.vote)),
          el('p', { class: 'excerpt' }, d.body.split('\n').find((l) => l.trim()) ?? '')),
        renderBody(d.body, d.citations))));
    renderSeats();
  },
  'verdict.completed'(d) { renderVerdict(d); announce('Başkan kararını yazdı'); },
  'case.stopped'(d) { $('#transcript').append(el('li', { class: 'note' }, `Durduruldu: ${d.reason}`)); endLive(); },
  'case.ended'() { endLive(); },
};

function renderVerdict({ markdown, chair }) {
  const v = $('#verdict');
  const c = chair ?? {};
  const key = String(c.verdict ?? '').toLowerCase();
  const members = [...state.members.values()].filter((m) => !m.chair);
  v.replaceChildren(...[
    el('div', { class: 'verdict-top' },
      el('span', { class: `verdict-badge ${key}` }, VOTE[key] ?? (key || 'karar')),
      c.confidence != null ? el('span', { class: 'meter' }, el('span', { class: 'meter-track', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(c.confidence * 100)}%` })), `güven ${Number(c.confidence).toFixed(2)}`) : null),
    el('h2', { id: 'verdict-title' }, c.reason ?? 'Başkanın kararı'),
    el('h3', {}, 'Oy dağılımı'),
    el('table', { class: 'tally' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Üye'), el('th', { scope: 'col' }, 'Model'), el('th', { scope: 'col' }, 'Açılış'), el('th', { scope: 'col' }, 'Kapanış'))),
      el('tbody', {}, members.map((m) => el('tr', { style: `--c: ${seatVar(m.role)}` },
        el('td', {}, el('span', { class: 'who' }, el('span', { class: 'who-dot', 'aria-hidden': 'true' }), m.label)), el('td', {}, m.model), el('td', {}, voteChip(m.openingVote) ?? '—'), el('td', {}, voteChip(m.closingVote) ?? '—'))))),
    c.riskiest_assumption ? [el('h3', {}, 'En riskli varsayım'), renderBody(c.riskiest_assumption)] : null,
    (c.first_steps ?? c.actions)?.length ? [el('h3', {}, c.first_steps ? 'İlk adımlar' : 'Aksiyonlar'),
      el('ol', { class: 'list' }, (c.first_steps ?? c.actions).map((a) => el('li', {}, inline(String(a)))))] : null,
    c.consensus?.length ? [el('h3', {}, 'Uzlaşma'), el('ul', { class: 'list' }, c.consensus.map((x) => el('li', {}, inline(String(x)))))] : null,
    c.disagreements?.length ? [el('h3', {}, 'Çözülmemiş ayrılıklar · azınlık görüşleri korunur'),
      c.disagreements.map((dis) => el('div', { class: 'dis' }, el('h4', {}, dis.topic),
        el('ul', {}, (dis.positions ?? []).map((p) => el('li', { style: `--c: ${seatVar(p.role)}` }, el('strong', {}, `${label(p.role)}: `), inline(String(p.position))))),
        dis.chair_read ? el('p', { class: 'chair-read' }, el('strong', {}, 'Başkanın dosya okuması: '), inline(dis.chair_read)) : null))] : null,
    markdown ? el('details', { class: 'full' }, el('summary', {}, 'Başkanın tam metni'), renderBody(markdown)) : null,
  ].flat(2).filter(Boolean));
  v.hidden = false;
}

function endLive() {
  state.live = false;
  state.speaking = null;
  clearInterval(tick);
  $('#stop').hidden = true;
  const chip = $('#mode-chip');
  if (chip) { chip.classList.remove('chip-live'); chip.lastChild.textContent = currentCase?.source === 'live' ? 'Bitti' : 'Tekrar oynatma'; }
  renderSeats();
  updateStats();
}

// ---- connection ------------------------------------------------------------
function connect(c, speed) {
  es?.close();
  clearInterval(tick);
  reset();
  currentCase = c;
  state.live = !!c.live;
  $('#stop').hidden = !state.live;
  $('#speed-wrap').hidden = state.live;
  $('#replay').hidden = state.live;
  if (state.live) tick = setInterval(updateStats, 1000);
  es = new EventSource(`/api/cases/${encodeURIComponent(c.id)}/stream?token=${encodeURIComponent(TOKEN ?? '')}&speed=${state.live ? 0 : speed}`);
  let lastSeq = 0;
  // ?upto=N pauses a replay right after turn N, e.g. to point someone at a moment.
  const upto = state.live ? 0 : Number(new URLSearchParams(location.search).get('upto')) || 0;
  const held = [];
  let paused = false;
  const apply = (ev) => {
    if (state.live && ev.type === 'case.started') state.startedAt = Date.now() - ev.ts;
    state.lastTs = ev.ts;
    handlers[ev.type]?.(ev.data);
    if (!state.live) updateStats();
    if (upto && ev.type === 'turn.completed' && ev.data.n === upto) {
      paused = true;
      $('#resume').hidden = false;
    }
  };
  $('#resume').onclick = () => {
    paused = false;
    $('#resume').hidden = true;
    while (held.length && !paused) apply(held.shift());
  };
  es.addEventListener('council', (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.seq <= lastSeq) return; // EventSource reconnects replay from the start
    lastSeq = ev.seq;
    if (paused) { held.push(ev); return; }
    apply(ev);
  });
  es.addEventListener('replay-end', () => { es.close(); endLive(); });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) endLive(); };
}

async function loadCases(selectId) {
  if (!TOKEN) {
    $('#case-title').textContent = 'Erişim anahtarı yok';
    $('#transcript').replaceChildren(el('li', { class: 'empty' }, 'Sunucunun terminalde yazdığı bağlantıyı açın (…/#token=…).'));
    return;
  }
  let cases;
  try { cases = await api('/api/cases'); } catch (e) {
    $('#transcript').replaceChildren(el('li', { class: 'empty' }, `Davalar yüklenemedi: ${e.message}`));
    return;
  }
  const sel = $('#case-select');
  sel.replaceChildren(...cases.map((c) => el('option', { value: c.id }, `${c.live ? '● ' : ''}${c.title}`)));
  sel.cases = cases;
  const pick = cases.find((c) => c.id === selectId) ?? cases.find((c) => c.live) ?? cases[0];
  if (!pick) return;
  sel.value = pick.id;
  connect(pick, Number($('#speed').value));
}

$('#case-select').addEventListener('change', (e) => {
  const c = e.target.cases.find((x) => x.id === e.target.value);
  if (c) connect(c, Number($('#speed').value));
});
$('#replay').addEventListener('click', () => currentCase && connect(currentCase, Number($('#speed').value)));
$('#speed').addEventListener('change', () => currentCase && !state.live && connect(currentCase, Number($('#speed').value)));
$('#stop').addEventListener('click', stopCase);
async function stopCase() {
  if (!currentCase || !state.live) return;
  $('#stop').disabled = true;
  try { await api(`/api/cases/${encodeURIComponent(currentCase.id)}/stop`, { method: 'POST' }); }
  catch (e) { announce(`Durdurulamadı: ${e.message}`); }
  finally { $('#stop').disabled = false; }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state?.live && !$('#new-case-dialog').open) { e.preventDefault(); stopCase(); }
});

// ---- new case dialog -------------------------------------------------------
const dialog = $('#new-case-dialog');
$('#new-case').addEventListener('click', () => { $('#new-case-error').textContent = ''; dialog.showModal(); });
$('#new-case-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'start') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#start-case');
  btn.disabled = true;
  try {
    const { id } = await api('/api/cases', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
    dialog.close();
    await loadCases(id);
  } catch (err) {
    $('#new-case-error').textContent = err.message;
    e.target.elements.target.focus();
  } finally { btn.disabled = false; }
});

reset();
loadCases(new URLSearchParams(location.search).get('case'));
