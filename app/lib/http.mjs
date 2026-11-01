// Small HTTP helpers shared by the API, static files and the event stream.
import { timingSafeEqual } from 'node:crypto';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const BODY_MAX = 64_000;

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/** An error the API answers with as is: HTTP status, message and a code the UI translates. */
export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/** The request body as JSON (empty body = {}). Too large → 413, not JSON → 400. */
export function readJson(req) {
  return new Promise((ok, fail) => {
    let s = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    // Past the limit the rest is read and dropped, so the client still gets the 413 answer.
    req.on('data', (d) => { if (tooLarge) return; s += d; if (s.length > BODY_MAX) { tooLarge = true; s = ''; } });
    req.on('error', () => fail(new HttpError(400, 'bad request')));
    req.on('end', () => {
      if (tooLarge) return fail(new HttpError(413, 'Request body too large', 'too_large'));
      try { ok(JSON.parse(s || '{}')); } catch { fail(new HttpError(400, 'bad json')); }
    });
  });
}

/** A constant-time comparison against the run's token. */
export function tokenChecker(token) {
  const expected = Buffer.from(token);
  return (t) => {
    if (typeof t !== 'string') return false;
    const given = Buffer.from(t);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
}
