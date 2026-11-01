// Where the app keeps things in the home folder. One place, so tests and tools agree.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_HOME = join(homedir(), '.agent-council');
/** Empty per-case folders non-Claude members run in for idea cases. */
export const SANDBOX_ROOT = join(APP_HOME, 'sandbox');
export const sandboxFor = (caseId) => join(SANDBOX_ROOT, caseId);
