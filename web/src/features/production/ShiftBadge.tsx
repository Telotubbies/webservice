// ShiftBadge — compact current-shift indicator for the top bar (roadmap
// 5.1: "top-bar indicator"). Polls /shifts/current every 60s. Renders the
// shift name + window while inside a shift, "Off shift" otherwise.
//
// WIRING (controller-owned — do NOT ship in this feature dir):
//   web/src/app/Shell.tsx, next to the site selector in the top bar:
//     import { ShiftBadge } from '../../features/production/ShiftBadge';
//     <ShiftBadge orgId={org} siteId={site?.id ?? null} />

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { prodApi } from './api';
import './i18n';

export function ShiftBadge({ orgId, siteId }: { orgId: string | null; siteId: string | null }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['prod-current-shift', orgId, siteId],
    queryFn: () => prodApi.currentShift(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    refetchInterval: 60_000,
  });
  const cur = q.data?.shift ?? null;
  if (!orgId || !siteId || q.isError) return null;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-[4px] border border-line bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-68 sm:inline-flex"
      title={cur ? `${cur.start_time}–${cur.end_time} (${q.data?.timezone ?? ''})` : t('prod.noShift')}
      aria-label={cur ? t('prod.shiftNow', { name: cur.name }) : t('prod.noShift')}
    >
      <span className={`size-1.5 rounded-full ${cur ? 'bg-[var(--color-ok)]' : 'bg-line-hard'}`} aria-hidden="true" />
      {cur ? (
        <>
          <span>{cur.name}</span>
          <span className="font-mono tabular-nums text-ink-46">{cur.start_time}–{cur.end_time}</span>
        </>
      ) : t('prod.noShift')}
    </span>
  );
}
