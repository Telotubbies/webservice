// Alarm state chip for the alarm screens. The shared AlarmStateBadge knows
// three states; ISA-18.2 has a fourth that must not look like any of them:
// returned to normal but never acknowledged (RTN-unack). It gets a dashed
// amber outline and a return arrow, so it is told apart by shape and text,
// not by colour alone.

import { useTranslation } from 'react-i18next';
import { AlarmStateBadge } from '../../shared/ui/Status';
import './i18n';

export function AlarmStateChip({ state, ackedBy }: { state: string; ackedBy?: string | null }) {
  const { t } = useTranslation();
  if (state !== 'rtn_unack') return <AlarmStateBadge state={state} ackedBy={ackedBy} />;
  return (  // dashed variant for the alarm screens; the shared badge has a plain one
    <span
      className="alarm-state is-rtn inline-flex items-center gap-1 border border-dashed border-[var(--color-caution)] bg-[var(--color-caution-soft)] font-semibold text-ink"
      data-state="rtn_unack"
    >
      <span aria-hidden className="text-[11px]">↩</span>{t('alx.stateRtn')}
    </span>
  );
}
