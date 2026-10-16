// Alarm settings — deep-linkable subsections (dd "Monitors › Settings"):
//   /alarms/settings/general        rule rollup (the old single page)
//   /alarms/settings/notifications  channels + escalation policies (read,
//                                   admin toggle) — the real notify contracts
//   /alarms/settings/policies       downtime policies + shelving behaviour
//   /alarms/settings/archive        disabled rules, admin can restore
// Every fetch is a member-read; the write controls are hidden unless the
// user holds admin|owner in the scoped org (v4 T14 orgRole, not useRole).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router';
import { api, adminApi, downtimeApi, ApiError, type AdminRule } from '../../lib/api';
import { notifyApi, type EscPolicy } from '../notify/api';
import { canAdmin } from '../../app/session';
import { useAdminOrg, usePrimaryScope } from '../admin/admin';
import { PageBar, PageBody, Card, Table, type PageTab } from '../../shared/ui/Page';
import { EmptyState, ErrorState, SkeletonRows, Notice } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { Toggle } from '../../shared/ui/Toggle';
import { useNow } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import '../misc/i18n';
import './i18n';

const SECTIONS = ['general', 'notifications', 'policies', 'archive'] as const;
type Section = (typeof SECTIONS)[number];

function errText(e: unknown): string {
  return e instanceof ApiError ? e.message : String(e);
}

// ---------------------------------------------------------------- general

function General() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules });
  const rules = q.data ?? [];
  const on = rules.filter((r) => r.enabled).length;
  const bySev = ['critical', 'warning', 'info'].map((s) => [s, rules.filter((r) => r.severity === s).length] as const);
  if (q.isLoading) return <SkeletonRows />;
  if (q.isError) return <ErrorState onRetry={q.refetch} />;
  if (rules.length === 0) return <EmptyState title={t('px.empty')} icon="search" />;
  return (
    <>
      <div className="flex flex-wrap gap-6 rounded-[5px] border border-line bg-white p-4 text-[12px] text-ink-68">
        <span><b className="block font-mono text-[22px] text-ink">{rules.length}</b>{t('px.alarmSettings.total')}</span>
        <span><b className="block font-mono text-[22px] text-ink">{on}</b>{t('px.alarmSettings.enabled')}</span>
        <span><b className="block font-mono text-[22px] text-ink">{rules.length - on}</b>{t('px.alarmSettings.disabled')}</span>
        {bySev.map(([s, n]) => <span key={s}><b className="block font-mono text-[22px] text-ink">{n}</b><SeverityBadge severity={s} /></span>)}
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <Table head={['colRule', 'colTag', 'colKind', 'colThreshold', 'colSeverity', 'colState'].map((c) => t(`px.alarmSettings.${c}`))}>
            {rules.map((r) => (
              <tr key={r.name}>
                <td className="font-medium">{r.name}</td>
                <td className="font-mono text-[12px] text-ink-68">{r.tag ?? '—'}</td>
                <td>{r.kind}</td>
                <td className="font-mono">{r.threshold ?? (r.stale_s != null ? `${r.stale_s}s` : '—')}</td>
                <td><SeverityBadge severity={r.severity} /></td>
                <td>{r.enabled ? t('px.alarmSettings.enabled') : t('px.alarmSettings.disabled')}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </>
  );
}

// ----------------------------------------------------------- notifications

function Notifications({ orgId, admin, now }: { orgId: string; admin: boolean; now: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const channels = useQuery({ queryKey: ['notify-channels', orgId], queryFn: () => notifyApi.channels(orgId) });
  const policies = useQuery({ queryKey: ['notify-policies', orgId], queryFn: () => notifyApi.policies(orgId) });
  const busy = useState(() => new Set<string>())[0];

  const flip = (kind: 'channel' | 'policy', id: string, enabled: boolean) => {
    if (!admin || busy.has(id)) return;
    busy.add(id);
    setErr('');
    const p = kind === 'channel'
      ? notifyApi.patchChannel(orgId, id, { enabled })
      : notifyApi.patchPolicy(orgId, id, { enabled });
    p.then(() => {
      void qc.invalidateQueries({ queryKey: ['notify-channels', orgId] });
      void qc.invalidateQueries({ queryKey: ['notify-policies', orgId] });
    }).catch((e) => setErr(errText(e))).finally(() => busy.delete(id));
  };

  if (channels.isLoading || policies.isLoading) return <SkeletonRows />;
  if (channels.isError || policies.isError) {
    return <ErrorState onRetry={() => { void channels.refetch(); void policies.refetch(); }} />;
  }
  const chs = channels.data?.items ?? [];
  const pols = policies.data?.items ?? [];
  return (
    <>
      {!admin && <Notice tone="info">{t('aset.notif.adminNote')}</Notice>}
      {err && <Notice tone="warn">{err}</Notice>}
      <Card title={t('aset.notif.title')}>
        <p className="mb-2 text-[12px] text-ink-68">{t('aset.notif.lede')}</p>
        {chs.length === 0 ? (
          <EmptyState title={t('aset.notif.empty')} body={t('aset.notif.emptyBody')} icon="bell" />
        ) : (
          <div className="overflow-x-auto">
            <Table head={[t('aset.notif.colName'), t('aset.notif.colType'), t('aset.notif.colState'), t('aset.notif.colCreated')]}>
              {chs.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td className="font-mono text-[12px] text-ink-68">{c.type}</td>
                  <td>
                    {admin ? (
                      <Toggle on={c.enabled} disabled={busy.has(c.id)} label={`${c.name}`} onChange={(v) => flip('channel', c.id, v)} />
                    ) : (
                      c.enabled ? t('px.alarmSettings.enabled') : t('px.alarmSettings.disabled')
                    )}
                  </td>
                  <td className="font-mono text-[12px] text-ink-68">{fmtAge(c.created_at, now)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
      <Card title={t('aset.notif.policies')}>
        <p className="mb-2 text-[12px] text-ink-68">{t('aset.notif.policiesLede')}</p>
        {pols.length === 0 ? (
          <EmptyState title={t('aset.notif.empty')} icon="bell" />
        ) : (
          <div className="overflow-x-auto">
            <Table head={[t('aset.notif.colPolicy'), t('aset.notif.colScope'), t('aset.notif.colLevels'), t('aset.notif.colState')]}>
              {pols.map((p: EscPolicy) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-[12px] text-ink-68">{p.rule_id ?? t('aset.notif.scopeAll')}</td>
                  <td className="font-mono text-[12px] text-ink-68">
                    {p.levels.map((l, i) => (
                      <span key={i} className="mr-2 inline-block">
                        {t('aset.notif.levelAfter', { n: l.after_minutes })}→{l.channel_ids.length + l.team_ids.length + (l.oncall_team ? `+${t('aset.notif.oncall')}` : '')}
                      </span>
                    ))}
                  </td>
                  <td>
                    {admin ? (
                      <Toggle on={p.enabled} disabled={busy.has(p.id)} label={p.name} onChange={(v) => flip('policy', p.id, v)} />
                    ) : (
                      p.enabled ? t('px.alarmSettings.enabled') : t('px.alarmSettings.disabled')
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}
        <p className="mt-2 text-[12px]">
          <Link to="/notifications/channels" className="rounded text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">{t('aset.notif.manage')}</Link>
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- policies

function Policies({ orgId, now }: { orgId: string; now: number }) {
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ['downtimes', orgId], queryFn: () => downtimeApi.list(orgId) });
  if (q.isLoading) return <SkeletonRows />;
  if (q.isError) return <ErrorState onRetry={q.refetch} />;
  const dts = q.data?.downtimes ?? [];
  const fmt = (ts: string) => new Date(ts).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short', hour12: false });
  const state = (d: { starts_at: string; ends_at: string }) =>
    Date.parse(d.ends_at) <= now ? 'past' : Date.parse(d.starts_at) <= now ? 'active' : 'scheduled';
  return (
    <>
      <Card title={t('aset.pol.shelving')}>
        <p className="text-[12px] text-ink-68">{t('aset.pol.shelvingBody')}</p>
      </Card>
      <Card title={t('aset.pol.downtimes')}>
        <p className="mb-2 text-[12px] text-ink-68">{t('aset.pol.downtimesLede')}</p>
        {dts.length === 0 ? (
          <EmptyState title={t('aset.pol.empty')} body={t('aset.pol.emptyBody')} icon="clock" />
        ) : (
          <div className="overflow-x-auto">
            <Table head={[t('aset.pol.colScope'), t('aset.pol.colDesc'), t('aset.pol.colWindow'), t('aset.pol.colRecur'), t('aset.pol.colEnds')]}>
              {dts.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.rule ?? t('aset.pol.scopeAll')}</td>
                  <td className="max-w-56 truncate text-[12px] text-ink-68" title={d.description}>{d.description || '—'}</td>
                  <td className="whitespace-nowrap font-mono text-[12px] text-ink-68">{fmt(d.starts_at)} – {fmt(d.ends_at)}</td>
                  <td className="text-[12px]">{d.recurring ? t('aset.pol.recurring') : t('aset.pol.once')}</td>
                  <td>{t(`aset.pol.${state(d)}`)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
        <p className="mt-2 text-[12px]">
          <Link to="/downtimes" className="rounded text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">{t('aset.pol.manage')}</Link>
        </p>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------- archive

function Archive({ orgId, siteId, admin }: { orgId: string; siteId: string; admin: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-rules', orgId, siteId], queryFn: () => adminApi.rules(orgId, siteId) });
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const off = useMemo(() => (q.data?.items ?? []).filter((r: AdminRule) => !r.enabled), [q.data]);

  const restore = (r: AdminRule) => {
    if (!admin || busy.has(r.id)) return;
    setErr('');
    setBusy((s) => new Set(s).add(r.id));
    adminApi.patchRule(orgId, siteId, r.id, { enabled: true })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['admin-rules'] });
        void qc.invalidateQueries({ queryKey: ['alarm-rules'] });
      })
      .catch((e) => setErr(t('aset.arc.failed', { reason: errText(e) })))
      .finally(() => setBusy((s) => { const n = new Set(s); n.delete(r.id); return n; }));
  };

  if (q.isLoading) return <SkeletonRows />;
  if (q.isError) return <ErrorState onRetry={q.refetch} />;
  return (
    <Card title={t('aset.arc.title')}>
      <p className="mb-2 text-[12px] text-ink-68">{t('aset.arc.lede')}</p>
      {!admin && off.length > 0 && <div className="mb-2"><Notice tone="info">{t('aset.arc.adminOnly')}</Notice></div>}
      {err && <div className="mb-2"><Notice tone="warn">{err}</Notice></div>}
      {off.length === 0 ? (
        <EmptyState title={t('aset.arc.empty')} body={t('aset.arc.emptyBody')} icon="bell" />
      ) : (
        <div className="overflow-x-auto">
          <Table head={[t('px.alarmSettings.colRule'), t('px.alarmSettings.colTag'), t('px.alarmSettings.colKind'), t('px.alarmSettings.colSeverity'), t('aset.arc.restore')]}>
            {off.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td className="font-mono text-[12px] text-ink-68">{r.tag_id}</td>
                <td>{r.kind}</td>
                <td><SeverityBadge severity={r.severity} /></td>
                <td>
                  {admin && (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy.has(r.id)} onClick={() => restore(r)}>
                      {busy.has(r.id) ? t('aset.arc.restoring') : t('aset.arc.restore')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------------- page

export function AlarmSettingsPage() {
  const { t } = useTranslation();
  const { section } = useParams();
  const { orgId, orgRole, loading } = useAdminOrg();
  const { siteId } = usePrimaryScope();
  const admin = canAdmin(orgRole ?? 'none');
  const now = useNow(30_000);
  const sec: Section = (SECTIONS as readonly string[]).includes(section ?? '') ? (section as Section) : 'general';
  if (section != null && sec !== section) return <Navigate to="/alarms/settings/general" replace />;

  const tabs: PageTab[] = [
    { to: '/alarms/settings/general', label: t('aset.tabGeneral'), end: true },
    { to: '/alarms/settings/notifications', label: t('aset.tabNotifications'), end: true },
    { to: '/alarms/settings/policies', label: t('aset.tabPolicies'), end: true },
    { to: '/alarms/settings/archive', label: t('aset.tabArchive'), end: true },
  ];

  return (
    <>
      <PageBar
        icon="cog" title={t('px.alarmSettings.title')} tabs={tabs}
        actions={admin && orgId ? <Link to="/admin/rules" className="btn btn-sm">{t('px.alarmSettings.manage')}</Link> : undefined}
      />
      <PageBody className="space-y-3">
        {loading || !orgId ? (
          <SkeletonRows />
        ) : sec === 'general' ? <General />
          : sec === 'notifications' ? <Notifications orgId={orgId} admin={admin} now={now} />
          : sec === 'policies' ? <Policies orgId={orgId} now={now} />
          : !siteId ? <SkeletonRows /> : <Archive orgId={orgId} siteId={siteId} admin={admin} />}
      </PageBody>
    </>
  );
}
