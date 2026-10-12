// Alarm-rule CRUD (v4 T10): config:write on the backend — edits land in
// alarm_rules and NOTIFY the engine, which reloads without a restart.
// Operators see the read-only table (site:read); the editor stays admin-only.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, ApiError, type AdminRule, type RuleInput } from '../../lib/api';
import { useRole, canOperate, canAdmin } from '../../app/session';
import { EmptyState, ErrorState, Notice } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { useAdminOrg, useAdminSite } from './admin';

const KINDS = ['hi', 'hihi', 'lo', 'lolo', 'stale'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;

interface Draft {
  id?: string;
  name: string;
  tag_id: string;
  kind: string;
  threshold: string;
  stale_s: string;
  deadband: string;
  severity: string;
  enabled: boolean;
}

const EMPTY: Draft = {
  name: '', tag_id: '', kind: 'hi', threshold: '', stale_s: '',
  deadband: '0', severity: 'warning', enabled: true,
};

function toDraft(r: AdminRule): Draft {
  return {
    id: r.id, name: r.name, tag_id: r.tag_id, kind: r.kind,
    threshold: r.threshold == null ? '' : String(r.threshold),
    stale_s: r.stale_s == null ? '' : String(r.stale_s),
    deadband: String(r.deadband), severity: r.severity, enabled: r.enabled,
  };
}

function RuleEditor({ org, site, tags, draft, onDone }: {
  org: string; site: string; tags: { id: string; name: string; path: string }[];
  draft: Draft; onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isStale = d.kind === 'stale';
  const valid = d.name.trim() && d.tag_id
    && (isStale ? Number(d.stale_s) >= 5 : d.threshold !== '');

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const body: RuleInput = {
      name: d.name.trim(), tag_id: d.tag_id, kind: d.kind,
      threshold: d.threshold === '' ? null : Number(d.threshold),
      stale_s: d.stale_s === '' ? null : Number(d.stale_s),
      deadband: d.deadband === '' ? 0 : Number(d.deadband),
      severity: d.severity, enabled: d.enabled,
    };
    try {
      if (d.id) await adminApi.patchRule(org, site, d.id, body);
      else await adminApi.createRule(org, site, body);
      void qc.invalidateQueries({ queryKey: ['admin-rules', org, site] });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}` : t('errors.load'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="admin-form-grid">
        <label className="field">
          <span className="field-label">{t('admin.ruleName')}</span>
          <input className="input" value={d.name} required
                 onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">{t('admin.ruleTag')}</span>
          <select className="select" value={d.tag_id} required disabled={!!d.id}
                  onChange={(e) => setD({ ...d, tag_id: e.target.value })}>
            <option value="" disabled>{t('admin.ruleTagPick')}</option>
            {tags.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('admin.ruleKind')}</span>
          <select className="select" value={d.kind}
                  onChange={(e) => setD({ ...d, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`admin.kind_${k}`)}</option>)}
          </select>
        </label>
        {!isStale && (
          <label className="field">
            <span className="field-label">{t('admin.ruleThreshold')}</span>
            <input className="input num" type="number" step="any" value={d.threshold} required
                   onChange={(e) => setD({ ...d, threshold: e.target.value })} />
          </label>
        )}
        {isStale && (
          <label className="field">
            <span className="field-label">{t('admin.ruleStale')}</span>
            <input className="input num" type="number" min={5} max={86400} value={d.stale_s} required
                   onChange={(e) => setD({ ...d, stale_s: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span className="field-label">{t('admin.ruleDeadband')}</span>
          <input className="input num" type="number" min={0} step="any" value={d.deadband}
                 onChange={(e) => setD({ ...d, deadband: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">{t('admin.ruleSeverity')}</span>
          <select className="select" value={d.severity}
                  onChange={(e) => setD({ ...d, severity: e.target.value })}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{t(`alarms.${s}`)}</option>)}
          </select>
        </label>
        <label className="field admin-check">
          <span className="field-label">{t('admin.ruleEnabled')}</span>
          <input type="checkbox" checked={d.enabled}
                 onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
        </label>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="admin-form-actions">
        <button type="button" className="btn btn-ghost" onClick={onDone}>{t('auth.cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
          {d.id ? t('admin.saveRule') : t('admin.createRule')}
        </button>
      </div>
    </form>
  );
}

export function AlarmRulesPage() {
  const { t } = useTranslation();
  const role = useRole();
  const { orgId } = useAdminOrg();
  const { site, sites, setSiteId } = useAdminSite(orgId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const qc = useQueryClient();
  const admin = canAdmin(role);

  const rules = useQuery({
    queryKey: ['admin-rules', orgId, site?.id],
    queryFn: () => adminApi.rules(orgId!, site!.id),
    enabled: orgId != null && site != null,
  });
  const tags = useQuery({
    queryKey: ['admin-tags', orgId, site?.id],
    queryFn: () => adminApi.siteTags(orgId!, site!.id),
    // site:read — any member may resolve tag ids to names
    enabled: orgId != null && site != null,
  });

  if (!canOperate(role)) {
    return (
      <div className="page admin-page">
        <header className="page-head"><div><h1>{t('admin.rulesTitle')}</h1></div></header>
        <EmptyState icon="lock" title={t('admin.restricted')} body={t('admin.restrictedBody')} />
      </div>
    );
  }

  const tagName = (id: string) =>
    tags.data?.items.find((tg) => tg.id === id)?.name ?? rules.data?.items.find((r) => r.tag_id === id)?.tag_id ?? id;

  const doDelete = async (id: string) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    setConfirmDel(null);
    await adminApi.deleteRule(orgId!, site!.id, id).catch(() => {});
    void qc.invalidateQueries({ queryKey: ['admin-rules', orgId, site?.id] });
  };

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>{t('admin.rulesTitle')}</h1>
          <p className="lede">{t('admin.rulesLede')}</p>
        </div>
        <div className="actions">
          {sites.length > 1 && (
            <select className="select" value={site?.id ?? ''}
                    onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {admin && draft === null && (
            <button className="btn btn-primary btn-sm" onClick={() => setDraft(EMPTY)}>
              {t('admin.addRule')}
            </button>
          )}
        </div>
      </header>

      {!admin && <Notice tone="info">{t('admin.readOnlyNotice')}</Notice>}

      {draft !== null && admin && site && (
        <section className="panel">
          <header className="panel-head"><h2>{draft.id ? t('admin.editRule') : t('admin.addRule')}</h2></header>
          <div className="panel-body">
            <RuleEditor org={orgId!} site={site.id} tags={tags.data?.items ?? []}
                        draft={draft} onDone={() => setDraft(null)} />
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-body flush" style={{ overflowX: 'auto' }}>
          {rules.isError ? <ErrorState onRetry={() => void rules.refetch()} />
            : (rules.data?.items.length ?? 0) === 0 ? (
              <EmptyState icon="alarm" title={t('admin.noRules')} body={t('admin.noRulesBody')} />
            ) : (
              <table className="table admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.ruleName')}</th>
                    <th scope="col">{t('admin.ruleTag')}</th>
                    <th scope="col">{t('admin.ruleKind')}</th>
                    <th scope="col" className="num">{t('admin.ruleThreshold')}</th>
                    <th scope="col">{t('admin.ruleSeverity')}</th>
                    <th scope="col">{t('admin.ruleEnabled')}</th>
                    {admin && <th scope="col">{t('alarms.colAction')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rules.data!.items.map((r) => (
                    <tr key={r.id} className={r.enabled ? '' : 'admin-disabled'}>
                      <td>{r.name}</td>
                      <td className="dim">{tagName(r.tag_id)}</td>
                      <td>{t(`admin.kind_${r.kind}`)}</td>
                      <td className="num mono">
                        {r.kind === 'stale' ? `${r.stale_s}s` : (r.threshold ?? '—')}
                        {r.deadband ? ` ±${r.deadband}` : ''}
                      </td>
                      <td><span className="badge">{t(`alarms.${r.severity}`)}</span></td>
                      <td>
                        {admin ? (
                          <button type="button" className="btn btn-ghost btn-sm"
                                  onClick={() => void adminApi.patchRule(orgId!, site!.id, r.id, { enabled: !r.enabled })
                                    .then(() => qc.invalidateQueries({ queryKey: ['admin-rules', orgId, site?.id] }))}>
                            {r.enabled ? t('admin.enabled') : t('admin.disabled')}
                          </button>
                        ) : (
                          <span className="dim">{r.enabled ? t('admin.enabled') : t('admin.disabled')}</span>
                        )}
                      </td>
                      {admin && (
                        <td className="admin-actions">
                          <button type="button" className="btn btn-ghost btn-sm"
                                  onClick={() => setDraft(toDraft(r))}>
                            {t('admin.edit')}
                          </button>
                          <button type="button"
                                  className={`btn btn-sm ${confirmDel === r.id ? 'btn-danger' : 'btn-ghost'}`}
                                  onClick={() => void doDelete(r.id)}>
                            {confirmDel === r.id ? t('admin.confirmDelete') : t('admin.delete')}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </section>
      <p className="hint admin-hint"><Icon name="info" size={14} /> {t('admin.rulesHint')}</p>
    </div>
  );
}
