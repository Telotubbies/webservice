// Lifecycle pill — command status (issued → sent → acked → done/denied/
// failed/timeout) as a tinted badge. Shared by the line controls and the
// command log so both surfaces render identical lifecycle states.

import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon';
import { isTerminal } from './useCommand';

const TONE: Record<string, string> = {
  issued: 'bg-subtle text-ink-68',
  sent: 'bg-[#e8f1fb] text-[#005aa5]',
  acked: 'bg-[#e8f1fb] text-[#005aa5]',
  done: 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]',
  acknowledged: 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]',
  denied: 'bg-[#fff4e0] text-[var(--color-caution)]',
  rejected: 'bg-[#fff4e0] text-[var(--color-caution)]',
  failed: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  timeout: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
};

export function LifecyclePill({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${TONE[status] ?? TONE.issued}`}>
      {!isTerminal(status) && <Icon name="clock" size={10} />}
      {t(`lifecycle.${status}`, { defaultValue: status })}
    </span>
  );
}
