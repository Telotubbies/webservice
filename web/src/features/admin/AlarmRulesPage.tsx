// Alarm rules — list + enable toggle (admin|owner mutations, read for operator).
// Disabling a rule silences an alarm source (ISA-18.2 "shelving"-class
// change), so it confirms; enabling does not. Read-only sessions see the
// rule state as text plus one notice that names their role and who can edit.

import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { DdIcon } from '../../shared/ui/DdIcon';
import { adminApi, type AdminRule } from '../../lib/api';
import { notifyApi, type RuleNotify } from '../notify/api';
import { RuleNotifyEditor, EMPTY_NOTIFY } from './RuleNotifyEditor';
import { useAdminOrg, useAdminSite, canAdmin } from './admin';
import { SeverityBadge } from '../../shared/ui/Status';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { Toggle } from '../../shared/ui/Toggle';
import { Confirm } from '../../shared/ui/Confirm';
import { AdminFrame, OrgScope, LiveStatus } from './access';
import { explainError } from './access-util';

export function AlarmRulesPage() {
  const { t } = useTranslation();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
  const { site, sites, setSiteId, loading: sitesLoading } = useAdminSite(orgId);
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [del, setDel] = useState<AdminRule | null>(null);
  const [off, setOff] = useState<AdminRule | null>(null);
  const [routing, setRouting] = useState<AdminRule | null>(null);

  const rules = useQuery({
    queryKey: ['admin-rules', orgId, site?.id],
    queryFn: () => adminApi.rules(orgId!, site!.id),
    enabled: !!orgId && !!site?.id,
  });
  // member-read: lets the table show the signal path instead of a UUID
  const tags = useQuery({
    queryKey: ['admin-tags', orgId, site?.id],
    queryFn: () => adminApi.siteTags(orgId!, site!.id),
    enabled: !!orgId && !!site?.id,
  });

  if (loading || sitesLoading || rules.isLoading) return <><PageBar title={t('nav.adminRules')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.adminRules')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const mutable = canAdmin(orgRole ?? 'none');
  const items = rules.data?.items ?? [];
  const tagById = new Map((tags.data?.items ?? []).map((x) => [x.id, x]));

  const mutate = (p: Promise<unknown>, okMsg: string) => {
    void p.then(() => { setErr(''); setMsg(okMsg); void qc.invalidateQueries({ queryKey: ['admin-rules'] }); })
      .catch((e) => { setMsg(''); setErr(explainError(t, e)); });
  };
  const setEnabled = (r: AdminRule, v: boolean) => {
    if (!site) return;
    mutate(adminApi.patchRule(orgId, site.id, r.id, { enabled: v }),
      t(v ? 'access.ruleOn' : 'access.ruleOff', { name: r.name }));
  };

  return (
    <>
      <PageBar
        title={t('nav.adminRules')}
        lede={t('admin.rulesLede')}
        actions={
          mutable ? (
            <NavLink to="/admin/rules/new" className="flex h-7 items-center gap-1 rounded bg-blue px-2.5 text-[13px] text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
              <DdIcon name="plus" size={12} /> {t('admin.addRule')}
            </NavLink>
          ) : undefined
        }
      />
      <AdminFrame>
        <OrgScope
          orgId={orgId} orgName={orgName} orgRole={orgRole} site={site}
          siteControl={sites.length > 1 ? (
            <select className="input h-7 text-[12px]" aria-label={t('admin.selectSite')} value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : undefined}
        />
        {!mutable && (
          <div className="mb-3">
            <Notice tone="info" icon="lock">
              {t('access.whyReadOnly', { role: t(`roles.${orgRole ?? 'none'}`, { defaultValue: orgRole ?? '' }) })}
            </Notice>
          </div>
        )}
        <LiveStatus msg={msg} />
        {err && <div className="mb-3"><Notice tone="error">{err}</Notice></div>}
        <Card pad={false}>
          {rules.isError ? (
            <ErrorState onRetry={() => void rules.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title={t('admin.noRules')} body={mutable ? t('admin.noRulesBody') : undefined} />
          ) : (
            <div className="admin-table overflow-x-auto">
              <Table head={[
                t('admin.ruleName'), t('admin.ruleTag'), t('admin.ruleKind'), t('admin.ruleThreshold'),
                t('admin.ruleDeadband'), t('alarms.severity'), t('admin.ruleEnabled'),
                ...(mutable ? [<span key="a" className="sr-only">{t('access.colActions')}</span>] : []),
              ]}>
                {items.map((r) => {
                  const tag = tagById.get(r.tag_id);
                  const unit = tag?.unit ? ` ${tag.unit}` : '';
                  return (
                    <Fragment key={r.id}>
                    <tr>
                      <td className="font-medium">{r.name}</td>
                      <td className="max-w-56 truncate font-mono text-[12px] text-ink-68" title={tag?.path ?? r.tag_id}>{tag?.path ?? r.tag_id}</td>
                      <td className="whitespace-nowrap text-[12px]">{t(`admin.kind_${r.kind}`, { defaultValue: r.kind })}</td>
                      <td className="whitespace-nowrap font-mono text-[12px] tabular-nums">
                        {r.threshold != null ? `${r.threshold}${unit}` : t('admin.staleAfter', { s: r.stale_s })}
                      </td>
                      <td className="font-mono text-[12px] tabular-nums">{r.deadband}{r.deadband ? unit : ''}</td>
                      <td><SeverityBadge severity={r.severity} /></td>
                      <td>
                        {mutable ? (
                          <Toggle
                            on={r.enabled}
                            label={t('admin.ruleEnabledFor', { name: r.name })}
                            onChange={(v) => (v ? setEnabled(r, true) : setOff(r))}
                          />
                        ) : (
                          // read-only: state as text, not a 40%-opacity switch
                          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink">
                            <span aria-hidden className="text-[9px]">{r.enabled ? '●' : '○'}</span>
                            {r.enabled ? t('admin.enabled') : t('admin.disabled')}
                          </span>
                        )}
                      </td>
                      {mutable && (
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              aria-expanded={routing?.id === r.id}
                              onClick={() => setRouting(routing?.id === r.id ? null : r)}
                            >
                              {t('rn.edit')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                              aria-label={`${t('admin.delete')} ${r.name}`}
                              onClick={() => setDel(r)}
                            >
                              {t('admin.delete')}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {mutable && routing?.id === r.id && (
                      <tr className="bg-subtle">
                        <td colSpan={8} className="px-3 py-3">
                          <RuleRoutingRow orgId={orgId} rule={r}
                            onClose={() => setRouting(null)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </Table>
            </div>
          )}
        </Card>
      </AdminFrame>
      {off && (
        <Confirm
          title={t('access.ruleDisableTitle')}
          body={t('access.ruleDisableBody', { name: off.name })}
          confirm={t('access.ruleDisableConfirm')}
          onNo={() => setOff(null)}
          onYes={() => { const r = off; setOff(null); setEnabled(r, false); }}
        />
      )}
      {del && (
        <Confirm
          title={t('admin.confirmDelete')}
          body={t('admin.deleteRuleBody', { name: del.name })}
          confirm={t('admin.delete')}
          onNo={() => setDel(null)}
          onYes={() => {
            const r = del;
            setDel(null);
            if (!site) return;
            mutate(adminApi.deleteRule(orgId, site.id, r.id), t('access.ruleDeleted', { name: r.name }));
          }}
        />
      )}
    </>
  );
}

/** Inline routing editor for one rule — loads the current PUT body, edits
 * it through the shared RuleNotifyEditor, saves back over the same path. */
function RuleRoutingRow({ orgId, rule, onClose }: {
  orgId: string; rule: AdminRule; onClose: () => void;
}) {
  const { t } = useTranslation();
  const cur = useQuery({
    queryKey: ['rule-notify', orgId, rule.id],
    queryFn: () => notifyApi.ruleNotify(orgId, rule.id),
  });
  const [v, setV] = useState<RuleNotify | null>(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const value = v ?? cur.data?.notify ?? EMPTY_NOTIFY;

  const save = useMutation({
    mutationFn: () => notifyApi.setRuleNotify(orgId, rule.id, value),
    onSuccess: () => { setSaved(true); setErr(''); },
    onError: () => { setErr(t('rn.failed')); setSaved(false); },
  });

  return (
    <div>
      <RuleNotifyEditor orgId={orgId} value={value} onChange={(x) => { setV(x); setSaved(false); }} />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn btn-sm" disabled={save.isPending || cur.isLoading}
          onClick={() => save.mutate()}>
          {t('rn.save')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('common.close')}</button>
        {saved && <span className="text-[12px] text-[var(--color-ok)]" role="status">✓ {t('rn.saved')}</span>}
        {err && <span className="text-[12px] text-[var(--color-danger)]" role="alert">{err}</span>}
      </div>
    </div>
  );
}
