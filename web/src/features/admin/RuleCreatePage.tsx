// New rule — dd monitor-create pattern: numbered step sections, detection
// method cards, right sticky preview, bottom action bar. POSTs via
// adminApi.createRule then returns to the rules list.
// A11y: one <form> (Enter submits from any text field), method cards are a
// native radio group (arrow keys), every field has a visible label + hint,
// and submit validates inline — errors sit under each field, are linked via
// aria-describedby, and focus moves to the first invalid field.

import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { adminApi } from '../../lib/api';
import { useAdminOrg, useAdminSite, canAdmin } from './admin';
import { PageBar, Card } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { Toggle } from '../../shared/ui/Toggle';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Icon } from '../../shared/ui/Icon';
import { AdminFrame, OrgScope } from './access';
import { explainError } from './access-util';

type Kind = 'hi' | 'lo' | 'stale';
type Field = 'name' | 'tag' | 'threshold' | 'stale' | 'deadband';
const SEVERITIES = ['critical', 'warning', 'info'];
const METHODS: Kind[] = ['hi', 'lo', 'stale'];

function StepHead({ n, title, as: As = 'h2' }: { n: number; title: string; as?: 'h2' | 'legend' }) {
  return (
    <As className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
      <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-purple-dd text-[11px] font-bold text-white">{n}</span>
      {title}
    </As>
  );
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return (
    <span id={id} className="flex items-center gap-1 text-[12px] text-[var(--color-danger)]">
      <Icon name="warn" size={12} />{msg}
    </span>
  );
}

export function RuleCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
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
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;
  // focus target for "first invalid field" — looked up by id at submit time
  const formRef = useRef<HTMLFormElement>(null);

  if (loading || sitesLoading) return <><PageBar title={t('nav.adminRules')} /><PageSkeleton /></>;
  if (!orgId || !site) return <><PageBar title={t('nav.adminRules')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;
  const scope = <OrgScope orgId={orgId} orgName={orgName} orgRole={orgRole} site={site} />;
  if (!canAdmin(orgRole ?? 'none')) {
    return (
      <>
        <PageBar title={t('nav.adminRules')} lede={t('admin.addRule')} />
        <AdminFrame>
          {scope}
          <Notice tone="info" icon="lock">
            {t('access.whyReadOnly', { role: t(`roles.${orgRole ?? 'none'}`, { defaultValue: orgRole ?? '' }) })}
          </Notice>
        </AdminFrame>
      </>
    );
  }

  const tag = (tags.data?.items ?? []).find((x) => x.id === tagId);
  const unit = tag?.unit ?? '';

  const validate = (): Partial<Record<Field, string>> => {
    const e: Partial<Record<Field, string>> = {};
    if (!name.trim()) e.name = t('access.nameRequired');
    if (!tagId) e.tag = t('access.tagRequired');
    if (kind === 'stale') {
      const s = Number(staleS);
      if (!Number.isInteger(s) || s <= 0) e.stale = t('access.staleRequired');
    } else {
      if (threshold.trim() === '' || !Number.isFinite(Number(threshold))) e.threshold = t('access.thresholdRequired');
      const d = Number(deadband || '0');
      if (!Number.isFinite(d) || d < 0) e.deadband = t('access.deadbandInvalid');
    }
    return e;
  };

  const submit = () => {
    if (busy) return;
    const e = validate();
    setErrors(e);
    const order: Field[] = ['name', 'tag', 'threshold', 'stale', 'deadband'];
    const first = order.find((f) => e[f]);
    if (first) { formRef.current?.querySelector<HTMLElement>(`[id="${id(first)}"]`)?.focus(); return; }
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
    }).catch((x) => { setErr(explainError(t, x)); setBusy(false); });
  };

  /** aria wiring for one field: hint always, error when present */
  const a11y = (f: Field, hint?: boolean) => ({
    id: id(f),
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': [hint ? id(`${f}-hint`) : '', errors[f] ? id(`${f}-err`) : ''].filter(Boolean).join(' ') || undefined,
  });
  const clear = (f: Field) => { if (errors[f]) setErrors((p) => ({ ...p, [f]: undefined })); };
  const errCount = Object.values(errors).filter(Boolean).length;

  return (
    <>
      <PageBar title={t('nav.adminRules')} lede={t('admin.addRule')} />
      <form ref={formRef} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <AdminFrame>
          {scope}
          <div className="flex min-w-0 gap-6">
            {/* steps column */}
            <div className="min-w-0 flex-1">
              <fieldset className="mb-6 min-w-0">
                <StepHead as="legend" n={1} title={t('admin.stepMethod')} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {METHODS.map((m) => (
                    <label
                      key={m}
                      className={`flex cursor-pointer gap-2 rounded-dd border p-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue motion-reduce:transition-none ${
                        kind === m ? 'border-blue bg-info-soft shadow-card' : 'border-line hover:border-line-hard'
                      }`}
                    >
                      <input
                        type="radio" name="rule-kind" value={m}
                        checked={kind === m} onChange={() => setKind(m)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-blue)] focus-visible:outline-none"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold">{t(`admin.kind_${m}`)}</span>
                        <span className="mt-0.5 block text-[12px] text-ink-68">{t(`admin.kind_${m}_desc`)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <section className="mb-6" aria-labelledby={id('step2')}>
                <h2 id={id('step2')} className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                  <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-purple-dd text-[11px] font-bold text-white">2</span>
                  {t('admin.stepDefine')}
                </h2>
                <Card>
                  {tags.isError ? (
                    <ErrorState onRetry={() => void tags.refetch()} />
                  ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="field">
                      <label className="field-label" htmlFor={id('name')}>{t('admin.ruleName')}</label>
                      <input
                        className="input h-8" name="rule-name" autoComplete="off"
                        value={name} onChange={(e) => { setName(e.target.value); clear('name'); }}
                        placeholder={`${t('admin.ruleNamePh')}…`}
                        {...a11y('name')}
                      />
                      <FieldError id={id('name-err')} msg={errors.name} />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor={id('tag')}>{t('admin.ruleTag')}</label>
                      <select
                        className="input h-8" value={tagId}
                        onChange={(e) => { setTagId(e.target.value); clear('tag'); }}
                        {...a11y('tag')}
                      >
                        <option value="">{t('admin.ruleTagPick')}</option>
                        {(tags.data?.items ?? []).map((x) => (
                          <option key={x.id} value={x.id}>{x.path}{x.unit ? ` (${x.unit})` : ''}</option>
                        ))}
                      </select>
                      <FieldError id={id('tag-err')} msg={errors.tag} />
                    </div>
                    {kind !== 'stale' ? (
                      <>
                        <div className="field">
                          <label className="field-label" htmlFor={id('threshold')}>
                            {t('admin.ruleThreshold')}{unit ? ` (${unit})` : ''}
                          </label>
                          <input
                            className="input num h-8" type="number" step="any" inputMode="decimal"
                            value={threshold} onChange={(e) => { setThreshold(e.target.value); clear('threshold'); }}
                            {...a11y('threshold', true)}
                          />
                          <span id={id('threshold-hint')} className="text-[11px] text-ink-68">
                            {t(kind === 'hi' ? 'access.thresholdHintHi' : 'access.thresholdHintLo')}
                          </span>
                          <FieldError id={id('threshold-err')} msg={errors.threshold} />
                        </div>
                        <div className="field">
                          <label className="field-label" htmlFor={id('deadband')}>
                            {t('admin.ruleDeadband')}{unit ? ` (${unit})` : ''}
                          </label>
                          <input
                            className="input num h-8" type="number" step="any" min="0" inputMode="decimal"
                            value={deadband} onChange={(e) => { setDeadband(e.target.value); clear('deadband'); }}
                            {...a11y('deadband', true)}
                          />
                          <span id={id('deadband-hint')} className="text-[11px] text-ink-68">{t('access.deadbandHint')}</span>
                          <FieldError id={id('deadband-err')} msg={errors.deadband} />
                        </div>
                      </>
                    ) : (
                      <div className="field">
                        <label className="field-label" htmlFor={id('stale')}>{t('admin.ruleStale')}</label>
                        <input
                          className="input num h-8" type="number" min="1" step="1" inputMode="numeric"
                          value={staleS} onChange={(e) => { setStaleS(e.target.value); clear('stale'); }}
                          {...a11y('stale', true)}
                        />
                        <span id={id('stale-hint')} className="text-[11px] text-ink-68">{t('access.staleHint')}</span>
                        <FieldError id={id('stale-err')} msg={errors.stale} />
                      </div>
                    )}
                    <div className="field">
                      <label className="field-label" htmlFor={id('sev')}>{t('admin.ruleSeverity')}</label>
                      <select id={id('sev')} className="input h-8" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                        {SEVERITIES.map((s) => <option key={s} value={s}>{t(`alarms.${s}`)}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <span className="field-label" id={id('en')}>{t('admin.ruleEnabled')}</span>
                      <span className="flex h-8 items-center gap-2">
                        <Toggle on={enabled} onChange={setEnabled} label={t('admin.ruleEnabled')} />
                        <span className="text-[12px] text-ink-68">{enabled ? t('admin.enabled') : t('admin.disabled')}</span>
                      </span>
                    </div>
                  </div>
                  )}
                </Card>
              </section>
            </div>

            {/* right sticky preview — dd monitor-create right rail */}
            <aside className="hidden w-72 shrink-0 lg:block" aria-label={t('admin.rulePreview')}>
              <div className="sticky top-24">
                <Card title={t('admin.rulePreview')}>
                  <div className="space-y-2 text-[12px]">
                    <p className="text-[13px] font-semibold">{name.trim() || '—'}</p>
                    <p className="text-ink-68">{t(`admin.kind_${kind}`)}</p>
                    <p className="font-mono text-[11px] text-ink-68">{tag?.path ?? t('admin.ruleTagPick')}</p>
                    <p className="font-mono text-[12px]">
                      {kind === 'stale' ? t('admin.stalePreview', { s: staleS }) : `${kind === 'hi' ? '>' : '<'} ${threshold || '…'} ± ${deadband}${unit ? ` ${unit}` : ''}`}
                    </p>
                    <SeverityBadge severity={severity} />
                  </div>
                </Card>
              </div>
            </aside>
          </div>
        </AdminFrame>

        {/* bottom action bar — dd monitor-create */}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-white/95 px-4 py-2 backdrop-blur">
          <span className="min-w-0 flex-1 text-[12px]" role="alert">
            {err ? <span className="text-[var(--color-danger)]">{err}</span>
              : errCount > 0 ? <span className="text-[var(--color-danger)]">{t('access.fixErrors')}</span> : null}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => nav('/admin/rules')}>{t('control.cancel')}</button>
          <button type="submit" className="btn" aria-disabled={busy || undefined}>
            <DdIcon name="plus" size={12} /> {busy ? t('access.creating') : t('admin.createRule')}
          </button>
        </div>
      </form>
    </>
  );
}
