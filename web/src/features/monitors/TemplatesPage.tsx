// Monitor templates — dd "Monitors › Templates". Curated plant rule packs
// rendered as cards; Preview expands the exact rules a pack would create
// (bound signal + will-create / already-exists / no-signal status); Install
// writes real alarm rules via the v2 config endpoint. Admin installs;
// every member role sees the same read-only preview (site tags and rule
// lists are member-read, so no 4xx for viewers/operators).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { adminApi, ApiError } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { useAdminOrg, usePrimaryScope } from '../admin/admin';
import { PageBar, PageBody, Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Icon } from '../../shared/ui/Icon';
import { PACKS, expandPack, packItemBody, packItemCond, type PackItem, type RulePack } from './packs';
import { useMonitoringTabs } from './MonitorsPage';
import './i18n';

const CHIP: Record<PackItem['status'], { cls: string; key: string }> = {
  create: { cls: 'bg-[var(--color-ok-soft)] text-[var(--color-ok-ink)]', key: 'mon.tpl.stCreate' },
  exists: { cls: 'bg-subtle text-ink-68', key: 'mon.tpl.stExists' },
  notag: { cls: 'bg-sev-medium-soft text-sev-ink', key: 'mon.tpl.stNoTag' },
};

function PackCard({ pack, orgId, siteId, admin }: {
  pack: RulePack; orgId: string; siteId: string; admin: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; detail?: string }[] | null>(null);

  const tags = useQuery({
    queryKey: ['admin-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId, siteId),
  });
  const rules = useQuery({
    queryKey: ['admin-rules', orgId, siteId],
    queryFn: () => adminApi.rules(orgId, siteId),
  });

  const loading = tags.isLoading || rules.isLoading;
  const items = useMemo(
    () => expandPack(pack, tags.data?.items ?? [], rules.data?.items ?? []),
    [pack, tags.data, rules.data],
  );
  const installable = items.filter((i) => i.status === 'create');
  const done = results != null;
  const okCount = (results ?? []).filter((r) => r.ok).length;

  const install = async () => {
    setConfirm(false);
    setBusy(true);
    const out: { name: string; ok: boolean; detail?: string }[] = [];
    for (const it of installable) {
      const body = packItemBody(it);
      if (!body) continue;
      try {
        await adminApi.createRule(orgId, siteId, body);
        out.push({ name: it.name, ok: true });
      } catch (e) {
        out.push({ name: it.name, ok: false, detail: e instanceof ApiError ? e.message : String(e) });
      }
    }
    setResults(out);
    setBusy(false);
    setOpen(true);
    void qc.invalidateQueries({ queryKey: ['admin-rules'] });
    void qc.invalidateQueries({ queryKey: ['alarm-rules'] });
  };

  return (
    <Card pad={false}>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border border-line bg-subtle text-ink-68">
            <DdIcon name={pack.icon} size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-ink">{t(`mon.tpl.pack.${pack.id}.name`)}</h3>
            <p className="text-[11px] text-ink-46">{t('mon.tpl.rules', { count: pack.rules.length })}</p>
          </div>
        </div>
        <p className="mt-2 min-h-8 text-[12px] text-ink-68">{t(`mon.tpl.pack.${pack.id}.desc`)}</p>
      </div>

      {open && (
        <div className="border-t border-line">
          {loading ? <div className="p-3"><SkeletonRows rows={3} h={18} /></div>
          : tags.isError || rules.isError ? <div className="p-3"><ErrorState compact onRetry={() => { void tags.refetch(); void rules.refetch(); }} /></div>
          : (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {['colRule', 'colSignal', 'colCond', 'colStatus'].map((c) => (
                    <th key={c} scope="col" className="overline h-6 px-3">{t(`mon.tpl.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={`${it.name}-${i}`} className="h-8 border-b border-line last:border-0">
                    <td className="max-w-44 truncate px-3 font-medium" title={it.name}>{it.name}</td>
                    <td className="max-w-40 truncate px-3 font-mono text-[11px] text-ink-68" title={it.tag?.path}>{it.tag ? it.tag.path : '—'}</td>
                    <td className="whitespace-nowrap px-3 font-mono text-[11px] text-ink-68">
                      {t(`mon.kind.${it.def.kind}`, { defaultValue: it.def.kind })}{' '}
                      {t(packItemCond(it.def).key, { v: packItemCond(it.def).v })}
                    </td>
                    <td className="px-3">
                      <span className={`inline-flex h-5 items-center rounded-[3px] px-1.5 text-[11px] font-semibold ${CHIP[it.status].cls}`}>
                        {t(CHIP[it.status].key)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {done && (
        <div className="border-t border-line px-3 py-2" role="status">
          <p className="text-[12px] font-semibold text-ink">
            {t('mon.tpl.done', { ok: okCount, total: results.length })}
            {okCount < results.length && <span className="ml-2 text-[var(--color-danger)]">{t('mon.tpl.failed', { count: results.length - okCount })}</span>}
          </p>
          {results.filter((r) => !r.ok).map((r) => (
            <p key={r.name} className="mt-0.5 truncate text-[11px] text-[var(--color-danger)]" title={r.detail}>
              {r.name}{r.detail ? ` — ${r.detail}` : ''}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <DdIcon name={open ? 'caret-up' : 'caret-down'} size={12} />
          {open ? t('mon.tpl.hidePreview') : t('mon.tpl.preview')}
        </button>
        <span className="flex-1" />
        {admin ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || loading || installable.length === 0}
            title={installable.length === 0 && !loading ? t('mon.tpl.nothingNew') : undefined}
            onClick={() => setConfirm(true)}
          >
            <DdIcon name="plus" size={12} /> {busy ? t('mon.tpl.installing') : t('mon.tpl.install')}
          </button>
        ) : (
          <span className="text-[11px] text-ink-46" title={t('mon.tpl.adminOnly')}>
            <Icon name="lock" size={12} className="mr-0.5 inline" /> {t('mon.tpl.adminOnly')}
          </span>
        )}
      </div>

      {confirm && (
        <Confirm
          danger={false}
          title={t('mon.tpl.confirmTitle', { name: t(`mon.tpl.pack.${pack.id}.name`) })}
          body={t('mon.tpl.confirmBody', { count: installable.length })}
          confirm={t('mon.tpl.install')}
          onYes={() => void install()}
          onNo={() => setConfirm(false)}
        />
      )}
    </Card>
  );
}

export function TemplatesPage() {
  const { t } = useTranslation();
  const tabs = useMonitoringTabs();
  const { orgId, orgRole } = useAdminOrg();
  const { siteId } = usePrimaryScope();
  const [q, setQ] = useState('');
  const admin = canAdmin(orgRole ?? 'none');

  const packs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PACKS;
    return PACKS.filter((p) =>
      t(`mon.tpl.pack.${p.id}.name`).toLowerCase().includes(needle)
      || t(`mon.tpl.pack.${p.id}.desc`).toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, t]);

  return (
    <>
      <PageBar
        icon="monitor" title={t('mon.tpl.title')} tabs={tabs}
        lede={t('mon.tpl.lede')}
        actions={(
          <>
            {admin && orgId && siteId && (
              <NavLink to="/admin/rules/new" className="btn btn-sm"><DdIcon name="plus" size={12} /> {t('mon.newRule')}</NavLink>
            )}
          </>
        )}
      />
      <PageBody>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <p className="text-[13px] font-semibold text-ink">{t('mon.tpl.all')} ({packs.length})</p>
          <div className="relative min-w-56 flex-1">
            <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
            <input
              className="input w-full pl-7"
              placeholder={t('mon.tpl.search')}
              aria-label={t('mon.tpl.searchLabel')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {!orgId || !siteId ? (
          <SkeletonRows rows={4} />
        ) : packs.length === 0 ? (
          <EmptyState title={t('mon.tpl.empty')} body={t('mon.tpl.emptyBody')} icon="search" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {packs.map((p) => (
              <PackCard key={p.id} pack={p} orgId={orgId} siteId={siteId} admin={admin} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
