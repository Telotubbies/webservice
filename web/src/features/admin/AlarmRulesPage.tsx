// Alarm rules — list + enable toggle (admin|owner mutations, read for operator).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { DdIcon } from '../../shared/ui/DdIcon';
import { adminApi, type AdminRule } from '../../lib/api';
import { useAdminOrg, useAdminSite, canAdmin } from './admin';
import { SeverityBadge } from '../../shared/ui/Status';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { Toggle } from '../../shared/ui/Toggle';
import { Confirm } from '../../shared/ui/Confirm';
import { AdminNav } from './AdminNav';

export function AlarmRulesPage() {
  const { t } = useTranslation();
  const { orgId, orgRole, loading } = useAdminOrg();
  const { site, loading: sitesLoading } = useAdminSite(orgId);
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [del, setDel] = useState<AdminRule | null>(null);

  const rules = useQuery({
    queryKey: ['admin-rules', orgId, site?.id],
    queryFn: () => adminApi.rules(orgId!, site!.id),
    enabled: !!orgId && !!site?.id,
  });

  if (loading || sitesLoading || rules.isLoading) return <><PageBar title={t('nav.adminRules')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.adminRules')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const mutable = canAdmin(orgRole ?? 'none');
  const items = rules.data?.items ?? [];

  const mutate = (p: Promise<unknown>) => {
    void p.then(() => { setErr(''); void qc.invalidateQueries({ queryKey: ['admin-rules'] }); })
      .catch((e) => setErr(String((e as Error).message ?? e)));
  };

  return (
    <>
      <PageBar
        title={t('nav.adminRules')}
        lede={site ? `${t('admin.site')}: ${site.name}` : undefined}
        actions={
          mutable ? (
            <NavLink to="/admin/rules/new" className="flex h-7 items-center gap-1 rounded bg-blue px-2.5 text-[13px] text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
              <DdIcon name="plus" size={12} /> {t('admin.addRule')}
            </NavLink>
          ) : undefined
        }
      />
      <div className="flex p-4">
        <AdminNav />
        <div className="min-w-0 flex-1 pl-4">
        {!mutable && <Notice tone="info">{t('admin.readOnlyNotice')}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        <Card pad={false}>
          {rules.isError ? (
            <ErrorState onRetry={() => void rules.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title={t('admin.noRules')} body={t('admin.noRulesBody')} />
          ) : (
            <Table head={[t('admin.ruleName'), t('admin.ruleTag'), t('admin.ruleKind'), t('admin.ruleThreshold'), t('admin.ruleDeadband'), t('alarms.severity'), t('admin.ruleEnabled'), '']}>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td className="font-mono text-[11px] text-ink-68">{r.tag_id}</td>
                  <td className="font-mono text-[12px]">{t(`admin.kind_${r.kind}`, { defaultValue: r.kind })}</td>
                  <td className="font-mono text-[12px]">{r.threshold ?? t('admin.staleAfter', { s: r.stale_s })}</td>
                  <td className="font-mono text-[12px]">{r.deadband}</td>
                  <td><SeverityBadge severity={r.severity} /></td>
                  <td>
                    <Toggle
                      on={r.enabled}
                      disabled={!mutable}
                      label={t('admin.ruleEnabledFor', { name: r.name })}
                      onChange={(v) => {
                        if (!site) return;
                        mutate(adminApi.patchRule(orgId, site.id, r.id, { enabled: v }));
                      }}
                    />
                  </td>
                  <td className="text-right">
                    {mutable && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost text-[var(--color-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                        aria-label={`${t('admin.delete')} ${r.name}`}
                        onClick={() => setDel(r)}
                      >
                        {t('admin.delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        </div>
      </div>
      {del && (
        <Confirm
          title={t('admin.confirmDelete')}
          body={t('admin.deleteRuleBody', { name: del.name })}
          confirm={t('admin.delete')}
          onNo={() => setDel(null)}
          onYes={() => {
            if (!site) { setDel(null); return; }
            mutate(adminApi.deleteRule(orgId, site.id, del.id));
            setDel(null);
          }}
        />
      )}
    </>
  );
}
