// Alarms — dd-pattern list: omnibar filter (key:value tokens via
// matchAlarmQuery), state tabs, dense table, ack action gated by role.

import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useNavigate, useSearchParams } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS } from '../../lib/plant';
import { fmtAge, fmtDuration } from '../../lib/format';
import { canAdmin, canOperate, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { matchAlarmQuery, useAlarms, alarmStateKey, bucketAlarms, GROUP_BY, type GroupBy } from './alarms';
import { AlarmDensity, type Bucket } from './AlarmDensity';
import { ackAlarm, ackMany, errText } from './ackAlarm';
import './i18n';
import { SeverityBadge, AlarmStateBadge, QualityMark, normSeverity } from '../../shared/ui/Status';
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
  const [busy, setBusy] = useState(false);
  // viewers get one "view only" note in the toolbar, not a line per row
  if (alarm.state !== 'active' || !canOperate(role)) return null;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        className="btn btn-sm btn-ack whitespace-nowrap"
        disabled={busy}
        aria-label={`${t('alarms.ack')}: ${alarm.rule}`}
        onClick={() => {
          setBusy(true);
          setErr('');
          ackAlarm(alarm)
            .catch((e) => setErr(t('alx.ackFailed', { reason: errText(e, t) })))
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="check" size={13} /> {busy ? t('alx.ackBusy') : t('alarms.ack')}
      </button>
      {err && <span className="max-w-48 text-[11px] text-[var(--color-danger)]" role="alert">{err}</span>}
    </span>
  );
}

/** State badge + who/when, in text — ownership readable without hovering. */
function StateCell({ alarm, now }: { alarm: Alarm; now: number }) {
  const { t } = useTranslation();
  const s = alarm.state;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <AlarmStateBadge state={s} ackedBy={alarm.acked_by} />
      {s === 'acked' && (
        <span className="alarm-acked-label text-[11px] text-ink-68">
          {alarm.acked_by
            ? alarm.acked_at
              ? t('alx.ackedWhoWhen', { who: alarm.acked_by, age: fmtAge(alarm.acked_at, now) })
              : t('alx.ackedWho', { who: alarm.acked_by })
            : t('alx.ackedUnknownWho')}
        </span>
      )}
      {s === 'cleared' && (
        <span className="alarm-cleared-label text-[11px] text-ink-46">
          {alarm.acked_by ? t('alx.ackedWho', { who: alarm.acked_by }) : alarm.cleared_at ? fmtAge(alarm.cleared_at, now) : ''}
        </span>
      )}
    </span>
  );
}

/** Live value of the alarm's signal — stale / bad quality look different. */
function ValueCell({ tag, now }: { tag: string; now: number }) {
  const tv = live.latest.get(tag);
  const meta = SIGNALS[tag];
  if (!tv) return <span className="text-ink-35">—</span>;
  const stale = now - Date.parse(tv.ts) > STALE_MS;
  const v = typeof tv.v === 'number' ? tv.v.toFixed(meta?.decimals ?? 1) : String(tv.v);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className={`whitespace-nowrap font-mono tabular-nums ${stale || tv.q !== 'good' ? 'text-ink-46' : ''}`}>
        {v}{meta?.unit && <span className="ml-0.5 text-[11px] text-ink-46">{meta.unit}</span>}
      </span>
      <QualityMark q={tv.q} stale={stale} />
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

  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkAck = () => {
    if (!ackable.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkErr('');
    setBulkMsg('');
    void ackMany(ackable).then(({ ok, failed, error }) => {
      if (failed) {
        setBulkErr(ok
          ? t('alx.ackPartial', { ok, failed, reason: errText(error, t) })
          : t('alx.ackFailed', { reason: errText(error, t) }));
      } else {
        setBulkMsg(t('alx.ackDone', { count: ok }));
      }
      setSel(new Set());
    }).finally(() => setBulkBusy(false));
  };
  // live counts for the summary + tabs (all alarms, not the filtered view)
  const unacked = all.filter((a) => a.state === 'active');
  const unackedCrit = unacked.filter((a) => normSeverity(a.severity) === 'critical').length;
  const ackedCount = all.filter((a) => a.state === 'acked').length;
  const ws = useStore(() => live.ws);

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
  useEffect(() => {
    if (!focusVisible) return;
    document.querySelector(`[data-alarm-id="${CSS.escape(focusId!)}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusId, focusVisible]);

  // Keyboard bulk ack: focus anywhere in the table, A acknowledges the
  // selection (Space on a row selects it). Scoped to the table, so it never
  // fires while typing in the filter box or on other pages.
  const onTableKey = (e: KeyboardEvent) => {
    if (!operable || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return;
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); bulkAck(); }
  };
  // signal pivot: Tags explorer filtered to this signal; `fp` keeps the
  // global faceplate contract (?fp=<tag>) for when the faceplate mounts
  const openTag = (tag: string) => navigate(`/tags?q=${encodeURIComponent(tag)}&fp=${encodeURIComponent(tag)}`);

  const tab = (v: StateFilter, label: string, count?: number, urgent = false) => (
    <button
      key={v}
      type="button"
      role="tab"
      aria-selected={state === v}
      onClick={() => setState(v)}
      data-active={state === v}
      className={`flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
        state === v ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
      }`}
    >
      {label}
      {count != null && (
        <span className={`alarm-count rounded-full px-1.5 font-mono text-[11px] font-semibold tabular-nums ${
          urgent && count > 0 ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]' : 'bg-line text-ink-68'
        }`}>{count}</span>
      )}
    </button>
  );

  const cols = operable ? 8 : 7;

  return (
    <>
      <div className="sticky top-9 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="flex h-11 items-center gap-2 px-4">
          <h1 className="text-[15px] font-semibold">{t('alarms.title')}</h1>
          {/* at-a-glance summary: unacked count + criticals, shape + text */}
          <span className="flex min-w-0 items-center gap-1.5 text-[12px]" role="status">
            {unacked.length > 0 ? (
              <>
                <span className="truncate font-semibold text-ink">{t('alx.summaryUnacked', { count: unacked.length })}</span>
                {unackedCrit > 0 && <span className="sev sev-critical" data-severity="critical">{t('alx.summaryCritical', { count: unackedCrit })}</span>}
              </>
            ) : seeded ? <span className="truncate text-ink-46">{t('alx.summaryQuiet')}</span> : null}
          </span>
          <span className="flex-1" />
          {canAdmin(orgRole ?? 'none') && (
            <NavLink to="/admin/rules/new" aria-label={t('admin.addRule')} className="flex h-7 shrink-0 items-center gap-1 rounded bg-blue px-2.5 text-[13px] text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
              <DdIcon name="plus" size={12} /> <span className="hidden sm:inline">{t('admin.addRule')}</span>
            </NavLink>
          )}
        </div>
        <div className="flex overflow-x-auto px-4" role="tablist" aria-label={t('alarms.colState')}>
          {tab('active', t('alarms.active'), unacked.length, true)}
          {tab('acked', t('alarms.acked'), ackedCount)}
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
        {/* bulk bar lives in the sticky header so the ack button stays in
            view while scrolling a flood; viewers get one view-only note */}
        {seeded && rows.length > 0 && (operable ? (
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-subtle px-4 py-1 text-[12px]">
            <span className="font-semibold tabular-nums text-ink-68" aria-live="polite">{t('alarms.selected', { count: selRows.length })}</span>
            <button type="button" className="btn btn-sm" disabled={ackable.length === 0 || bulkBusy} onClick={bulkAck}>
              <Icon name="check" size={13} /> {bulkBusy ? t('alx.ackBusy') : t('alx.ackSelected', { count: ackable.length })}
            </button>
            <button type="button" className="rounded px-1 text-ink-68 hover:text-ink focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-40" disabled={sel.size === 0} onClick={() => setSel(new Set())}>{t('common.clear')}</button>
            <span className="hidden text-[11px] text-ink-46 lg:inline">{t('alx.kbdHint')}</span>
            {bulkErr && <span className="text-[var(--color-danger)]" role="alert">{bulkErr}</span>}
            {bulkMsg && !bulkErr && <span className="text-[var(--color-ok)]" role="status">✓ {bulkMsg}</span>}
          </div>
        ) : (
          <div className="flex min-h-9 items-center gap-2 border-t border-line bg-subtle px-4 py-1 text-[12px] text-ink-68">
            <Icon name="lock" size={13} /> {t('alx.viewOnly')}
          </div>
        ))}
      </div>

      <div className="p-4">
        {ws !== 'open' && seeded && (
          <div className="mb-3"><Notice tone="warn">{t('alx.liveLost')}</Notice></div>
        )}
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
                <div className="overflow-x-auto" onKeyDown={onTableKey}>
                <div className="min-w-[860px]">
                <Table head={[
                  operable ? (
                    <input
                      key="selall"
                      type="checkbox"
                      className="h-4 w-4"
                      aria-label={t('alarms.selectAll')}
                      checked={rows.length > 0 && selRows.length === rows.length}
                      onChange={() => setSel(
                        selRows.length === rows.length ? new Set() : new Set(rows.map((a) => String(a.id))),
                      )}
                    />
                  ) : null,
                  t('alarms.colSeverity'), t('alarms.colAlarm'), t('alx.colValue'), t('alarms.colRaised'),
                  t('alarms.colDuration'), t('alarms.colState'), t('alarms.colAction'),
                ].filter((h) => h !== null)}>
                  {buckets.map((b) => (
                    <Fragment key={b.key}>
                      {/* group header row — dd monitor-pack pattern; colour + glyph + text */}
                      <tr className="bg-subtle">
                        <td colSpan={cols} className="p-0">
                          <button
                            type="button"
                            className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-1 text-left text-[12px] font-semibold text-ink-68 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                            aria-expanded={!collapsed.has(b.key)}
                            onClick={() => toggleGroup(b.key)}
                          >
                            <span className="text-ink-46" aria-hidden>{collapsed.has(b.key) ? '▶' : '⌄'}</span>
                            <span className="text-ink">{b.labelKey ? t(b.labelKey) : b.label}</span>
                            <SeverityBadge severity={b.worst} />
                            <span className="rounded-full bg-line px-1.5 font-mono text-[10px] font-semibold text-ink-68">{b.alarms.length}</span>
                            {groupBy !== 'state' && b.oldest && (
                              <span className="font-mono text-[11px] font-normal text-ink-46">
                                {t('alarms.groupSpan', { dur: fmtDuration(b.oldest, Date.parse(b.newest) || now) })}
                              </span>
                            )}
                          </button>
                        </td>
                      </tr>
                      {!collapsed.has(b.key) && b.alarms.map((a) => {
                        const id = String(a.id);
                        const unackedRow = a.state === 'active';
                        // unacked rows: severity edge bar + bold title; acked/cleared recede
                        const edge = unackedRow ? EDGE[normSeverity(a.severity)] : '';
                        return (
                        <tr
                          key={a.id}
                          data-alarm-id={id}
                          className={`alarm-row alarm-${a.state} cursor-pointer focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${id === focusId ? 'bg-info-soft' : ''} ${a.state === 'cleared' ? 'text-ink-68' : ''}`}
                          tabIndex={0}
                          aria-selected={operable ? sel.has(id) : undefined}
                          onClick={() => navigate(`/alarms/${a.id}`)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter') { e.preventDefault(); navigate(`/alarms/${a.id}`); }
                            // Space selects (grid convention) so bulk ack works without a mouse
                            if (e.key === ' ') { e.preventDefault(); if (operable) toggle(id); else navigate(`/alarms/${a.id}`); }
                          }}
                        >
                          {operable && (
                            /* stopPropagation on keydown too — else the row's
                               Enter/Space handler swallows the press */
                            <td className={edge} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" className="h-4 w-4" checked={sel.has(id)} onChange={() => toggle(id)} aria-label={t('alarms.select', { name: a.rule })} />
                            </td>
                          )}
                          <td className={operable ? '' : edge}><SeverityBadge severity={a.severity} /></td>
                          <td className="py-1.5">
                            <span className={`block ${unackedRow ? 'font-semibold text-ink' : 'font-normal'}`}>{a.rule}</span>
                            <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-46">
                              {SIGNALS[a.tag] && <span>{signalLabel(a.tag)}</span>}
                              <button
                                type="button"
                                className="tag-link rounded font-mono text-blue underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                                onClick={(e) => { e.stopPropagation(); openTag(a.tag); }}
                              >
                                {a.tag}
                              </button>
                            </span>
                          </td>
                          <td><ValueCell tag={a.tag} now={now} /></td>
                          <td className="whitespace-nowrap">
                            <span className="block text-[12px] text-ink-68">{fmtAge(a.ts, now)}</span>
                            <time className="block font-mono text-[11px] tabular-nums text-ink-46" dateTime={a.ts}>{absTime(a.ts, i18n.language)}</time>
                          </td>
                          <td className="whitespace-nowrap font-mono text-[12px] tabular-nums">{fmtDuration(a.ts, now)}</td>
                          <td><StateCell alarm={a} now={now} /></td>
                          <td onClick={(e) => e.stopPropagation()}><AckButton alarm={a} /></td>
                        </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </Table>
                </div>
                </div>
              )}
            </Card>
            <p className="mt-2 text-[11px] text-ink-46">{t('alarms.shown', { count: rows.length })}</p>
          </>
        )}
      </div>
    </>
  );
}

/** Severity edge bar for unacknowledged rows (inset, no layout shift). */
const EDGE: Record<'critical' | 'warning' | 'info', string> = {
  critical: 'shadow-[inset_4px_0_0_var(--color-danger-bright)]',
  warning: 'shadow-[inset_4px_0_0_var(--color-warn)]',
  info: 'shadow-[inset_4px_0_0_var(--color-muted-pill)]',
};

/** Absolute time next to the relative one: clock today, date + clock otherwise. */
function absTime(ts: string, lang: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(lang, { hour12: false })
    : d.toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export { alarmStateKey };
