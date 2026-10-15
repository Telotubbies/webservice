// Error Tracking — issue explorer: facet panel (left), issue list (centre),
// issue detail with hourly histogram + stack trace (right). Layout follows
// the issue-explorer anatomy studied in ref/datadog (reference only).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Icon } from '../../shared/ui/Icon';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { ISSUES, histogram, type Issue, type IssueStatus } from './errors.mock';

type FacetKey = 'service' | 'env' | 'type' | 'status';
const FACETS: FacetKey[] = ['service', 'env', 'type', 'status'];

const STATUS_STYLE: Record<IssueStatus, string> = {
  review: 'bg-[#c8485f] text-white',
  reviewed: 'bg-line text-ink-68',
  ignored: 'bg-subtle text-ink-46 border border-line',
};

/** `key:value` tokens AND together; anything else is free text. */
function matchQuery(i: Issue, q: string): boolean {
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((tok) => {
    const m = tok.match(/^(service|env|type|status):(.+)$/);
    if (m) return String(i[m[1] as FacetKey]).toLowerCase().includes(m[2]);
    return `${i.type} ${i.message} ${i.service} ${i.file}`.toLowerCase().includes(tok);
  });
}

function ago(minutes: number, t: TFunction): string {
  if (minutes < 60) return t('errtrack.agoM', { n: minutes });
  if (minutes < 60 * 48) return t('errtrack.agoH', { n: Math.round(minutes / 60) });
  return t('errtrack.agoD', { n: Math.round(minutes / 1440) });
}

export function ErrorTrackingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'issues' | 'settings'>('issues');
  const [q, setQ] = useState('');
  // unchecked values per facet; empty set = everything shown
  const [off, setOff] = useState<Record<FacetKey, Set<string>>>(
    () => ({ service: new Set(), env: new Set(), type: new Set(), status: new Set() }),
  );
  const [selId, setSelId] = useState<string>(ISSUES[0].id);

  const shown = useMemo(
    () => ISSUES.filter((i) => FACETS.every((f) => !off[f].has(String(i[f])))).filter((i) => matchQuery(i, q)),
    [off, q],
  );
  const sel = shown.find((i) => i.id === selId) ?? shown[0] ?? null;

  const counts = (f: FacetKey) => {
    const m = new Map<string, number>();
    for (const i of ISSUES) m.set(String(i[f]), (m.get(String(i[f])) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const toggle = (f: FacetKey, v: string) => setOff((o) => {
    const next = new Set(o[f]);
    if (next.has(v)) next.delete(v); else next.add(v);
    return { ...o, [f]: next };
  });
  const anyOff = FACETS.some((f) => off[f].size > 0);

  const tabBtn = (v: 'issues' | 'settings', label: string) => (
    <button
      type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
      className={`flex h-11 items-center border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
        tab === v ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
      }`}
    >{label}</button>
  );

  return (
    <div className="errors-page flex min-h-[calc(100svh-36px)] flex-col">
      {/* page header — product icon + title + tabs, settings at right */}
      <div className="sticky top-9 z-10 flex h-11 items-center gap-1 border-b border-line bg-white px-4">
        <DdIcon name="error-tracking" size={16} />
        <h1 className="mr-4 ml-1.5 text-[15px] font-semibold">{t('errtrack.title')}</h1>
        <div role="tablist" aria-label={t('errtrack.title')} className="flex">
          {tabBtn('issues', t('errtrack.tabIssues'))}
          {tabBtn('settings', t('errtrack.tabSettings'))}
        </div>
      </div>

      {tab === 'settings' ? (
        <div className="p-4"><Notice>{t('errtrack.settingsSoon')}</Notice></div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-2">
            <div className="relative flex-1">
              <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
              <input
                className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t('errtrack.queryPh')} aria-label={t('errtrack.queryLabel')}
              />
            </div>
            <span className="rounded border border-line px-2 py-1 font-mono text-[11px] text-ink-68">{t('errtrack.last24h')}</span>
          </div>
          <div className="px-4 pt-2"><Notice>{t('errtrack.mock')}</Notice></div>

          <div className="flex min-h-0 flex-1 gap-0 p-4 pt-2">
            {/* facets */}
            <aside className="w-[220px] shrink-0 overflow-y-auto border border-line bg-white" aria-label={t('errtrack.facets')}>
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-ink-46">
                <span>{t('errtrack.showing', { shown: shown.length, total: ISSUES.length })}</span>
                {anyOff && (
                  <button type="button" className="text-blue hover:underline" onClick={() => setOff({ service: new Set(), env: new Set(), type: new Set(), status: new Set() })}>
                    {t('errtrack.clearFacets')}
                  </button>
                )}
              </div>
              {FACETS.map((f) => (
                <fieldset key={f} className="border-b border-line px-3 py-2 last:border-0">
                  <legend className="mb-1 text-[12px] font-semibold text-ink">{t(`errtrack.facet.${f}`)}</legend>
                  {counts(f).map(([v, n]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12px] text-ink-68 hover:text-ink">
                      <input type="checkbox" checked={!off[f].has(v)} onChange={() => toggle(f, v)} />
                      <span className="min-w-0 flex-1 truncate">{f === 'status' ? t(`errtrack.status.${v}`) : v}</span>
                      <span className="font-mono text-[11px] text-ink-46">{n}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </aside>

            {/* issue list */}
            <section className="w-[340px] shrink-0 overflow-y-auto border-y border-r border-line bg-white" aria-label={t('errtrack.tabIssues')}>
              <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-ink-68">
                {t('errtrack.issueDetails')}
              </div>
              {shown.length === 0 ? (
                <EmptyState title={t('errtrack.empty')} body={t('errtrack.emptyBody')} icon="search" />
              ) : (
                <ul>
                  {shown.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button" onClick={() => setSelId(i.id)} aria-current={sel?.id === i.id}
                        className={`block w-full border-b border-line px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                          sel?.id === i.id ? 'bg-info-soft' : 'hover:bg-subtle'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                          <DdIcon name="error-tracking" size={12} />{i.type}
                          <span className="ml-auto font-mono text-[11px] font-normal text-ink-68">{i.count}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-68">{i.message}</span>
                        <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-46">
                          <span className="rounded bg-subtle px-1.5 font-mono text-ink-68">{i.service}</span>
                          {t('errtrack.lastSeen')} {ago(i.lastSeenM, t)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* detail */}
            <section className="min-w-0 flex-1 overflow-y-auto border-y border-r border-line bg-white" aria-label={t('errtrack.detail')}>
              {sel ? <IssueDetail issue={sel} /> : <EmptyState title={t('errtrack.select')} icon="search" />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function IssueDetail({ issue }: { issue: Issue }) {
  const { t } = useTranslation();
  const bars = histogram(issue);
  const max = Math.max(1, ...bars);
  return (
    <div className="p-4">
      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[issue.status]}`}>
        {t(`errtrack.status.${issue.status}`)}
      </span>
      <h2 className="mt-2 text-[18px] font-semibold text-ink">{issue.type}</h2>
      <p className="mt-1 text-[13px] text-ink-68">{issue.message}</p>
      <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-46">
        <span className="rounded bg-subtle px-1.5 font-mono text-ink-68">{issue.service}</span>
        <span className="rounded bg-subtle px-1.5 font-mono text-ink-68">env:{issue.env}</span>
        <span className="font-mono">{issue.id}</span>
      </p>

      <dl className="mt-4 flex gap-6 border-y border-line py-2 text-[12px]">
        <div><dt className="text-ink-46">{t('errtrack.firstSeen')}</dt><dd className="text-ink">{ago(issue.firstSeenH * 60, t)}</dd></div>
        <div><dt className="text-ink-46">{t('errtrack.lastSeen')}</dt><dd className="text-ink">{ago(issue.lastSeenM, t)}</dd></div>
      </dl>

      {/* count + hourly histogram */}
      <div className="mt-4 flex items-end gap-4">
        <div className="shrink-0">
          <div className="font-mono text-[28px] font-semibold leading-none text-ink">{issue.count}</div>
          <div className="mt-1 text-[11px] text-ink-46">{t('errtrack.occurrences')}</div>
        </div>
        <div className="flex h-16 min-w-0 flex-1 items-end gap-[2px]" role="img"
          aria-label={t('errtrack.histLabel', { count: issue.count })}>
          {bars.map((v, h) => (
            <span
              key={h}
              title={t('errtrack.histTip', { hour: 23 - h, count: v })}
              className="min-w-0 flex-1 rounded-t-[2px] bg-[#c8485f]"
              style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-end text-[10px] text-ink-46"><span>{t('errtrack.last24h')}</span></div>

      {/* stack trace */}
      <h3 className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-ink-68">{t('errtrack.stack')}</h3>
      <div className="rounded border border-[#f3c7cf] bg-[#fdf2f4] px-3 py-2 font-mono text-[12px] text-[#a3263c]">
        {issue.type}: {issue.message}
      </div>
      <ol className="mt-2 space-y-0.5 font-mono text-[12px] text-ink-68">
        {issue.stack.map((s, k) => <li key={k}>at {s}</li>)}
      </ol>
      <pre className="mt-3 overflow-x-auto rounded bg-subtle py-2 font-mono text-[12px] leading-5" aria-label={`${issue.file}:${issue.line}`}>
        {issue.code.map((c) => (
          <div key={c.n} className={`flex px-3 ${c.n === issue.line ? 'bg-[#fde5e9]' : ''}`}>
            <span className="w-10 shrink-0 select-none text-right text-ink-35">{c.n}</span>
            <span className="pl-3 whitespace-pre text-ink">{c.text}</span>
          </div>
        ))}
      </pre>
      <p className="mt-1 font-mono text-[11px] text-ink-46">{issue.file}:{issue.line}</p>
    </div>
  );
}
