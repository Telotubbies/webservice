// Command lifecycle stepper. The final step says what actually happened —
// "Sent to edge" is never presented as "Done" (doc 16 §3).

import { useTranslation } from 'react-i18next';
import type { Command } from '../../types';
import { isTerminal } from './useCommand';

const STEPS = ['issued', 'sent'] as const;
const GOOD = new Set(['done', 'acknowledged']);

export function Lifecycle({ cmd }: { cmd: Command }) {
  const { t } = useTranslation();
  const s = cmd.status;
  const terminal = isTerminal(s);
  const reached = terminal ? STEPS.length : Math.max(0, STEPS.indexOf(s as (typeof STEPS)[number]) + 1);
  const tone = !terminal ? 'pending' : GOOD.has(s) ? 'ok' : 'bad';
  return (
    <div className={`lifecycle lc-${tone}`} aria-live="polite">
      <ol>
        {STEPS.map((step, i) => (
          <li key={step} className={i < reached ? 'lc-done' : ''}>
            <span className="lc-dot" aria-hidden />{t(`lifecycle.${step}`)}
          </li>
        ))}
        <li className={terminal ? 'lc-done lc-final' : 'lc-final'}>
          <span className="lc-dot" aria-hidden />
          {terminal ? t(`lifecycle.${s}`) : '…'}
        </li>
      </ol>
      {cmd.detail && <span className="lc-detail mono">{cmd.detail}</span>}
    </div>
  );
}
