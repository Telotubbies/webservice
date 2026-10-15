// Commands — command lifecycle history from the live store (WS-driven).
// issued → sent → acked → done/failed/timeout rendered as status pills.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { live } from '../../lib/live';
import { api } from '../../lib/api';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { LifecyclePill } from '../line/LifecyclePill';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import type { Command } from '../../types';

export function CommandsPage() {
  const { t } = useTranslation();
  const now = useNow();
  const operable = canOperate(useRole());
  useStore(() => live.cmdRev);

  // Page-level seed (App.tsx also seeds on auth, but its failure is silent) —
  // merges only ids the WS hasn't already delivered fresher state for.
  const seed = useQuery({
    queryKey: ['commands-seed'],
    queryFn: () => api.listCommands(20).then((cmds) => {
      cmds.forEach((c) => { if (!live.commands.has(c.id)) live.mergeCommand(c); });
      return cmds.length;
    }),
    enabled: operable,
  });

  const rows = [...live.commands.values()]
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at ?? '') - Date.parse(a.updated_at ?? a.created_at ?? ''));

  return (
    <>
      <PageBar title={t('nav.commands')} lede={t('commands.lede')} />
      <div className="p-4">
        <Card pad={false}>
          {!operable ? (
            <Notice tone="info">{t('commands.restricted')}</Notice>
          ) : rows.length > 0 ? (
            <Table head={[t('commands.colId'), t('commands.colSignal'), t('commands.colValue'), t('commands.colStatus'), t('commands.colUser'), t('commands.colTime'), t('commands.colDetail')]}>
              {rows.map((c: Command) => (
                <tr key={c.id}>
                  <td className="font-mono text-[11px] text-ink-46">{c.id.slice(0, 8)}</td>
                  <td className="font-mono text-[12px]">{c.tag}</td>
                  <td className="font-mono text-[12px]">{String(c.value ?? '—')}</td>
                  <td><LifecyclePill status={c.status} /></td>
                  <td className="text-[12px] text-ink-68">{c.user ?? '—'}</td>
                  <td className="text-[12px] text-ink-68">{fmtAge(c.updated_at ?? c.created_at, now)}</td>
                  <td className="max-w-48 truncate text-[12px] text-ink-68">{c.detail ?? ''}</td>
                </tr>
              ))}
            </Table>
          ) : seed.isError ? (
            <ErrorState onRetry={() => void seed.refetch()} />
          ) : seed.isPending ? (
            <div className="flex flex-col gap-2 p-3" role="status" aria-label={t('common.loading')}>
              <Skeleton h={28} /><Skeleton h={28} /><Skeleton h={28} />
            </div>
          ) : (
            <EmptyState title={t('commands.empty')} body={t('commands.emptyBody')} icon="commands" />
          )}
        </Card>
      </div>
    </>
  );
}
