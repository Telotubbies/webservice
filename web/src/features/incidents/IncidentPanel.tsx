// Incident detail — right-hand triage drawer (WP-E; WP-F reuses this panel).
// Header + Next steps bar (dd case page: Set severity [P] / Set status [S] /
// Assign [A] / Escalate [!], with keyboard shortcut hints), time-in-status
// strip, linked alarm card and the append-only notes timeline.
//
// Backend honesty: only Set status and notes have real endpoints today.
// Severity is fixed at declaration and there is no re-assign or incident
// paging endpoint — those menu items explain the gap instead of faking it.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { ApiError, incidentApi, type IncidentStatus } from '../../lib/api';
import { notifyApi } from '../notify/api';
import { fmtAge, fmtDuration } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Dropdown } from '../../shared/ui/Dropdown';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { SeverityBadge, AlarmStateBadge } from '../../shared/ui/Status';
import { statusSegments, type LinkedAlarms } from './incidents';
import '../notify/i18n';
import './i18n';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const STATUS_STYLE: Record<IncidentStatus, string> = {
  active: 'bg-danger-soft text-[var(--color-danger)]',
  acknowledged: 'bg-caution-soft text-[var(--color-caution-ink)]',
  resolved: 'bg-ok-soft text-[var(--color-ok-ink)]',
};
const STATUS_GLYPH: Record<IncidentStatus, string> = { active: '●', acknowledged: '◆', resolved: '✓' };

/** Status chip — colour + shape glyph + text (never colour alone). */
export function IncStatusPill({ status }: { status: IncidentStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-[3px] px-1.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      <span aria-hidden className="text-[8px] leading-none">{STATUS_GLYPH[status]}</span>
      {t(`inc.status.${status}`)}
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-line bg-subtle px-1 font-mono text-[10px] font-semibold text-ink-46">
      {children}
    </kbd>
  );
}

function MenuItem({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-ink hover:bg-info-soft disabled:cursor-not-allowed disabled:text-ink-46 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-blue"
    >
      {children}
    </button>
  );
}

export function IncidentPanel({ orgId, id, operable, linked, onChanged, onClose }: {
  orgId: string; id: string; operable: boolean; linked: LinkedAlarms;
  onChanged: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const trig = useRef<Record<string, HTMLDivElement | null>>({});
  const [note, setNote] = useState('');
  const now = useNow(10_000);

  const d = useQuery({
    queryKey: ['incident', orgId, id],
    queryFn: () => incidentApi.get(orgId, id),
    refetchInterval: 15_000,
  });
  const inc = d.data?.incident;

  const oncall = useQuery({
    queryKey: ['oncall', orgId],
    queryFn: () => notifyApi.oncall(orgId),
    enabled: operable,
  });

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['incident', orgId, id] });
    onChanged();
  };
  const status = useMutation({
    mutationFn: (s: 'acknowledged' | 'resolved') => incidentApi.setStatus(orgId, id, s),
    onSuccess: done,
  });
  const addNote = useMutation({
    mutationFn: (b: string) => incidentApi.note(orgId, id, b),
    onSuccess: () => { setNote(''); done(); },
  });

  // Esc closes the drawer (dropdowns capture-phase their own Esc first, so a
  // single Esc only ever closes one layer). p/s/a/! open the matching Next
  // steps menu — ignored while typing in a field.
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = { p: 'sev', s: 'status', a: 'assign', '!': 'escalate' };
      const menu = map[k];
      if (menu) {
        e.preventDefault();
        trig.current[menu]?.querySelector('button')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, operable]);

  const team = inc?.team ?? null;
  const oncallEntry = team ? (oncall.data?.items ?? []).find((x) => x.team === team) : undefined;
  const alarm = inc?.alarm_id ? linked.byId.get(inc.alarm_id) : undefined;
  const tag = inc ? linked.tagOf(inc) : '';
  const eq = inc ? linked.equipmentOf(inc) : '';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <div
        ref={ref} role="dialog" aria-modal="true"
        aria-label={inc?.title ?? t('inc.title')} tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(680px,100vw)] flex-col overflow-y-auto bg-white shadow-flyout outline-none"
      >
        {/* header */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-4 text-[13px]">
          <button type="button" className="flex items-center gap-1 text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
            <DdIcon name="caret-left" size={13} /> {t('inc.tabList')}
          </button>
          <button type="button" aria-label={t('common.close')}
            className="rounded p-1 text-ink-68 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
            <DdIcon name="cancel" size={15} />
          </button>
        </div>
        {d.isLoading ? <div className="p-5"><SkeletonRows rows={6} /></div>
        : d.isError || !inc ? <div className="p-5"><ErrorState onRetry={() => void d.refetch()} /></div>
        : (
          <>
            <header className="space-y-2 px-5 pb-3 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={inc.severity} />
                <IncStatusPill status={inc.status} />
                <span className="font-mono text-[11px] text-ink-46" title={inc.id}>#{inc.id.slice(0, 8)}</span>
              </div>
              <h2 className="text-[18px] font-semibold leading-6">{inc.title}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-68">
                <span className="inline-flex items-center gap-1"><DdIcon name="clock" size={12} />{fmt(inc.created_at)}</span>
                <span className="inline-flex items-center gap-1"><DdIcon name="users" size={12} />{team ?? t('inc.unassigned')}</span>
              </div>
            </header>

            {/* Next steps — operate+ only; viewers get a read-only note */}
            {operable ? (
              <div className="flex flex-wrap items-center gap-2 border-y border-line bg-subtle px-5 py-2.5" role="group" aria-label={t('inc.nextSteps')}>
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('inc.nextSteps')}</span>
                <div ref={(el) => { trig.current.sev = el; }}>
                  <Dropdown align="left" title={t('inc.setSeverity')}
                    label={<>{t('inc.setSeverity')}<Kbd>P</Kbd></>}>
                    <div className="p-1.5">
                      <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('inc.sevNow', { sev: t(`alarms.${inc.severity}`) })}</p>
                      {(['critical', 'warning', 'info'] as const).map((s) => (
                        <MenuItem key={s} disabled><SeverityBadge severity={s} />{s === inc.severity && <DdIcon name="check" size={12} className="ml-auto" />}</MenuItem>
                      ))}
                      <p className="max-w-64 border-t border-line px-2 pb-1 pt-2 text-[11px] leading-4 text-ink-46">
                        <strong className="text-ink-68">{t('inc.sevFixedTitle')}.</strong> {t('inc.sevFixedBody')}
                      </p>
                    </div>
                  </Dropdown>
                </div>
                <div ref={(el) => { trig.current.status = el; }}>
                  <Dropdown align="left" title={t('inc.setStatus')}
                    label={<>{t('inc.setStatus')}<Kbd>S</Kbd></>}>
                    {(close) => (
                      <div className="p-1.5">
                        {inc.status === 'active' && (
                          <MenuItem onClick={() => { close(); status.mutate('acknowledged'); }}>
                            <span aria-hidden className="text-[10px] text-[var(--color-caution-ink)]">◆</span>{t('inc.ackAction')}
                          </MenuItem>
                        )}
                        {inc.status !== 'resolved' && (
                          <MenuItem onClick={() => { close(); status.mutate('resolved'); }}>
                            <span aria-hidden className="text-[10px] text-[var(--color-ok-ink)]">✓</span>{t('inc.resolveAction')}
                          </MenuItem>
                        )}
                        {inc.status === 'resolved' && (
                          <p className="px-2 py-1.5 text-[12px] text-ink-46">{t('inc.resolved')} {inc.resolved_at ? `· ${fmt(inc.resolved_at)}` : ''}</p>
                        )}
                      </div>
                    )}
                  </Dropdown>
                </div>
                <div ref={(el) => { trig.current.assign = el; }}>
                  <Dropdown align="left" title={t('inc.assign')}
                    label={<>{t('inc.assign')}<Kbd>A</Kbd></>}>
                    <div className="p-1.5">
                      <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">
                        {t('inc.assignTitle', { team: team ?? t('inc.unassigned') })}
                      </p>
                      <p className="max-w-64 px-2 pb-1 text-[11px] leading-4 text-ink-46">{t('inc.assignBody')}</p>
                      <div className="border-t border-line p-1">
                        <NavLink to="/teams" className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-blue hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
                          {t('inc.manageTeams')}<DdIcon name="arrow-right" size={12} />
                        </NavLink>
                      </div>
                    </div>
                  </Dropdown>
                </div>
                <div ref={(el) => { trig.current.escalate = el; }}>
                  <Dropdown align="left" title={t('inc.escalate')}
                    label={<>{t('inc.escalate')}<Kbd>!</Kbd></>}>
                    <div className="p-1.5">
                      {!team ? (
                        <p className="max-w-64 px-2 py-1.5 text-[12px] text-ink-46">{t('inc.noTeamEsc')}</p>
                      ) : (
                        <p className="flex items-center gap-1.5 px-2 py-1.5 text-[13px]">
                          <DdIcon name="on-call" size={13} className="text-ink-46" />
                          {oncallEntry?.name
                            ? t('inc.oncallNow', { name: `${oncallEntry.name} (${team})` })
                            : t('inc.noOncall')}
                        </p>
                      )}
                      <p className="max-w-64 border-t border-line px-2 pb-1 pt-2 text-[11px] leading-4 text-ink-46">{t('inc.escalateBody')}</p>
                      <div className="p-1">
                        <NavLink to="/incidents/settings" className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-blue hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
                          {t('inc.escalationSettings')}<DdIcon name="arrow-right" size={12} />
                        </NavLink>
                      </div>
                    </div>
                  </Dropdown>
                </div>
              </div>
            ) : (
              <div className="border-y border-line bg-subtle px-5 py-2.5 text-[12px] text-ink-68">{t('inc.viewerNote')}</div>
            )}
            {(status.error || addNote.error) && (
              <div className="px-5 pt-3">
                <Notice tone="error">{status.error instanceof ApiError && status.error.status === 403 ? t('inc.needOperator') : t('inc.failed')}</Notice>
              </div>
            )}

            <div className="space-y-4 p-5">
              {/* time in status */}
              <section aria-label={t('inc.timeInStatus')}>
                <h3 className="mb-1.5 text-[12px] font-semibold text-ink-68">{t('inc.timeInStatus')}</h3>
                <ol className="flex overflow-hidden rounded-[5px] border border-line">
                  {statusSegments(inc).map((seg, i) => (
                    <li key={seg.status}
                      className={`min-w-0 flex-1 px-3 py-2 ${i > 0 ? 'border-l border-line' : ''} ${seg.current ? 'bg-info-soft' : seg.reached ? 'bg-white' : 'bg-subtle'}`}
                      aria-current={seg.current ? 'step' : undefined}>
                      <span className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${seg.reached ? 'text-ink-68' : 'text-ink-35'}`}>
                        <span aria-hidden className="text-[8px]">{STATUS_GLYPH[seg.status]}</span>
                        {t(`inc.status.${seg.status}`)}
                      </span>
                      <span className={`mt-0.5 block font-mono text-[13px] tabular-nums ${seg.reached ? 'text-ink' : 'text-ink-35'}`}>
                        {seg.reached ? (seg.from ? fmtDuration(seg.from, seg.to ? Date.parse(seg.to) : now) : '—') : '—'}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* linked alarm + asset */}
              <section aria-label={t('inc.linkedAlarm')}>
                <h3 className="mb-1.5 text-[12px] font-semibold text-ink-68">{t('inc.linkedAlarm')}</h3>
                {!inc.alarm_id ? (
                  <p className="rounded-[5px] border border-line bg-subtle px-3 py-2 text-[12px] text-ink-46">—</p>
                ) : !alarm ? (
                  <p className="rounded-[5px] border border-line bg-subtle px-3 py-2 text-[12px] text-ink-46">{t('inc.alarmGone')}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[5px] border border-line bg-white px-3 py-2">
                    <AlarmStateBadge state={alarm.state} ackedBy={alarm.acked_by} />
                    <SeverityBadge severity={alarm.severity} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{alarm.rule}</span>
                    {tag && <span className="font-mono text-[11px] text-ink-46">{tag}</span>}
                    {eq && <span className="text-[12px] text-ink-68">{t(`line.${eq}`, { defaultValue: eq })}</span>}
                    <NavLink to={`/alarms?q=${encodeURIComponent(alarm.rule)}`} className="inline-flex items-center gap-1 text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
                      {t('inc.openAlarms')}<DdIcon name="external-link" size={11} />
                    </NavLink>
                    {eq && (
                      <NavLink to="/line" className="inline-flex items-center gap-1 text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={onClose}>
                        {t('inc.openLine')}<DdIcon name="external-link" size={11} />
                      </NavLink>
                    )}
                  </div>
                )}
              </section>

              {/* timeline */}
              <section aria-label={t('inc.timeline')}>
                <h3 className="mb-1.5 text-[12px] font-semibold text-ink-68">{t('inc.timeline')}</h3>
                {(d.data?.events ?? []).length === 0 ? (
                  <EmptyState title={t('inc.notesEmpty')} compact icon="clock" />
                ) : (
                  <ol className="border-l border-line pl-3">
                    {(d.data?.events ?? []).map((e, k) => (
                      <li key={k} className="relative py-1 text-[12px]">
                        <span className={`absolute -left-[17px] top-1.5 h-2 w-2 rounded-full ${e.kind === 'note' ? 'bg-blue' : 'bg-line-hard'}`} aria-hidden />
                        <span className="font-mono text-ink-46">{fmt(e.at)}</span>{' '}
                        <span className="font-semibold">{e.who}</span>{' '}
                        <span className="text-ink-68">
                          {e.kind === 'note' ? e.body : e.kind === 'created' ? t('inc.evCreated') : t(`inc.status.${e.body}`)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {operable && inc.status !== 'resolved' && (
                  <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(note.trim()); }}>
                    <input className="input flex-1" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={t('inc.notePh')} aria-label={t('inc.notePh')} />
                    <button type="submit" className="btn btn-sm" disabled={!note.trim() || addNote.isPending}>{t('inc.addNote')}</button>
                  </form>
                )}
                <p className="mt-3 text-[11px] text-ink-35">{t('inc.colAge')}: {fmtAge(inc.created_at, now)}</p>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
