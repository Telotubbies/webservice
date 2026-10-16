// Incident settings (WP-E) — the response vocabulary the backend fixes
// (read-only), notification channels, escalation policies and on-call.
// Channels manage at /notifications/channels; here the incident console shows
// the wiring and lets admins toggle reachability. Policy + on-call writes are
// admin/owner only; everything reads as a member.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { ApiError, adminApi, teamApi } from '../../lib/api';
import { notifyApi, type ChannelType, type EscLevel, type EscPolicy } from '../notify/api';
import { useAdminOrg, usePrimaryScope } from '../admin/admin';
import { canAdmin } from '../../app/session';
import { OnCallPanel } from '../teams/OnCallPanel';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Toggle } from '../../shared/ui/Toggle';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { Card, PageBar, PageBody, Table } from '../../shared/ui/Page';
import { INC_SEVS, INC_STATUSES, useIncidentTabs } from './incidents';
import '../notify/i18n';
import './i18n';

const CH_TYPE: Record<ChannelType, string> = {
  email: 'Email', line: 'LINE', webhook: 'Webhook', teams: 'Teams', slack: 'Slack',
};

export function IncidentSettingsPage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { siteId } = usePrimaryScope();
  const admin = canAdmin(orgRole ?? 'none');
  const qc = useQueryClient();
  const tabs = useIncidentTabs();

  const channels = useQuery({ queryKey: ['notify-channels', orgId], queryFn: () => notifyApi.channels(orgId!), enabled: !!orgId });
  const policies = useQuery({ queryKey: ['esc-policies', orgId], queryFn: () => notifyApi.policies(orgId!), enabled: !!orgId });
  const teams = useQuery({ queryKey: ['teams', orgId], queryFn: () => teamApi.list(orgId!), enabled: !!orgId });
  const rules = useQuery({ queryKey: ['admin-rules', orgId, siteId], queryFn: () => adminApi.rules(orgId!, siteId!), enabled: !!orgId && !!siteId });
  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => adminApi.members(orgId!), enabled: !!orgId && admin });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notify-channels', orgId] });
    void qc.invalidateQueries({ queryKey: ['esc-policies', orgId] });
  };
  const toggleChannel = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => notifyApi.patchChannel(orgId!, v.id, { enabled: v.enabled }),
    onSuccess: refresh,
  });
  const togglePolicy = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => notifyApi.patchPolicy(orgId!, v.id, { enabled: v.enabled }),
    onSuccess: refresh,
  });
  const delPolicy = useMutation({ mutationFn: (id: string) => notifyApi.deletePolicy(orgId!, id), onSuccess: refresh });

  const [editor, setEditor] = useState<'new' | EscPolicy | null>(null);
  const [del, setDel] = useState<EscPolicy | null>(null);
  const err = channels.error ?? policies.error ?? teams.error ?? rules.error
    ?? toggleChannel.error ?? togglePolicy.error ?? delPolicy.error;
  const errText = err instanceof ApiError && err.status === 403 ? t('access.whyReadOnly', { role: orgRole ?? 'viewer' }) : t('inc.failed');

  const teamName = (id: string | null) => (teams.data?.teams ?? []).find((x) => x.id === id)?.name ?? '—';
  const ruleName = (id: string | null) =>
    id ? (rules.data?.items.find((r) => r.id === id)?.name ?? id.slice(0, 8)) : t('inc.policyAll');

  const membersAll = (members.data?.items ?? []).filter((m) => !m.disabled);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <PageBar icon="incidents" title={t('inc.settings')} lede={t('inc.settingsLede')} tabs={tabs}
        actions={(
          <NavLink to="/notifications/channels" className="btn btn-ghost btn-sm">
            <DdIcon name="bell" size={13} /> {t('inc.manageChannels')}
          </NavLink>
        )} />
      <PageBody className="flex-1">
        {err && <Notice tone="error">{errText}</Notice>}
        {!admin && <p className="text-[11px] text-ink-46">{t('inc.viewerNote')}</p>}

        {/* vocabulary — fixed by the backend model */}
        <Card title={t('inc.vocab')}>
          <p className="mb-3 text-[12px] text-ink-68">{t('inc.vocabBody')}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <h3 className="mb-1.5 text-[12px] font-semibold text-ink-68">{t('inc.sevLadder')}</h3>
              <Table head={[t('inc.sevLadder'), t('inc.colMeaning'), t('inc.colExpect')]}>
                {INC_SEVS.map((s) => (
                  <tr key={s}>
                    <td><SeverityBadge severity={s} /></td>
                    <td className="text-[12px] text-ink-68">{t(`inc.sevDesc.${s}`)}</td>
                    <td className="text-[12px] text-ink-68">{t(`inc.sevExpect.${s}`)}</td>
                  </tr>
                ))}
              </Table>
            </div>
            <div>
              <h3 className="mb-1.5 text-[12px] font-semibold text-ink-68">{t('inc.statusFlow')}</h3>
              <p className="mb-2 text-[12px] text-ink-46">{t('inc.statusFlowBody')}</p>
              <ol className="space-y-1.5">
                {INC_STATUSES.map((s, i) => (
                  <li key={s} className="flex items-center gap-2 text-[12px]">
                    <span className="w-24 shrink-0 font-semibold">{i + 1}. {t(`inc.status.${s}`)}</span>
                    <span className="text-ink-68">{t(`inc.statusDesc.${s}`)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-35">{t('inc.vocabFixed')}</p>
        </Card>

        {/* notification channels */}
        <Card title={t('inc.channels')}
          actions={<NavLink to="/notifications/channels" className="text-[12px] text-blue hover:underline">{t('inc.manageChannels')}</NavLink>}>
          <p className="mb-2 text-[12px] text-ink-68">{t('inc.channelsBody')}</p>
          {channels.isLoading ? <SkeletonRows rows={3} />
            : (channels.data?.items ?? []).length === 0
              ? <EmptyState title={t('inc.channelsEmpty')} body={t('inc.channelsEmptyBody')} compact icon="bell" />
              : (
                <div className="overflow-x-auto">
                  <Table head={[t('inc.colChannel'), t('inc.colType'), t('inc.colTeamBound'), t('inc.colEnabled')]}>
                    {(channels.data?.items ?? []).map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.name}</td>
                        <td className="text-ink-68">{CH_TYPE[c.type] ?? c.type}</td>
                        <td className="text-ink-68">{teamName(c.team_id)}</td>
                        <td>
                          {admin ? (
                            <Toggle on={c.enabled} label={`${c.name} — ${t('nc.enabled')}`}
                              onChange={(v) => toggleChannel.mutate({ id: c.id, enabled: v })} />
                          ) : (
                            <span className="text-[12px] text-ink-68">{t(c.enabled ? 'nc.enabled' : 'nc.disabled')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
        </Card>

        {/* escalation policies */}
        <Card title={t('esc.title')}
          actions={admin && editor === null ? (
            <button type="button" className="btn btn-sm" onClick={() => setEditor('new')}>
              <DdIcon name="plus" size={13} /> {t('esc.add')}
            </button>
          ) : undefined}>
          <p className="mb-2 text-[12px] text-ink-68">{t('esc.lede')}</p>
          {policies.isLoading ? <SkeletonRows rows={3} />
            : (policies.data?.items ?? []).length === 0 && editor === null
              ? <EmptyState title={t('esc.empty')} body={t('esc.emptyBody')} compact icon="bell" />
              : (
                <div className="overflow-x-auto">
                  <Table head={[t('esc.name'), t('esc.rule'), t('esc.levels'), t('esc.enabled'), '']}>
                    {(policies.data?.items ?? []).map((p) => (
                      <tr key={p.id}>
                        <td className="font-medium">{p.name}</td>
                        <td className="text-[12px] text-ink-68">{ruleName(p.rule_id)}</td>
                        <td className="text-[12px] text-ink-68">
                          {t('inc.levelsSummary', { count: p.levels.length })}
                          <span className="ml-2 font-mono text-[11px] text-ink-46">
                            {p.levels.map((l) => `${l.after_minutes}m`).join(' → ')}
                          </span>
                        </td>
                        <td>
                          {admin ? (
                            <Toggle on={p.enabled} label={`${p.name} — ${t('esc.enabled')}`}
                              onChange={(v) => togglePolicy.mutate({ id: p.id, enabled: v })} />
                          ) : (
                            <span className="text-[12px] text-ink-68">{t(p.enabled ? 'nc.enabled' : 'nc.disabled')}</span>
                          )}
                        </td>
                        <td className="text-right">
                          {admin && (
                            <>
                              <button type="button" className="mr-2 text-[12px] text-blue hover:underline"
                                onClick={() => setEditor(p)}>{t('common.edit')}</button>
                              <button type="button" className="text-[12px] text-[var(--color-danger)] hover:underline"
                                onClick={() => setDel(p)}>{t('esc.del')}</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
          {editor !== null && admin && orgId && (
            <PolicyForm orgId={orgId} policy={editor === 'new' ? null : editor}
              channels={(channels.data?.items ?? []).filter((c) => c.enabled)}
              rules={rules.data?.items ?? []}
              teams={teams.data?.teams ?? []}
              onSaved={() => { setEditor(null); refresh(); }}
              onClose={() => setEditor(null)} />
          )}
        </Card>

        {/* on-call */}
        <Card title={t('inc.oncall')}
          actions={<NavLink to="/teams" className="text-[12px] text-blue hover:underline">{t('inc.manageTeams')}</NavLink>}>
          <p className="text-[12px] text-ink-68">{t('inc.oncallBody')}</p>
          {teams.isLoading ? <SkeletonRows rows={3} />
            : (teams.data?.teams ?? []).length === 0
              ? <EmptyState title={t('team.empty')} compact icon="user" />
              : (teams.data?.teams ?? []).map((tm) => (
                <div key={tm.id}>
                  <p className="mt-2 text-[13px] font-semibold">{tm.name}</p>
                  <OnCallPanel orgId={orgId!} team={tm} admin={admin} all={membersAll} />
                </div>
              ))}
        </Card>
      </PageBody>

      {del && (
        <Confirm
          title={t('esc.confirmDelete', { name: del.name })}
          confirm={t('esc.del')}
          onYes={() => { delPolicy.mutate(del.id); setDel(null); }}
          onNo={() => setDel(null)} />
      )}
    </div>
  );
}

/** Policy create/edit form — mirrors backend rules: 1–10 levels, wait
 *  1–10080 min, strictly increasing; ≤20 channel/team ids per level. */
function PolicyForm({ orgId, policy, channels, rules, teams, onSaved, onClose }: {
  orgId: string; policy: EscPolicy | null;
  channels: { id: string; name: string }[];
  rules: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  onSaved: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(policy?.name ?? '');
  const [ruleId, setRuleId] = useState(policy?.rule_id ?? '');
  const [levels, setLevels] = useState<EscLevel[]>(
    policy?.levels.map((l) => ({ ...l, channel_ids: [...l.channel_ids], team_ids: [...l.team_ids] }))
      ?? [{ after_minutes: 15, channel_ids: [], team_ids: [], oncall_team: null }],
  );
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState('');

  const valid = levels.length >= 1 && levels.length <= 10
    && levels.every((l) => l.after_minutes >= 1 && l.after_minutes <= 10080)
    && levels.every((l, i) => i === 0 || l.after_minutes > levels[i - 1].after_minutes);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), rule_id: ruleId || null, levels };
      return policy
        ? notifyApi.patchPolicy(orgId, policy.id, { name: body.name, levels: body.levels })
        : notifyApi.createPolicy(orgId, body);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError && e.status === 403 ? t('inc.needOperator') : t('esc.failed')),
  });

  const setLevel = (i: number, patch: Partial<EscLevel>) =>
    setLevels((v) => v.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, 20);

  return (
    <div className="mt-3 rounded-[5px] border border-line bg-subtle p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-[12px] font-semibold text-ink-68" htmlFor="pol-name">{t('esc.name')}</label>
          <input id="pol-name" className="input mt-1 w-full" value={name} maxLength={80}
            placeholder={t('esc.namePh')} aria-invalid={tried && !name.trim()}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-ink-68" htmlFor="pol-rule">{t('esc.rule')}</label>
          <select id="pol-rule" className="input mt-1 w-full" value={ruleId}
            disabled={!!policy}
            onChange={(e) => setRuleId(e.target.value)}>
            <option value="">{t('esc.ruleDefault')}</option>
            {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>

      <p className="mt-3 text-[12px] font-semibold text-ink-68">{t('esc.levels')}</p>
      <ol className="mt-1 space-y-2">
        {levels.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border border-line bg-white p-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('esc.level', { n: i + 1 })}</span>
            <label className="text-[11px] text-ink-46" htmlFor={`lv-${i}`}>{t('esc.afterMin')}</label>
            <input id={`lv-${i}`} type="number" min={1} max={10080} className="input h-7 w-20 text-[12px]"
              value={l.after_minutes}
              onChange={(e) => setLevel(i, { after_minutes: Number(e.target.value) })} />
            <fieldset className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <legend className="sr-only">{t('esc.channels')}</legend>
              {channels.map((c) => (
                <label key={c.id} className="inline-flex items-center gap-1 text-[12px]">
                  <input type="checkbox" className="accent-blue" checked={l.channel_ids.includes(c.id)}
                    onChange={() => setLevel(i, { channel_ids: toggleId(l.channel_ids, c.id) })} />
                  {c.name}
                </label>
              ))}
              {channels.length === 0 && <span className="text-[11px] italic text-ink-46">{t('inc.channelsEmpty')}</span>}
            </fieldset>
            <label className="text-[11px] text-ink-46" htmlFor={`oc-${i}`}>{t('esc.oncallTeam')}</label>
            <select id={`oc-${i}`} className="input h-7 w-36 text-[12px]" value={l.oncall_team ?? ''}
              onChange={(e) => setLevel(i, { oncall_team: e.target.value || null })}>
              <option value="">—</option>
              {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
            <button type="button" className="ml-auto text-[var(--color-danger)]" aria-label={t('oc.remove')}
              onClick={() => setLevels((v) => v.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ol>
      {tried && !valid && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{t('esc.badLevels')}</p>}
      {err && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{err}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-ghost" disabled={levels.length >= 10}
          onClick={() => setLevels((v) => [...v, {
            after_minutes: Math.min(10080, (v[v.length - 1]?.after_minutes ?? 0) + 15),
            channel_ids: [], team_ids: [], oncall_team: null,
          }])}>
          <DdIcon name="plus" size={12} /> {t('esc.addLevel')}
        </button>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('common.close')}</button>
        <button type="button" className="btn btn-sm" disabled={save.isPending}
          onClick={() => { setTried(true); if (name.trim() && valid) save.mutate(); }}>
          {policy ? t('common.save') : t('esc.create')}
        </button>
      </div>
    </div>
  );
}
