// New rule — dd monitor-create pattern: numbered step sections, detection
// method cards, right sticky preview, bottom action bar. POSTs via
// adminApi.createRule then returns to the rules list.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { adminApi } from '../../lib/api';
import { useAdminOrg, useAdminSite, canAdmin } from './admin';
import { AdminNav } from './AdminNav';
import { PageBar, Card } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { Toggle } from '../../shared/ui/Toggle';
import { DdIcon } from '../../shared/ui/DdIcon';

type Kind = 'hi' | 'lo' | 'stale';
const SEVERITIES = ['critical', 'warning', 'info'];
const METHODS: Kind[] = ['hi', 'lo', 'stale'];

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-purple-dd text-[11px] font-bold text-white">{n}</span>
      {title}
    </h2>
  );
}

export function RuleCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { orgId, orgRole, loading } = useAdminOrg();
  const { site, loading: sitesLoading } = useAdminSite(orgId);
  const tags = useQuery({
    queryKey: ['admin-tags', orgId, site?.id],
    queryFn: () => adminApi.siteTags(orgId!, site!.id),
    enabled: !!orgId && !!site?.id,
  });

  const [kind, setKind] = useState<Kind>('hi');
  const [name, setName] = useState('');
  const [tagId, setTagId] = useState('');
  const [threshold, setThreshold] = useState('');
  const [staleS, setStaleS] = useState('60');
  const [deadband, setDeadband] = useState('0');
  const [severity, setSeverity] = useState('warning');
  const [enabled, setEnabled] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading || sitesLoading) return <><PageBar title={t('nav.adminRules')} /><PageSkeleton /></>;
  if (!orgId || !site) return <><PageBar title={t('nav.adminRules')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;
  if (!canAdmin(orgRole ?? 'none')) return <><PageBar title={t('nav.adminRules')} /><div className="p-4"><Notice tone="info">{t('admin.readOnlyNotice')}</Notice></div></>;

  const tag = (tags.data?.items ?? []).find((x) => x.id === tagId);
  // 'hi'/'lo' take a finite numeric threshold; 'stale' takes a positive window
  const valid = !!name.trim() && !!tagId && (kind === 'stale' ? Number(staleS) > 0 : threshold !== '' && Number.isFinite(Number(threshold)));

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    void adminApi.createRule(orgId, site.id, {
      name: name.trim(), tag_id: tagId, kind,
      threshold: kind !== 'stale' ? Number(threshold) : null,
      stale_s: kind === 'stale' ? Number(staleS) : null,
      deadband: Number(deadband) || 0,
      severity, enabled,
    }).then(() => {
      void qc.invalidateQueries({ queryKey: ['admin-rules'] });
      nav('/admin/rules');
    }).catch((e) => { setErr(String((e as Error).message ?? e)); setBusy(false); });
  };

  return (
    <>
      <PageBar title={t('nav.adminRules')} lede={t('admin.addRule')} />
      <div className="flex p-4">
        <AdminNav />
        <div className="flex min-w-0 flex-1 gap-6 pl-4">
          {/* steps column */}
          <div className="min-w-0 flex-1">
            <section className="mb-6">
              <StepHead n={1} title={t('admin.stepMethod')} />
              <div className="grid gap-2 sm:grid-cols-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setKind(m)}
                    aria-pressed={kind === m}
                    className={`rounded-dd border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
                      kind === m ? 'border-blue shadow-card' : 'border-line hover:border-line-hard'
                    }`}
                  >
                    <p className="text-[13px] font-semibold">{t(`admin.kind_${m}`)}</p>
                    <p className="mt-0.5 text-[12px] text-ink-68">{t(`admin.kind_${m}_desc`)}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="mb-6">
              <StepHead n={2} title={t('admin.stepDefine')} />
              <Card>
                {/* Enter inside a text field submits the form — excluded on
                    selects so Enter still confirms a dropdown choice */}
                {tags.isError ? (
                  <ErrorState onRetry={() => void tags.refetch()} />
                ) : (
                <div
                  className="grid gap-3 sm:grid-cols-2"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); submit(); }
                  }}
                >
                  <label className="field">
                    <span className="field-label">{t('admin.ruleName')}</span>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.ruleNamePh')} />
                  </label>
                  <label className="field">
                    <span className="field-label">{t('admin.ruleTag')}</span>
                    <select className="input" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                      <option value="">{t('admin.ruleTagPick')}</option>
                      {(tags.data?.items ?? []).map((x) => (
                        <option key={x.id} value={x.id}>{x.path}{x.unit ? ` (${x.unit})` : ''}</option>
                      ))}
                    </select>
                  </label>
                  {kind !== 'stale' ? (
                    <>
                      <label className="field">
                        <span className="field-label">{t('admin.ruleThreshold')}</span>
                        <input className="input num" type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                      </label>
                      <label className="field">
                        <span className="field-label">{t('admin.ruleDeadband')}</span>
                        <input className="input num" type="number" step="any" value={deadband} onChange={(e) => setDeadband(e.target.value)} />
                      </label>
                    </>
                  ) : (
                    <label className="field">
                      <span className="field-label">{t('admin.ruleStale')}</span>
                      <input className="input num" type="number" min="1" value={staleS} onChange={(e) => setStaleS(e.target.value)} />
                    </label>
                  )}
                  <label className="field">
                    <span className="field-label">{t('admin.ruleSeverity')}</span>
                    <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{t(`alarms.${s}`)}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">{t('admin.ruleEnabled')}</span>
                    <span className="flex h-8 items-center"><Toggle on={enabled} onChange={setEnabled} label={t('admin.ruleEnabled')} /></span>
                  </label>
                </div>
                )}
              </Card>
            </section>
          </div>

          {/* right sticky preview — dd monitor-create right rail */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-24">
              <Card title={t('admin.rulePreview')}>
                <div className="space-y-2 text-[12px]">
                  <p className="font-semibold text-[13px]">{name.trim() || '—'}</p>
                  <p className="text-ink-68">{t(`admin.kind_${kind}`)}</p>
                  <p className="font-mono text-[11px] text-ink-46">{tag?.path ?? t('admin.ruleTagPick')}</p>
                  <p className="font-mono text-[12px]">
                    {kind === 'stale' ? t('admin.stalePreview', { s: staleS }) : `${kind === 'hi' ? '>' : '<'} ${threshold || '…'} ± ${deadband}`}
                  </p>
                  <SeverityBadge severity={severity} />
                </div>
              </Card>
            </div>
          </aside>
        </div>
      </div>

      {/* bottom action bar — dd monitor-create */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-white/95 px-4 py-2 backdrop-blur">
        {err && <span className="text-[12px] text-[var(--color-danger)]" role="alert">{err}</span>}
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost" onClick={() => nav('/admin/rules')}>{t('control.cancel')}</button>
        <button type="button" className="btn" disabled={!valid || busy} onClick={submit}>
          <DdIcon name="plus" size={12} /> {busy ? '…' : t('admin.createRule')}
        </button>
      </div>
    </>
  );
}
