// Security › API protection (dd "App & API Protection › Policies › Business
// Logic"): the sensitive API events the plant records, each with its 7-day
// volume and the actors raising it. Events are the org audit log's distinct
// `entity.verb` actions — nothing is hard-coded, so a new audited action
// appears here on its own. A second tab lists the API clients (keys) that
// can raise them.

import { useMemo, useState } from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useNow } from '../../lib/hooks';
import { PageBar } from '../../shared/ui/Page';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { DdIcon } from '../../shared/ui/DdIcon';
import { usePosture } from './posture';
import { useSecurityTabs } from './ui';
import './i18n';

const WEEK = 7 * 86_400_000;
const ACCOUNT = /^(auth|session|member|invite|api_key|edge|org|user)\b/;
const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');

interface EventRow { action: string; count: number; actors: string[]; last: string }

function Section({ title, body, list, describe }: { title: string; body: string; list: EventRow[]; describe: (a: string) => string }) {
  const { t } = useTranslation();
  return (
    <section>
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="mb-2 text-[13px] text-ink-68">{body}</p>
      <div className="overflow-x-auto rounded-[5px] border border-line bg-white shadow-card">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left">
              {['colEvent', 'colDescription', 'colRequests', 'colActors', 'colRules'].map((c) => <th key={c} scope="col" className="overline h-8 px-3">{t(`sec.${c}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="h-10 px-3 text-ink-46">{t('sec.noData')}</td></tr>}
            {list.map((r) => (
              <tr key={r.action} className="h-10 border-b border-line last:border-0 hover:bg-info-soft">
                <td className="px-3">
                  <NavLink to={`/admin/audit?action=${encodeURIComponent(r.action)}`} className="inline-flex items-center gap-1.5 rounded bg-[#efe6fb] px-1.5 py-0.5 font-mono text-[13px] text-[#5b2f9e] hover:underline focus-visible:outline-2 focus-visible:outline-blue">
                    <DdIcon name="signpost" size={12} />{r.action}
                  </NavLink>
                </td>
                <td className="px-3">{describe(r.action)}</td>
                <td className="px-3 font-mono tabular-nums text-blue">{r.count.toLocaleString()}</td>
                <td className="px-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[12px]">{r.actors[0]}</span>
                    {r.actors.length > 1 && <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[12px]">+{r.actors.length - 1}</span>}
                  </span>
                </td>
                <td className="px-3 text-ink-68">{t('sec.noRule')} <NavLink to="/admin/rules/new" className="text-blue hover:underline">{t('sec.createRule')}</NavLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ApiProtectionPage() {
  const { t } = useTranslation();
  const tabs = useSecurityTabs();
  const p = usePosture();
  const [tab, setTab] = useState<'events' | 'clients'>('events');

  const now = useNow(60_000);
  const rows = useMemo(() => {
    const m = new Map<string, EventRow>();
    for (const a of p.audit) {
      if (now - Date.parse(a.at) > WEEK) continue;
      const r = m.get(a.action) ?? { action: a.action, count: 0, actors: [], last: a.at };
      r.count += 1;
      if (!r.actors.includes(a.actor)) r.actors.push(a.actor);
      if (a.at > r.last) r.last = a.at;
      m.set(a.action, r);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [p.audit, now]);

  const account = rows.filter((r) => ACCOUNT.test(r.action));
  const plant = rows.filter((r) => !ACCOUNT.test(r.action));
  const describe = (action: string) => {
    const [entity, ...verb] = action.split('.');
    return t(`sec.evt.${action}`, { defaultValue: t('sec.evtGeneric', { entity: entity.replace(/_/g, ' '), verb: verb.join(' ').replace(/_/g, ' ') }) });
  };

  return (
    <>
      <PageBar icon="security-monitoring" title={t('sec.apiTitle')} tabs={tabs} />
      <div role="tablist" aria-label={t('sec.apiTitle')} className="flex h-11 border-b border-line bg-paper px-4">
        {([['events', 'sec.apiBlTab'], ['clients', 'sec.apiAccessTab']] as const).map(([v, k]) => (
          <button
            key={v} type="button" role="tab" aria-selected={tab === v}
            className={`flex items-center border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${tab === v ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'}`}
            onClick={() => setTab(v)}
          >{t(k)}</button>
        ))}
      </div>
      <div className="space-y-5 p-4">
        <p className="text-[13px] text-ink-68">{t('sec.apiLede')}</p>
        {!p.admin ? <Notice>{t('sec.needAdmin')}</Notice> : p.loading ? <SkeletonRows rows={6} h={40} /> : tab === 'events' ? (
          <>
            <div className="rounded border border-[#b9d6ec] bg-[#eaf4fb] p-4">
              <p className="text-[16px] font-semibold text-blue">{t('sec.apiBanner')}</p>
              <p className="mt-1 text-[13px]">{t('sec.apiBannerBody')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <NavLink to="/admin/audit" className="btn">{t('sec.apiBannerCta')}</NavLink>
                <NavLink to="/admin/rules/new" className="btn btn-ghost">{t('sec.apiBannerCta2')}</NavLink>
              </div>
            </div>
            <Section title={t('sec.acctTitle')} body={t('sec.acctBody')} list={account} describe={describe} />
            <Section title={t('sec.opsTitle')} body={t('sec.opsBody')} list={plant} describe={describe} />
          </>
        ) : p.keys.length === 0 ? <EmptyState title={t('sec.noKeys')} icon="search" /> : (
          <div className="overflow-x-auto rounded-[5px] border border-line bg-white shadow-card">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">{['colName', 'colPrefix', 'colRole', 'colLastUsed', 'colExpires', 'colState'].map((c) => <th key={c} scope="col" className="overline h-8 px-3">{t(`sec.${c}`)}</th>)}</tr>
              </thead>
              <tbody>
                {p.keys.map((k) => (
                  <tr key={k.id} className="h-10 border-b border-line last:border-0">
                    <td className="px-3 font-semibold">{k.name}</td>
                    <td className="px-3 font-mono text-[12px] text-ink-68">{k.prefix}…</td>
                    <td className="px-3">{t(`roles.${k.role}`, { defaultValue: k.role })}</td>
                    <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(k.last_used_at)}</td>
                    <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(k.expires_at)}</td>
                    <td className="px-3 text-[12px]">{k.revoked_at ? t('sec.revoked') : t('sec.active')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
