// Cases the server is running right now, and ideas typed into the form (each written to its
// case's own idea.md, owner-only, next to the database).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { HttpError } from './http.mjs';

export const newCaseId = () => `live-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;

/** Live cases, at most `max` at a time (each runs several paid CLIs in parallel). */
export function createLiveCases({ store, startCase, max = 3 }) {
  const live = new Map(); // caseId -> handle { id, done, addNote, stop }
  return {
    has: (id) => live.has(id),
    get: (id) => live.get(id) ?? null,
    start(options) {
      if (live.size >= max) throw new HttpError(409, `At most ${max} hearings can run at once`, 'too_many_live');
      const handle = startCase(store, options);
      live.set(handle.id, handle);
      handle.done.finally(() => live.delete(handle.id));
      return handle;
    },
    stopAll(reason = 'server') { for (const h of live.values()) h.stop(reason); },
  };
}

export function createIdeas(dir) {
  return {
    /** Write an idea typed in the form as the case's idea.md; returns its path. */
    write(caseId, text) {
      const folder = join(dir, caseId);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      chmodSync(folder, 0o700);
      const file = join(folder, 'idea.md');
      writeFileSync(file, `${text}\n`, { mode: 0o600 });
      return file;
    },
    /** An idea.md this server wrote (under the fenced ~/.agent-council, so checkTarget would refuse it). */
    owns: (p) => typeof p === 'string' && p.startsWith(dir + sep) && p.endsWith(`${sep}idea.md`),
    exists: (p) => existsSync(p),
  };
}
