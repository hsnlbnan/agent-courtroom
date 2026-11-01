// Child processes the council starts: member CLIs, follow-up analyses, connection tests.
// Each runs in its own process group, so stopping it also stops whatever it spawned.

/** Signal a child and everything it spawned (it leads its own process group). */
export function killTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

/** SIGTERM, then SIGKILL after `graceMs` if it is still running. Resolves once it has exited. */
export function terminate(child, graceMs = 2000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const hard = setTimeout(() => killTree(child, 'SIGKILL'), graceMs);
    // A child that never reports back must not hold up shutdown.
    const giveUp = setTimeout(done, graceMs + 1000);
    child.once('close', () => { clearTimeout(hard); clearTimeout(giveUp); done(); });
    killTree(child, 'SIGTERM');
  });
}

/** Run `onTimeout` and terminate the child if it is still running after `ms`. Returns a cancel function. */
export function deadline(child, ms, onTimeout = () => {}) {
  const timer = setTimeout(() => { onTimeout(); void terminate(child, 3000); }, ms);
  return () => clearTimeout(timer);
}

/** Every child still running, so the server can stop them all before it exits. */
export function createChildRegistry() {
  const children = new Set();
  return {
    add(child) {
      children.add(child);
      child.once('close', () => children.delete(child));
      return child;
    },
    stopAll(graceMs = 2000) { return Promise.all([...children].map((c) => terminate(c, graceMs))); },
    get size() { return children.size; },
  };
}

/** The process-wide registry: every place that spawns a CLI registers it here. */
export const children = createChildRegistry();
