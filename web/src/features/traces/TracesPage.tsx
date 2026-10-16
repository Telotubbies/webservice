// Command traces — each operator command and its state transitions
// (issued → sent → done / denied / timeout). command:read ⇒ operator+ only,
// so a viewer never triggers the fetch.

import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { canOperate, useRole } from '../../app/session';
import { usePrimaryScope } from '../admin/admin';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import '../misc/i18n';

export function TracesPage() {
  const { t } = useTranslation();
  const operable = canOperate(useRole());
  const { orgId, siteId } = usePrimaryScope();
  const [open, setOpen] = useState<string | null>(null);
  const on = operable && !!orgId && !!siteId;
  const list = useQuery({ queryKey: ['traces', orgId, siteId], queryFn: () => adminApi.siteCommands(orgId!, siteId!, 50), enabled: on, refetchInterval: 15_000 });
  const detail = useQuery({ queryKey: ['trace', orgId, siteId, open], queryFn: () => adminApi.siteCommand(orgId!, siteId!, open!), enabled: on && !!open });
  const rows = list.data?.items ?? [];
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="service-map" title={t('px.traces.title')} />
      <div className="p-4">
        {!operable ? <Notice>{t('px.needOperator')}</Notice> : list.isLoading ? <SkeletonRows /> : list.isError ? <ErrorState onRetry={list.refetch} /> : rows.length === 0 ? <EmptyState title={t('px.empty')} icon="search" /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {['colId', 'colStatus', 'colIssued', 'colActor'].map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.traces.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="h-9 cursor-pointer border-b border-line hover:bg-info-soft" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td className="px-3 font-mono text-[12px]"><button type="button" aria-expanded={open === c.id} className="text-blue hover:underline">…{c.id.slice(-8)}</button></td>
                      <td className="px-3">{c.status}</td>
                      <td className="whitespace-nowrap px-3 font-mono text-[12px]">{new Date(c.issued_at).toLocaleString()}</td>
                      <td className="px-3 text-ink-68">{c.actor?.display_name ?? '—'}</td>
                    </tr>
                    {open === c.id && (
                      <tr className="border-b border-line bg-subtle">
                        <td colSpan={4} className="px-6 py-2">
                          {detail.isLoading ? <SkeletonRows rows={2} /> : (
                            <ol className="text-[12px]">
                              {(detail.data?.command.events ?? []).map((e, i) => (
                                <li key={i} className="py-0.5">
                                  <span className="font-mono text-ink-46">{new Date(e.at).toLocaleTimeString()}</span>{' '}
                                  {e.from ?? '∅'} → <b>{e.to}</b> <span className="text-ink-68">{e.reason ?? ''}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
