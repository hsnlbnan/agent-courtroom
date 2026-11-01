'use client';
// Connect a provider whose adapter is written but not yet proven on this machine. The person sets
// up the CLI (install, key or sign-in, shown with the exact command), then the server runs the
// same prompt-injection canary that cleared Claude and Codex; only modes that pass open up.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCopy } from '@/lib/hooks/useCopy';
import { useT } from '@/lib/i18n';
import type { ConnectJob, Provider } from '@/lib/types';
import Modal from './Modal';

export interface ConnectCalls {
  status: (id: string) => Promise<ConnectJob>;
  start: (id: string) => Promise<ConnectJob>;
  forget: (id: string) => Promise<void>;
}

const POLL_MS = 4000;

function Command({ text }: { text: string }) {
  const { t } = useT();
  const { copied, copy } = useCopy();
  return (
    <div className="cmd">
      <code>{text}</code>
      <button type="button" className="ctl small" onClick={() => copy(text)}>{copied === text ? t.copied : t.copy}</button>
    </div>
  );
}

function Results({ job }: { job: ConnectJob }) {
  const { t } = useT();
  return (
    <ul className="results" role="status">
      {(['idea', 'code'] as const).map((m) => {
        const r = job.results?.[m];
        if (!r) return <li key={m} className="skip">{t.modeName[m]}: {t.connectSkipped}</li>;
        return (
          <li key={m} className={r.ok ? 'pass' : 'fail'}>
            {t.modeName[m]}: {r.ok ? t.connectPass : t.connectFail[r.code ?? ''] ?? r.code}
            {r.detail && <code className="detail">{r.detail}</code>}
          </li>
        );
      })}
    </ul>
  );
}

/** `onClose(changed)`: `changed` is true when a connection was made or removed. */
export default function ConnectDialog({ provider, calls, onClose }: { provider: Provider | null; calls: ConnectCalls; onClose: (changed: boolean) => void }) {
  const { t } = useT();
  const [job, setJob] = useState<ConnectJob>({ state: 'idle' });
  const [error, setError] = useState('');
  const changed = useRef(false); // read at close time, so a just-made change is never lost
  const id = provider?.id ?? '';

  // Each opening starts clean and asks the server whether a test already ran or is running.
  useEffect(() => {
    if (!id) return;
    changed.current = false;
    setError('');
    setJob({ state: 'idle' });
    calls.status(id).then(setJob).catch(() => {});
  }, [id, calls]);

  // While a test runs, ask every few seconds how it is going.
  useEffect(() => {
    if (!id || job.state !== 'running') return;
    const timer = setInterval(() => {
      calls.status(id).then((j) => { setJob(j); if (j.state === 'done') changed.current = true; }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, job.state, calls]);

  const close = useCallback(() => onClose(changed.current), [onClose]);
  const s = provider?.setup;
  const missing = (s?.env ?? []).filter((k) => !s?.envSet?.[k]);
  const connected = provider?.status === 'enabled' && !!provider.connected;
  const running = job.state === 'running';

  return (
    <Modal open={!!provider} onClose={close} className="connect-dialog" titleId="cd-title" title={provider ? t.providerTitle(provider.name) : ''}
      footer={provider && (
        <>
          {connected && !running && (
            <button type="button" className="ctl" onClick={async () => { await calls.forget(id); changed.current = true; close(); }}>{t.connectForget}</button>
          )}
          <button type="button" className="ctl" onClick={close}>{t.close}</button>
          <button type="button" className="ctl primary" disabled={!provider.installed || running}
            onClick={async () => { setError(''); try { setJob(await calls.start(id)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>
            {running ? t.connectTesting : connected ? t.connectRetest : t.connectStart}
          </button>
        </>
      )}>
      {provider && (
        <div className="body">
          {connected && <p className="ok">{t.connectedModes((provider.modes ?? []).map((m) => t.modeName[m] ?? m).join(', '))}</p>}
          <ol className="steps">
            <li className={provider.installed ? 'done' : ''}>
              <p className="step-title">{provider.installed ? t.connectInstalled(provider.version ?? '') : t.connectInstall}</p>
              {!provider.installed && <p className="note">{t.connectInstallHint}</p>}
            </li>
            <li className={missing.length === 0 && (s?.env.length ?? 0) > 0 ? 'done' : ''}>
              <p className="step-title">{t.connectSignIn}</p>
              {(s?.env ?? []).map((k) => <p key={k} className="note"><code>{k}</code> {s?.envSet?.[k] ? t.connectEnvSet : t.connectEnvMissing}</p>)}
              {missing.length > 0 && <p className="note">{t.connectEnvHint}</p>}
              {(s?.optional ?? []).length > 0 && <p className="note">{t.connectOptional(s?.optional.join(', ') ?? '')}</p>}
              {s?.login && <><p className="note">{(s.env ?? []).length ? t.connectLogin : t.connectLoginOnly}</p><Command text={s.login} /></>}
            </li>
            <li className={job.state === 'done' && (job.modes?.length ?? 0) > 0 ? 'done' : ''}>
              <p className="step-title">{t.connectTest}</p>
              <p className="note">{t.connectTestHint}</p>
              {running && <p className="state" role="status"><span className="dots" aria-hidden="true"><i /><i /><i /></span> {t.connectRunning(t.modeName[job.step ?? ''] ?? job.step ?? '')}</p>}
              {job.state === 'done' && <Results job={job} />}
            </li>
          </ol>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
