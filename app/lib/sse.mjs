// The event stream of one case: stored events replayed (re-timed by `speed`, 0 = instant),
// then live ones as they are recorded. Each event is sent once, in order.
import { SECURITY_HEADERS } from './http.mjs';

const MAX_GAP_MS = 1500; // a long pause in the original is shortened on replay

export function streamCase({ req, res, store, caseId, live, speed, cors }) {
  res.writeHead(200, { ...SECURITY_HEADERS, ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const write = (ev) => res.write(`id: ${ev.seq}\nevent: council\ndata: ${JSON.stringify(ev)}\n\n`);
  let closed = false;
  let lastSeq = 0;
  const once = (ev) => { if (ev.seq > lastSeq) { lastSeq = ev.seq; write(ev); } };
  req.on('close', () => { closed = true; store.bus.off(caseId, once); });
  if (live) store.bus.on(caseId, once);
  const pace = live ? 0 : Math.max(0, Number.isFinite(speed) ? speed : 0);
  (async () => {
    let prevTs = null;
    for (const ev of store.events(caseId)) {
      if (closed) return;
      if (pace > 0 && prevTs !== null) {
        const wait = Math.min((ev.ts - prevTs) / pace, MAX_GAP_MS);
        if (wait > 4) await new Promise((r) => setTimeout(r, wait));
      }
      prevTs = ev.ts;
      once(ev);
    }
    if (!live && !closed) res.write('event: replay-end\ndata: {}\n\n');
  })().catch(() => { if (!closed) res.end(); });
}
