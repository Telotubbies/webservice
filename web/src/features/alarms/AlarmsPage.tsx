// Alarms — dd-pattern list: omnibar filter (key:value tokens via
// matchAlarmQuery), state tabs, dense table, ack action gated by role.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS } from '../../lib/plant';
import { fmtAge, fmtDuration } from '../../lib/format';
import { canAdmin, canOperate, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { matchAlarmQuery, useAlarms, alarmStateKey, bucketAlarms, GROUP_BY, type GroupBy } from './alarms';
import { AlarmDensity, type Bucket } from './AlarmDensity';
import { SeverityBadge, AlarmStateBadge } from '../../shared/ui/Status';
import { Card, Table } from '../../shared/ui/Page';
import { Notice } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { DdIcon } from '../../shared/ui/DdIcon';
import type { Alarm } from '../../types';

type StateFilter = 'active' | 'acked' | 'cleared' | 'all';

function AckButton({ alarm }: { alarm: Alarm }) {
  const { t } = useTranslation();
  const role = useRole();
  const [err, setErr] = useState('');
  if (alarm.state !== 'active') return null;
  if (!canOperate(role)) {
    return <span className="text-[11px] text-ink-46">{t('alarms.signInToAck')}</span>;
  }
  return (
    <span className="flex items-center gap-1">
      <button
        className="btn btn-sm btn-ghost"
        onClick={() => {
          void api.ackAlarm(alarm.id)
            .then(() => live.upsertAlarm({ ...alarm, state: 'acked' }))
            .catch((e) => setErr(String((e as Error).message ?? e)));
        }}
      >
        <Icon name="check" size={13} /> {t('alarms.ack')}
      </button>
      {err && <span className="text-[11px] text-[var(--color-danger)]" role="alert">{err}</span>}
    </span>
  );
}

export function AlarmsPage() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { all } = useAlarms();
  useStore(() => live.seedRev);
  const seeded = live.alarmsSeeded;
  const seedError = live.seedError;
  const [q, setQ] = useState('');
  const [state, setState] = useState<StateFilter>('active');
  const [win, setWin] = useState<Bucket | null>(null);

  const signalLabel = (tag: string) => {
    const meta = SIGNALS[tag];
    return meta ? t(meta.labelKey) : tag;
  };

  const rows = useMemo(() => {
    return all
      .filter((a) => state === 'all' || a.state === state)
      .filter((a) => !win || (Date.parse(a.ts) >= win.from && Date.parse(a.ts) < win.to))
      .filter((a) => matchAlarmQuery(a, q, signalLabel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, state, q, win, i18n.language]);

  const role = useRole();
  // "New rule" links into the admin surface, which gates on the per-org role
  // (v4 T14) — the shim-org useRole() would wrongly hide it from an admin of
  // a non-shim org.
  const { orgRole } = useAdminOrg();
  const operable = canOperate(role);
  const navigate = useNavigate();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [bulkErr, setBulkErr] = useState('');

  const toggleGroup = (k: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // selection pruned to visible rows — a filter change must not leave the
  // "N selected" count or the ack targets pointing at hidden alarms
  const selRows = rows.filter((a) => sel.has(String(a.id)));
  const ackable = selRows.filter((a) => a.state === 'active');

  const bulkAck = () => {
    void Promise.all(ackable.map((a) =>
      api.ackAlarm(a.id).then(() => live.upsertAlarm({ ...a, state: 'acked' })),
    )).then(() => setSel(new Set()))
      .catch((e) => setBulkErr(String((e as Error).message ?? e)));
  };

  // F03 flood grouping — `?group=state|rule|eq`, deep-linkable, default state
  const [params, setParams] = useSearchParams();
  const groupParam = params.get('group') as GroupBy | null;
  const groupBy: GroupBy = groupParam && GROUP_BY.includes(groupParam) ? groupParam : 'state';
  const setGroupBy = (g: GroupBy) => setParams((p) => { const n = new URLSearchParams(p); n.set('group', g); return n; }, { replace: true });
  const buckets = useMemo(() => bucketAlarms(rows, groupBy), [rows, groupBy]);

  // F04 permalink — `?alarm=<id>` highlights and scrolls to that row; if the
  // current filters hide it, say so instead of silently showing nothing.
  const focusId = params.get('alarm');
  const focusVisible = !!focusId && rows.some((a) => String(a.id) === focusId);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!focusVisible) return;
    document.querySelector(`[data-alarm-id="${CSS.escape(focusId!)}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusId, focusVisible]);
  const copyLink = (id: string) => {
    const url = `${window.location.origin}/alarms?alarm=${encodeURIComponent(id)}`;
    void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const tab = (v: StateFilter, label: string, count?: number) => (
    <button
      key={v}
      role="tab"
      aria-selected={state === v}
      onClick={() => setState(v)}
      data-active={state === v}
      className={`flex h-11 items-center gap-1.5 border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
        state === v ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
      }`}
    >
      {label}
      {count != null && <span className="rounded-full bg-line px-1.5 text-[11px] font-semibold text-ink-68">{count}</span>}
    </button>
  );

  return (
    <>
      <div className="sticky top-9 z-10 border-b border-line bg-white/90 backdrop-blur">
        <div className="flex h-11 items-center gap-2 px-4">
          <h1 className="text-[15px] font-semibold">{t('alarms.title')}</h1>
          <span className="text-[12px] text-ink-46">{t('alarms.lede')}</span>
          <span className="flex-1" />
          {canAdmin(orgRole ?? 'none') && (
            <NavLink to="/admin/rules/new" className="flex h-7 items-center gap-1 rounded bg-blue px-2.5 text-[13px] text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
              <DdIcon name="plus" size={12} /> {t('admin.addRule')}
            </NavLink>
          )}
        </div>
        <div className="flex px-4" role="tablist" aria-label={t('alarms.colState')}>
          {tab('active', t('alarms.active'), all.filter((a) => a.state === 'active').length)}
          {tab('acked', t('alarms.acked'))}
          {tab('cleared', t('alarms.cleared'))}
          {tab('all', t('alarms.all'))}
        </div>
        {/* full-width omnibar row — dd monitors pattern */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
            <input
              className="input w-full pl-7"
              placeholder={t('alarms.searchPh')}
              aria-label={t('alarms.searchLabel')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* bulk mode bar — dd monitors pattern: always visible, disabled until selection */}
      {operable && rows.length > 0 && (
        <div className="flex h-9 items-center gap-3 border-b border-line bg-subtle px-4 text-[12px]">
          <span className="font-semibold text-ink-68">{t('alarms.selected', { count: selRows.length })}</span>
          <button className="btn btn-sm btn-ghost" disabled={ackable.length === 0} onClick={bulkAck}>{t('alarms.ack')}</button>
          <button className="text-ink-68 hover:text-ink disabled:opacity-40" disabled={sel.size === 0} onClick={() => setSel(new Set())}>{t('common.clear')}</button>
          {bulkErr && <span className="text-[var(--color-danger)]" role="alert">{bulkErr}</span>}
        </div>
      )}

      <div className="p-4">
        {seeded && <AlarmDensity alarms={all} now={now} picked={win} onPick={setWin} />}
        {seeded && rows.length > 0 && (
          <div className="mb-3 flex items-center gap-2 text-[12px] text-ink-68">
            <span>{t('alarms.groupBy')}</span>
            <Segmented<GroupBy>
              label={t('alarms.groupBy')}
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'state', label: t('alarms.groupState') },
                { value: 'rule', label: t('alarms.groupRule') },
                { value: 'eq', label: t('alarms.groupEq') },
              ]}
            />
          </div>
        )}
        {seedError && !seeded ? (
          <ErrorState onRetry={() => window.location.reload()} />
        ) : !seeded ? (
          <Card pad={false}>
            <div className="space-y-2 p-3">
              {[28, 20, 28, 20].map((h, i) => <Skeleton key={i} h={h} />)}
            </div>
          </Card>
        ) : (
          <>
            {focusId && !focusVisible && seeded && (
              <div className="mb-3"><Notice tone="info">{t('alarms.filteredOut')}</Notice></div>
            )}
            <Card pad={false}>
              {rows.length === 0 ? (
                <EmptyState
                  title={state === 'active' && !q ? t('alarms.emptyActive') : t('alarms.empty')}
                  body={state === 'active' && !q ? t('alarms.emptyActiveBody') : t('alarms.emptyFilteredBody')}
                />
              ) : (
                <Table head={[
                  operable ? (
                    // TODO i18n: add 'alarms.selectAll' (en 'Select all alarms' / th)
                    <input
                      key="selall"
                      type="checkbox"
                      aria-label={t('alarms.selectAll', { defaultValue: 'Select all alarms' })}
                      checked={rows.length > 0 && selRows.length === rows.length}
                      onChange={() => setSel(
                        selRows.length === rows.length ? new Set() : new Set(rows.map((a) => String(a.id))),
                      )}
                    />
                  ) : null,
                  t('alarms.colSeverity'), t('alarms.colAlarm'), t('alarms.colRaised'),
                  t('alarms.colDuration'), t('alarms.colState'), t('alarms.colAction'),
                ].filter((h) => h !== null)}>
                  {buckets.map((b) => (
                    <Fragment key={b.key}>
                      {/* group header row — dd monitor-pack pattern; colour + glyph + text */}
                      <tr className="bg-subtle">
                        <td colSpan={operable ? 7 : 6} className="p-0">
                          <button
                            type="button"
                            className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-1 text-left text-[12px] font-semibold text-ink-68 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                            aria-expanded={!collapsed.has(b.key)}
                            onClick={() => toggleGroup(b.key)}
                          >
                            <span className="text-ink-46" aria-hidden>{collapsed.has(b.key) ? '▶' : '⌄'}</span>
                            <span className="text-ink">{b.labelKey ? t(b.labelKey) : b.label}</span>
                            <SeverityBadge severity={b.worst} />
                            <span className="rounded-full bg-line px-1.5 text-[10px] font-semibold text-ink-68">{b.alarms.length}</span>
                            {groupBy !== 'state' && b.oldest && (
                              <span className="font-mono text-[11px] font-normal text-ink-46">
                                {t('alarms.groupSpan', { dur: fmtDuration(b.oldest, Date.parse(b.newest) || now) })}
                              </span>
                            )}
                          </button>
                        </td>
                      </tr>
                      {!collapsed.has(b.key) && b.alarms.map((a) => (
                        <tr
                          key={a.id}
                          data-alarm-id={String(a.id)}
                          className={`cursor-pointer focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${String(a.id) === focusId ? 'bg-info-soft' : ''}`}
                          tabIndex={0}
                          onClick={() => navigate(`/alarms/${a.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/alarms/${a.id}`); }
                          }}
                        >
                          {operable && (
                            /* stopPropagation on keydown too — else the row's
                               Enter/Space->navigate handler swallows the press */
                            <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={sel.has(String(a.id))} onChange={() => toggle(String(a.id))} aria-label={t('alarms.select', { name: a.rule })} />
                            </td>
                          )}
                          <td><SeverityBadge severity={a.severity} /></td>
                          <td>
                            <span className="font-medium">{a.rule}</span>
                            <span className="ml-2 font-mono text-[11px] text-ink-46">{a.tag}</span>
                            <button
                              type="button"
                              className="ml-2 text-[11px] text-blue underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                              onClick={(e) => { e.stopPropagation(); copyLink(String(a.id)); }}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {copied && focusId === String(a.id) ? t('alarms.linkCopied') : t('alarms.copyLink')}
                            </button>
                          </td>
                          <td className="text-[12px] text-ink-68">{fmtAge(a.ts, now)}</td>
                          <td className="font-mono text-[12px]">{fmtDuration(a.ts, now)}</td>
                          <td><AlarmStateBadge state={a.state} ackedBy={a.acked_by} /></td>
                          <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><AckButton alarm={a} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Table>
              )}
            </Card>
            <p className="mt-2 text-[11px] text-ink-46">{t('alarms.shown', { count: rows.length })}</p>
          </>
        )}
      </div>
    </>
  );
}

export { alarmStateKey };
