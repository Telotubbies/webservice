// Line status header — the one answer to "is the line running?". Computed
// from feed state and sample age, never asserted: a dead feed or an old
// sample reads as "data not current", not as the last known value.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { T } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useAlarms } from '../../features/alarms/alarms';
import { Icon } from './Icon';

type Verdict = 'running' | 'stopped' | 'stale' | 'nodata';

const TONE: Record<Verdict, string> = {
  running: 'bg-[var(--color-ok-soft)] text-[var(--color-ok-ink)]',
  stopped: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  stale: 'bg-[var(--color-caution-soft)] text-[var(--color-caution-ink)]',
  nodata: 'bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]',
};
const GLYPH: Record<Verdict, string> = { running: '●', stopped: '■', stale: '◆', nodata: '○' };

export function LineStatusBar() {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const ws = useStore(() => live.ws);
  const { active, critical } = useAlarms();
  const tv = live.latest.get(T.running);

  const fresh = !!tv && now - Date.parse(tv.ts) <= STALE_MS && tv.q !== 'stale' && tv.q !== 'bad';
  const verdict: Verdict = !tv ? 'nodata' : ws !== 'open' || !fresh ? 'stale' : tv.v ? 'running' : 'stopped';
  const feedDown = ws !== 'open';

  return (
    <div role="status" aria-live="polite" className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[5px] px-4 py-3 ${TONE[verdict]}`}>
      <span className="flex items-center gap-2 text-[22px] font-bold leading-none md:text-[26px]">
        <span aria-hidden className="text-[16px]">{GLYPH[verdict]}</span>
        {t(`linestatus.${verdict}`)}
      </span>
      <span className="text-[13px]">
        {feedDown ? t('linestatus.feedDown')
          : tv ? t('state.updated', { age: fmtAge(tv.ts, now) }) : t('state.never')}
      </span>
      <span className="flex-1" />
      {feedDown || !tv ? (
        <span className="text-[13px] font-semibold">{t('linestatus.alarmsUnknown')}</span>
      ) : (
        <Link to="/alarms" className="flex min-h-11 items-center gap-1 rounded px-1 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-blue">
          {critical.length > 0 && <Icon name="warn" size={14} />}
          {critical.length > 0
            ? t('shell.criticalActive', { count: critical.length, what: critical[0].rule || critical[0].tag })
            : t('linestatus.alarmsCount', { count: active.length })}
        </Link>
      )}
    </div>
  );
}
