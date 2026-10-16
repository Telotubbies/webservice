// Metrics Settings (WP-B) — read-only tag configuration from the v2 site
// tags endpoint. No writes anywhere on this page; datasource/profile links
// point at the existing Infrastructure routes where configuration lives.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { usePrimaryScope } from '../admin/admin';
import { HelpLink } from '../onboarding/HelpLink';
import '../onboarding/i18n';
import '../misc/i18n';
import './i18n';

export function MetricsSettingsPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const [q, setQ] = useState('');

  const tags = useQuery({
    queryKey: ['site-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    staleTime: 60_000,
  });

  const items = useMemo(() => tags.data?.items ?? [], [tags.data]);
  const shown = items.filter((g) => !q || `${g.path} ${g.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <p className="text-[12px] text-ink-46">{t('mtr.setLede')}</p>
      <Notice tone="neutral">
        {t('mtr.setReadonly')}{' '}
        {t('mtr.setLinksHint')}{' '}
        <Link to="/infrastructure/sources" className="font-medium text-blue hover:underline">{t('mtr.setSourcesLink')}</Link>
        {' · '}
        <Link to="/infrastructure/profiles" className="font-medium text-blue hover:underline">{t('mtr.setProfilesLink')}</Link>
      </Notice>

      <div className="flex items-center gap-3">
        <div className="relative min-w-52 flex-1 md:max-w-sm">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('mtr.setSearchPh')} aria-label={t('mtr.setSearchPh')} />
        </div>
        <span className="text-[12px] text-ink-46">{t('mtr.ovCount', { count: shown.length })}</span>
      </div>

      <Card pad={false}>
        <div className="overflow-x-auto">
          {tags.isLoading ? (
            <div className="p-3"><SkeletonRows rows={8} /></div>
          ) : tags.isError ? (
            <ErrorState onRetry={tags.refetch} />
          ) : shown.length === 0 ? (
            <EmptyState
              title={items.length === 0 ? t('mtr.setEmpty') : t('msum.empty')}
              body={items.length === 0 ? t('mtr.setEmptyBody') : undefined}
              icon="search"
              action={items.length === 0 ? <HelpLink doc="dataSource" /> : undefined}
            />
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {(['setColPath', 'setColName', 'setColType', 'setColUnit', 'setColAccess', 'setColSource'] as const).map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`mtr.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.id} className="h-9 border-b border-line last:border-0 hover:bg-info-soft">
                    <td className="max-w-0 px-3"><span className="block truncate font-mono text-[12px]" title={g.path}>{g.path}</span></td>
                    <td className="px-3 text-[12px]">{g.name}</td>
                    <td className="px-3 font-mono text-[12px] text-ink-68">{g.type}</td>
                    <td className="px-3 text-[12px] text-ink-68">{g.unit ?? '—'}</td>
                    <td className="px-3">
                      <span className={`rounded-full border px-1.5 text-[10px] font-semibold ${g.writable ? 'border-line text-ink-68' : 'border-dashed border-line text-ink-46'}`}>
                        {t(g.writable ? 'mtr.setWritable' : 'mtr.setReadonlyTag')}
                      </span>
                    </td>
                    <td className="px-3 text-[12px]">
                      {g.edge_id ? (
                        <Link to={`/infrastructure/sources/${g.edge_id}`} className="text-blue hover:underline">
                          {t('mtr.setOpenSource')}
                        </Link>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
