// Shelved alarms: who silenced what, why, and when the shelf runs out
// (ISA-18.2 asks for exactly this list). Expired shelves drop off by
// themselves; Unshelve puts the alarm back in front of the operator.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifyApi } from '../notify/api';
import { shelfApi } from './shelfApi';
import { SeverityBadge } from '../../shared/ui/Status';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Table } from '../../shared/ui/Page';
import '../notify/i18n';
import './i18n';

/** "in 59 min", "in 2 h 5 min" — a shelf is short, so minutes are the unit that matters. */
export function timeLeft(until: string, now: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = Math.round((Date.parse(until) - now) / 1000);
  if (s <= 0) return t('shelve.expired');
  const m = Math.ceil(s / 60);
  if (m < 60) return t('shelve.inMin', { m });
  const h = Math.floor(m / 60);
  if (h < 48) return t('shelve.inHour', { h, m: m % 60 });
  return t('shelve.inDays', { d: Math.round(h / 24) });
}

export function ShelvedList({ orgId, operable, now }: { orgId: string | null; operable: boolean; now: number }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['alarm-shelf', orgId],
    queryFn: () => shelfApi.list(orgId!),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
  const unshelve = useMutation({
    mutationFn: (id: string) => notifyApi.unshelve(orgId!, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alarm-shelf', orgId] });
      void qc.invalidateQueries({ queryKey: ['site-alarms'] });
    },
  });

  if (q.isPending) return <div className="space-y-2 p-3">{[28, 20, 28].map((h, i) => <Skeleton key={i} h={h} />)}</div>;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  // a shelf that ran out between refreshes is gone, not "0 minutes left"
  const rows = q.data.items.filter((r) => Date.parse(r.shelved_until) > now);
  if (rows.length === 0) return <EmptyState title={t('shelve.listEmpty')} body={t('shelve.listEmptyBody')} />;
  const clock = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <Table head={[t('alarms.colSeverity'), t('alarms.colAlarm'), t('shelve.colBy'), t('shelve.colWhy'), t('shelve.colLeft'), operable ? t('alarms.colAction') : null].filter((h) => h !== null)}>
      {rows.map((r) => (
        <tr key={r.id} data-shelved-id={r.id}>
          <td><SeverityBadge severity={r.severity} /></td>
          <td className="py-1.5">
            <Link to={`/alarms/${r.id}`} className="block font-semibold text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">{r.rule}</Link>
            <span className="font-mono text-[11px] text-ink-46">{r.tag}</span>
          </td>
          <td className="text-[12px]">
            <span className="block">{r.shelved_by ?? t('shelve.unknownWho')}</span>
            {r.shelved_at && <span className="block text-ink-46">{clock(r.shelved_at)}</span>}
          </td>
          <td className="max-w-64 text-[12px]">{r.reason || <span className="text-ink-46">{t('shelve.noReason')}</span>}</td>
          <td className="whitespace-nowrap text-[12px]">
            <span className="block font-semibold tabular-nums">{timeLeft(r.shelved_until, now, t)}</span>
            <span className="block text-ink-46">{t('shelve.until', { at: clock(r.shelved_until) })}</span>
          </td>
          {operable && (
            <td>
              <button type="button" className="btn btn-sm min-h-11 md:min-h-8" disabled={unshelve.isPending}
                aria-label={`${t('shelve.unshelve')}: ${r.rule}`} onClick={() => unshelve.mutate(r.id)}>
                {t('shelve.unshelve')}
              </button>
            </td>
          )}
        </tr>
      ))}
    </Table>
  );
}
