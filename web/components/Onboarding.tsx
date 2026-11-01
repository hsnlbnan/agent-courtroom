'use client';
// Opened without a token: how to start the app with one.
import { useCopy } from '@/lib/hooks/useCopy';
import { useT } from '@/lib/i18n';

const COMMAND = 'npx agent-courtroom';

export default function Onboarding() {
  const { t } = useT();
  const { copied, copy } = useCopy();
  return (
    <aside className="composer onboarding" aria-labelledby="ob-title">
      <h2 id="ob-title">{t.connectTitle}</h2>
      <p>{t.connectBody}</p>
      <pre><code>{COMMAND}</code></pre>
      <button type="button" className="ctl" onClick={() => copy(COMMAND)}>{copied ? t.copied : t.copy}</button>
      <p className="hint">{t.connectHint}</p>
    </aside>
  );
}
