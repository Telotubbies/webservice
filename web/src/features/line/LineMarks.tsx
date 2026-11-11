// Status marks for the line console (D2): Lucide glyph + word, never the
// ▲ ◆ ○ characters, and colour only where the state is abnormal (ISA-101:
// running stays neutral).

import { useTranslation } from 'react-i18next';
import { DdIcon } from '../../shared/ui/DdIcon';
import type { DdIconName } from '../../shared/ui/ddicons';
import type { Quality } from '../../types';
import type { RunState } from '../../shared/ui/Status';

const ICON: Record<RunState, DdIconName> = {
  running: 'play', stopped: 'stop', stale: 'clock', unknown: 'attention-circled',
};

export function RunMark({ state }: { state: RunState }) {
  const { t } = useTranslation();
  const abnormal = state === 'stale' || state === 'unknown';
  return (
    <span data-state-mark={state} className="inline-flex items-center gap-1.5 text-[13px]">
      <DdIcon name={ICON[state]} size={12} className={abnormal ? 'text-[var(--color-caution)]' : 'text-ink-46'} />
      <span className={abnormal ? 'font-semibold text-[var(--color-caution-ink)]' : 'text-ink-68'}>{t(`state.${state}`)}</span>
    </span>
  );
}

/** Signal quality as icon + word: good stays quiet, the rest is spoken. */
export function QualityState({ q, stale }: { q?: Quality; stale?: boolean }) {
  const { t } = useTranslation();
  if (stale || q === 'stale') {
    return (
      <span data-q="stale" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-caution-ink)]">
        <DdIcon name="clock" size={12} />
        {t('state.staleQ')}
      </span>
    );
  }
  if (!q || q === 'good') return <span className="text-[13px] text-ink-68">{t('state.good')}</span>;
  const bad = q === 'bad';
  return (
    <span data-q={q} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-caution-ink)]">
      <DdIcon name={bad ? 'attention-circled' : 'help'} size={12} />
      {t(`state.${bad ? 'bad' : 'uncertain'}`)}
    </span>
  );
}
