// Static files: the 3D UI (web/out, exported Next.js) at /, the classic UI at /classic/.
// Paths never leave those folders; exported HTML gets a CSP that allows exactly its own
// inline bootstrap scripts by hash instead of 'unsafe-inline'.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { SECURITY_HEADERS, send } from './http.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

export function createStatic({ web, classic }) {
  const cspCache = new Map(); // content-keyed, so it survives rebuilds

  const cspFor = (html) => {
    const key = createHash('sha256').update(html).digest('base64');
    if (!cspCache.has(key)) {
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .filter((m) => m[1].length)
        .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
      cspCache.set(key, SECURITY_HEADERS['Content-Security-Policy'].replace("default-src 'self';", `default-src 'self'; script-src 'self' ${hashes.join(' ')};`));
    }
    return cspCache.get(key);
  };

  const resolveFile = (path) => {
    if (path === '/classic' || path === '/classic/') return join(classic, 'index.html');
    const candidates = existsSync(web) ? [join(web, path === '/' ? 'index.html' : path), join(web, `${path}.html`)] : [];
    candidates.push(join(classic, path === '/' ? 'index.html' : path));
    for (const c of candidates) {
      const file = normalize(c);
      const root = file.startsWith(web + sep) ? web : classic;
      if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) return file;
    }
    return null;
  };

  return {
    hasWeb: () => existsSync(web),
    serve(res, path) {
      const file = resolveFile(path);
      if (!file) return send(res, 404, { error: 'not found' });
      const body = readFileSync(file);
      const headers = { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': file.includes(`${sep}_next${sep}static${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' };
      if (file.startsWith(web + sep) && extname(file) === '.html') headers['Content-Security-Policy'] = cspFor(body.toString('utf8'));
      res.writeHead(200, headers);
      res.end(body);
    },
  };
}
