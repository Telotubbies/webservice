// Notification channels — Phase 3 admin surface (roadmap §7 3.1/3.3).
// Channel list + create + send-test + delivery log on top; escalation
// policies below. Secrets are write-only: the form collects them, the API
// never returns them, and the list only shows `has_secrets`.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, teamApi } from '../../lib/api';
import { notifyApi, type ChannelType, type ChannelInput, type EscLevel, type NotifyChannel } from './api';
import { useAdminOrg, canAdmin } from '../admin/admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, EmptyState, ErrorState } from '../../shared/ui/Feedback';
import { Toggle } from '../../shared/ui/Toggle';
import { Confirm } from '../../shared/ui/Confirm';
import { Icon } from '../../shared/ui/Icon';
import './i18n';

const TYPES: ChannelType[] = ['email', 'line', 'webhook', 'teams', 'slack'];
const KIND_KEY: Record<string, string> = {
  test: 'nc.k_test', raised: 'nc.k_raised', cleared: 'nc.k_cleared',
  escalation: 'nc.k_escalation', email: 'nc.k_email', vision: 'nc.k_vision',
};
const STATUS_KEY: Record<string, string> = {
  sent: 'nc.st_sent', failed: 'nc.st_failed', retrying: 'nc.st_retrying', suppressed: 'nc.st_suppressed',
};

export function ChannelsPage() {
  const { t, i18n } = useTranslation();
  const { orgId, orgRole, loading } = useAdminOrg();
  const qc = useQueryClient();
  const admin = canAdmin(orgRole ?? 'none');
  const [del, setDel] = useState<NotifyChannel | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, 'ok' | 'fail'>>({});
  const [err, setErr] = useState('');

  const channels = useQuery({
    queryKey: ['notify-channels', orgId],
    queryFn: () => notifyApi.channels(orgId!),
    enabled: !!orgId,
  });
  const deliveries = useQuery({
    queryKey: ['notify-deliveries', orgId],
    queryFn: () => notifyApi.deliveries(orgId!),
    enabled: !!orgId,
  });
  const teams = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => teamApi.list(orgId!),
    enabled: !!orgId,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notify-channels', orgId] });
    void qc.invalidateQueries({ queryKey: ['notify-deliveries', orgId] });
  };

  const toggle = useMutation({
    mutationFn: (c: NotifyChannel) => notifyApi.patchChannel(orgId!, c.id, { enabled: !c.enabled }),
    onSuccess: refresh,
    onError: () => setErr(t('nc.failed')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => notifyApi.deleteChannel(orgId!, id),
    onSuccess: refresh,
    onError: () => setErr(t('nc.failed')),
  });
  const test = useMutation({
    mutationFn: (id: string) => notifyApi.testChannel(orgId!, id),
    onSuccess: (_r, id) => { setTestMsg((m) => ({ ...m, [id]: 'ok' })); refresh(); },
    onError: (_e, id) => setTestMsg((m) => ({ ...m, [id]: 'fail' })),
  });

  if (loading) return <><PageBar title={t('nc.title')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nc.title')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const items = channels.data?.items ?? [];
  const teamName = (id: string | null) => teams.data?.teams.find((x) => x.id === id)?.name;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <PageBar title={t('nc.title')} lede={t('nc.lede')} />
      {!admin && <div className="px-4 pt-3"><Notice tone="info" icon="lock">{t('access.whyReadOnly', { role: t(`roles.${orgRole ?? 'none'}`, { defaultValue: orgRole ?? '' }) })}</Notice></div>}
      {err && <div className="px-4 pt-3"><Notice tone="error">{err}</Notice></div>}
      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {admin && <ChannelForm orgId={orgId} teams={teams.data?.teams ?? []} onDone={refresh} />}
          <Card pad={false}>
            {channels.isError ? <ErrorState onRetry={() => void channels.refetch()} />
              : items.length === 0 ? <EmptyState title={t('nc.empty')} body={t('nc.emptyBody')} icon="bell" />
              : (
                <ul>
                  {items.map((c) => (
                    <li key={c.id} className="border-b border-line px-4 py-3 last:border-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.name}</span>
                        <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-ink-68">{c.type}</span>
                        {teamName(c.team_id) && <span className="text-[11px] text-ink-46">{teamName(c.team_id)}</span>}
                        {admin && <Toggle on={c.enabled} label={`${t('nc.enabled')} ${c.name}`} onChange={() => toggle.mutate(c)} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-46">
                        {c.has_secrets && <span className="flex items-center gap-1"><Icon name="lock" size={11} />{t('nc.hasSecrets')}</span>}
                        {admin && (
                          <>
                            <button type="button" className="rounded text-blue hover:underline"
                              onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                              {t('nc.test')}
                            </button>
                            {testMsg[c.id] && (
                              <span role="status" className={testMsg[c.id] === 'ok' ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}>
                                {t(testMsg[c.id] === 'ok' ? 'nc.testOk' : 'nc.testFail')}
                              </span>
                            )}
                            <button type="button" className="rounded text-[var(--color-danger)] hover:underline"
                              onClick={() => setDel(c)}>{t('nc.del')}</button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={t('nc.deliveries')} pad={false}>
            {deliveries.isError ? <ErrorState onRetry={() => void deliveries.refetch()} />
              : (deliveries.data?.items ?? []).length === 0 ? <EmptyState title={t('nc.delEmpty')} compact />
              : (
                <div className="overflow-x-auto">
                  <Table head={[t('nc.colWhen'), t('nc.colChannel'), t('nc.colKind'), t('nc.colTarget'), t('nc.colStatus'), t('nc.colAttempts')]}>
                    {(deliveries.data?.items ?? []).map((d) => (
                      <tr key={d.id}>
                        <td className="whitespace-nowrap font-mono text-[11px] text-ink-68">
                          {new Date(d.at).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                        </td>
                        <td className="max-w-32 truncate text-[12px]">{d.channel ?? '—'}</td>
                        <td className="text-[12px]">{t(KIND_KEY[d.kind] ?? 'nc.k_test')}</td>
                        <td className="max-w-40 truncate font-mono text-[11px] text-ink-68">{d.target || '—'}</td>
                        <td>
                          <span className={`text-[12px] font-semibold ${d.status === 'sent' ? 'text-[var(--color-ok)]' : d.status === 'failed' ? 'text-[var(--color-danger)]' : 'text-ink-68'}`}>
                            {t(STATUS_KEY[d.status] ?? 'nc.st_failed')}
                          </span>
                        </td>
                        <td className="font-mono text-[12px] tabular-nums">{d.attempts}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
          </Card>
          <EscalationSection orgId={orgId} admin={admin} />
        </div>
      </div>
      {del && (
        <Confirm
          title={t('nc.del')}
          body={t('nc.confirmDelete', { name: del.name })}
          confirm={t('nc.del')}
          onNo={() => setDel(null)}
          onYes={() => { const c = del; setDel(null); remove.mutate(c.id); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form — per-type fields; secrets go into `secrets`, never `config`.
// ---------------------------------------------------------------------------
function ChannelForm({ orgId, teams, onDone }: {
  orgId: string; teams: { id: string; name: string }[]; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('email');
  const [teamId, setTeamId] = useState('');
  const [to, setTo] = useState('');
  const [lineTo, setLineTo] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [err, setErr] = useState('');

  const create = useMutation({
    mutationFn: (b: ChannelInput) => notifyApi.createChannel(orgId, b),
    onSuccess: () => { onDone(); setOpen(false); setName(''); setErr(''); },
    onError: (e) => setErr(e instanceof ApiError && e.status === 409 ? t('nc.dup') : t('nc.failed')),
  });

  const submit = () => {
    const config: Record<string, unknown> = {};
    const secrets: Record<string, unknown> = {};
    if (type === 'email') {
      config.to = to.split(',').map((s) => s.trim()).filter(Boolean);
      if (smtpHost.trim()) {
        config.smtp = {
          host: smtpHost.trim(),
          port: Number(smtpPort) || 587,
          user: smtpUser.trim(), from: smtpFrom.trim(), tls: true,
        };
        if (smtpPass) secrets.smtp_pass = smtpPass;
      }
    } else if (type === 'line') {
      config.to = lineTo.trim();
      secrets.token = secret.trim();
    } else {
      secrets.url = url.trim();
      if (type === 'webhook' && secret.trim()) secrets.secret = secret.trim();
    }
    create.mutate({ name: name.trim(), type, team_id: teamId || null, config, secrets });
  };

  if (!open) {
    return <button type="button" className="btn" onClick={() => setOpen(true)}>+ {t('nc.add')}</button>;
  }
  return (
    <Card title={t('nc.add')}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <label className="field-label" htmlFor="nc-name">{t('nc.name')}</label>
          <input id="nc-name" className="input h-8" value={name} maxLength={120} required
            placeholder={t('nc.namePh')} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="nc-type">{t('nc.type')}</label>
          <select id="nc-type" className="input h-8" value={type} onChange={(e) => setType(e.target.value as ChannelType)}>
            {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="nc-team">{t('nc.teamBind')}</label>
          <select id="nc-team" className="input h-8" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">{t('nc.teamNone')}</option>
            {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        {type === 'email' && (
          <div className="field sm:col-span-2">
            <label className="field-label" htmlFor="nc-to">{t('nc.to')}</label>
            <input id="nc-to" className="input h-8" value={to} required placeholder={t('nc.toPh')}
              onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        {type === 'line' && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="nc-lineto">{t('nc.lineTo')}</label>
              <input id="nc-lineto" className="input h-8" value={lineTo} required onChange={(e) => setLineTo(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="nc-secret">{t('nc.secret')}</label>
              <input id="nc-secret" type="password" autoComplete="off" className="input h-8" value={secret} required onChange={(e) => setSecret(e.target.value)} />
            </div>
          </>
        )}
        {(type === 'webhook' || type === 'teams' || type === 'slack') && (
          <>
            <div className="field sm:col-span-2">
              <label className="field-label" htmlFor="nc-url">{t('nc.url')}</label>
              <input id="nc-url" className="input h-8" value={url} required placeholder="https://…"
                onChange={(e) => setUrl(e.target.value)} />
              <span className="text-[11px] text-ink-46">{t('nc.urlHint')}</span>
            </div>
            {type === 'webhook' && (
              <div className="field sm:col-span-2">
                <label className="field-label" htmlFor="nc-secret">{t('nc.secret')}</label>
                <input id="nc-secret" type="password" autoComplete="off" className="input h-8" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </div>
            )}
          </>
        )}
        {type === 'email' && (
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-[12px] font-medium text-ink-68">{t('nc.smtp')}</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div className="field"><label className="field-label" htmlFor="nc-sh">{t('nc.smtpHost')}</label>
                <input id="nc-sh" className="input h-8" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></div>
              <div className="field"><label className="field-label" htmlFor="nc-sp">{t('nc.smtpPort')}</label>
                <input id="nc-sp" type="number" className="input num h-8" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></div>
              <div className="field"><label className="field-label" htmlFor="nc-su">{t('nc.smtpUser')}</label>
                <input id="nc-su" className="input h-8" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} /></div>
              <div className="field"><label className="field-label" htmlFor="nc-sf">{t('nc.smtpFrom')}</label>
                <input id="nc-sf" className="input h-8" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} /></div>
              <div className="field sm:col-span-2"><label className="field-label" htmlFor="nc-smtp-pass">{t('nc.smtpPass')}</label>
                <input id="nc-smtp-pass" type="password" autoComplete="new-password" className="input h-8" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} /></div>
            </div>
          </details>
        )}
        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-sm" disabled={create.isPending || !name.trim()}>
            {create.isPending ? t('nc.creating') : t('nc.create')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>{t('control.cancel')}</button>
          {err && <span className="text-[12px] text-[var(--color-danger)]" role="alert">{err}</span>}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Escalation policies — levels editor; channel/team pickers from the same
// queries as the channel list.
// ---------------------------------------------------------------------------
function EscalationSection({ orgId, admin }: { orgId: string; admin: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const policies = useQuery({
    queryKey: ['esc-policies', orgId],
    queryFn: () => notifyApi.policies(orgId),
  });
  const [del, setDel] = useState<string | null>(null);
  const delName = (policies.data?.items ?? []).find((p) => p.id === del)?.name ?? '';
  const refresh = () => void qc.invalidateQueries({ queryKey: ['esc-policies', orgId] });
  const remove = useMutation({
    mutationFn: (id: string) => notifyApi.deletePolicy(orgId, id), onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) => notifyApi.patchPolicy(orgId, p.id, { enabled: !p.enabled }),
    onSuccess: refresh,
  });

  const items = policies.data?.items ?? [];
  return (
    <Card title={t('esc.title')} pad={false}>
      <p className="border-b border-line px-4 py-2 text-[12px] text-ink-68">{t('esc.lede')}</p>
      {items.length === 0 ? (
        <EmptyState title={t('esc.empty')} body={admin ? t('esc.emptyBody') : undefined} compact />
      ) : (
        <ul>
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-0">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.name}</span>
              <span className="text-[11px] text-ink-46">
                {p.levels.map((l) => t('esc.after', { n: l.after_minutes })).join(' → ')}
              </span>
              {admin && <Toggle on={p.enabled} label={`${t('esc.enabled')} ${p.name}`} onChange={() => toggle.mutate(p)} />}
              {admin && <button type="button" className="text-[12px] text-[var(--color-danger)] hover:underline" onClick={() => setDel(p.id)}>{t('esc.del')}</button>}
            </li>
          ))}
        </ul>
      )}
      {admin && <PolicyForm orgId={orgId} onDone={refresh} />}
      {del && (
        <Confirm title={t('esc.del')} body={t('esc.confirmDelete', { name: delName })} confirm={t('esc.del')}
          onNo={() => setDel(null)} onYes={() => { const id = del; setDel(null); remove.mutate(id); }} />
      )}
    </Card>
  );
}

function PolicyForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [levels, setLevels] = useState<EscLevel[]>([
    { after_minutes: 15, channel_ids: [], team_ids: [], oncall_team: null },
  ]);
  const [err, setErr] = useState('');
  const channels = useQuery({ queryKey: ['notify-channels', orgId], queryFn: () => notifyApi.channels(orgId) });
  const teams = useQuery({ queryKey: ['teams', orgId], queryFn: () => teamApi.list(orgId) });

  const create = useMutation({
    mutationFn: () => notifyApi.createPolicy(orgId, { name: name.trim(), levels, enabled: true }),
    onSuccess: () => { onDone(); setOpen(false); setName(''); },
    onError: () => setErr(t('esc.failed')),
  });

  const valid = useMemo(() => {
    let prev = 0;
    for (const l of levels) {
      if (!(l.after_minutes > prev && l.after_minutes <= 10080)) return false;
      prev = l.after_minutes;
    }
    return levels.length >= 1;
  }, [levels]);

  const setLv = (i: number, patch: Partial<EscLevel>) =>
    setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const flip = (i: number, key: 'channel_ids' | 'team_ids', id: string) =>
    setLv(i, { [key]: levels[i][key].includes(id) ? levels[i][key].filter((x) => x !== id) : [...levels[i][key], id] });

  if (!open) return <div className="px-4 py-3"><button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>+ {t('esc.add')}</button></div>;
  return (
    <form className="space-y-3 border-t border-line px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); else setErr(t('esc.badLevels')); }}>
      <div className="field max-w-xs">
        <label className="field-label" htmlFor="esc-name">{t('esc.name')}</label>
        <input id="esc-name" className="input h-8" value={name} required maxLength={120} placeholder={t('esc.namePh')} onChange={(e) => setName(e.target.value)} />
      </div>
      {levels.map((l, i) => (
        <fieldset key={i} className="rounded border border-line p-2">
          <legend className="px-1 text-[11px] font-semibold text-ink-46">{t('esc.level', { n: i + 1 })}</legend>
          <div className="mb-2 flex items-center gap-2">
            <label className="text-[12px] text-ink-68" htmlFor={`esc-mins-${i}`}>{t('esc.afterMin')}</label>
            <input id={`esc-mins-${i}`} type="number" min={1} max={10080} className="input num h-7 w-24" value={l.after_minutes}
              onChange={(e) => setLv(i, { after_minutes: Number(e.target.value) })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold text-ink-46">{t('esc.channels')}</p>
              {(channels.data?.items ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 py-0.5 text-[12px]">
                  <input type="checkbox" checked={l.channel_ids.includes(c.id)} onChange={() => flip(i, 'channel_ids', c.id)} /> {c.name}
                </label>
              ))}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-ink-46">{t('esc.teams')}</p>
              {(teams.data?.teams ?? []).map((tm) => (
                <label key={tm.id} className="flex items-center gap-1.5 py-0.5 text-[12px]">
                  <input type="checkbox" checked={l.team_ids.includes(tm.id)} onChange={() => flip(i, 'team_ids', tm.id)} /> {tm.name}
                </label>
              ))}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-ink-46">{t('esc.oncallTeam')}</p>
              <select className="input h-7 w-full text-[12px]" value={l.oncall_team ?? ''}
                onChange={(e) => setLv(i, { oncall_team: e.target.value || null })}>
                <option value="">—</option>
                {(teams.data?.teams ?? []).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </select>
            </div>
          </div>
          {levels.length > 1 && (
            <button type="button" className="mt-1 text-[11px] text-[var(--color-danger)] hover:underline"
              onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}>{t('esc.del')}</button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn-sm btn-ghost"
        onClick={() => setLevels((ls) => [...ls, { after_minutes: (ls[ls.length - 1]?.after_minutes ?? 15) + 30, channel_ids: [], team_ids: [], oncall_team: null }])}>
        + {t('esc.addLevel')}
      </button>
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-sm" disabled={create.isPending || !name.trim() || !valid}>{t('esc.create')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>{t('control.cancel')}</button>
        {err && <span className="text-[12px] text-[var(--color-danger)]" role="alert">{err}</span>}
      </div>
    </form>
  );
}
