// Vision events explorer (roadmap 9.8): filterable table with thumbnails,
// a detail side panel, keyboard review (C/W + arrows), bulk review and a
// YOLO export ZIP of "wrong" events for retraining.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { ApiError, getToken } from '../../lib/api';
import { saveBlob } from '../../lib/saveBlob';
import { useAdminOrg } from '../admin/admin';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { DEVICE_TABS } from '../devices/tabs';
import { visionApi, type EventFilter, type VisionEvent } from './api';
import { CameraCascade, useCameraPick, type CameraChoice } from './CameraSelect';
import './i18n';

const KINDS = ['rule_fire', 'blocked', 'dry_run', 'alert_object'] as const;

/** Thumbnails need the bearer token — <img src> cannot send it, so fetch
 * into an object URL and revoke on swap/unmount. */
function useAuthedThumb(orgId: string | null, ev: VisionEvent | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId || !ev?.has_thumb) { setUrl(null); return; }
    let dead = false;
    let obj: string | null = null;
    fetch(visionApi.thumbUrl(orgId, ev.id), { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((b) => { if (!dead) { obj = URL.createObjectURL(b); setUrl(obj); } })
      .catch(() => { if (!dead) setUrl(null); });
    return () => { dead = true; if (obj) URL.revokeObjectURL(obj); };
  }, [orgId, ev?.id, ev?.has_thumb]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

const fmt = (iso: string) => new Date(iso).toLocaleString();

export function EventsPage() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const qc = useQueryClient();
  // filters live in the URL (?cam= ?kind= ?outcome= ?class=) so a filtered
  // view is shareable — same useSearchParams pattern as the alarms page
  const [params, setParams] = useSearchParams();
  const setParam = (k: string, v: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true });
  const [choice, setChoice] = useState<CameraChoice | null>(null);
  const pickCam = (c: CameraChoice | null) => { setChoice(c); setParam('cam', c?.camera.id ?? ''); };
  const pick = useCameraPick(orgId, choice?.camera.id ?? null, pickCam);
  // deep link: reselect ?cam= once the cascade has loaded that camera
  const wantCam = params.get('cam');
  useEffect(() => {
    if (wantCam && !choice && (pick.cams.data?.items ?? []).some((c) => c.id === wantCam)) pick.select(wantCam);
  }, [wantCam, choice, pick.cams.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = params.get('kind') ?? '';
  const outcome = params.get('outcome') ?? '';
  const cls = params.get('class') ?? '';
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<VisionEvent[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const [msg, setMsg] = useState('');

  const clsNum = Number(cls);
  const filter: EventFilter = {
    camera: choice?.camera.id, kind: kind || undefined,
    outcome: (outcome || undefined) as EventFilter['outcome'],
    class_id: cls === '' || !Number.isFinite(clsNum) ? undefined : clsNum,
    limit: 50, cursor: cursor ?? undefined,
  };
  const events = useQuery({
    queryKey: ['vis-events', orgId, filter.camera, kind, outcome, cls, cursor],
    queryFn: () => visionApi.events(orgId!, filter), enabled: !!orgId,
  });
  // first page replaces; "load more" appends — dedup by event id so an
  // invalidated refetch of an already-loaded page never duplicates rows
  useEffect(() => {
    if (!events.data) return;
    setStack((s) => {
      if (!cursor) return events.data!.items;
      const seen = new Set(s.map((x) => x.id));
      return [...s, ...events.data!.items.filter((x) => !seen.has(x.id))];
    });
  }, [events.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { setCursor(null); setStack([]); setSel(new Set()); setFocus(0); };
  // org / camera switch drops the accumulated pages, cursor and selection
  useEffect(() => { reset(); }, [orgId, choice?.camera.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rules = useQuery({
    queryKey: ['vis-rules-map', orgId],
    queryFn: () => visionApi.rules(orgId!), enabled: !!orgId,
  });
  const ruleName = useMemo(() => {
    const m = new Map((rules.data?.items ?? []).map((r) => [r.id, r.name]));
    return (id: string | null) => (id ? m.get(id) ?? id.slice(0, 8) : '—');
  }, [rules.data]);

  const pin = useQuery({
    queryKey: ['vis-pin', orgId, choice?.camera.id],
    queryFn: () => visionApi.pin(orgId!, choice!.camera.id), enabled: !!orgId && !!choice,
  });
  const classes = pin.data?.classes ?? [];
  const className = (id: number | null) => (id == null ? '—' : classes[id] ?? `class ${id}`);

  const items = stack;
  const cur: VisionEvent | null = items[focus] ?? null;
  const thumb = useAuthedThumb(orgId, cur);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vis-events'] });
  };
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? String(e.message) : t('dev.errNetwork'));
  const review = useMutation({
    mutationFn: (b: { id: string; verdict: 'correct' | 'wrong'; corrected_class_id?: number | null }) =>
      visionApi.review(orgId!, b.id, b),
    onSuccess: refresh, onError: fail,
  });
  const bulk = useMutation({
    mutationFn: (verdict: 'correct' | 'wrong') => visionApi.bulkReview(orgId!, [...sel], verdict),
    onSuccess: () => { setSel(new Set()); refresh(); }, onError: fail,
  });

  const mark = useCallback((verdict: 'correct' | 'wrong') => {
    if (cur) review.mutate({ id: cur.id, verdict });
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard review: C/W verdict the focused row; arrows move focus
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); mark('correct'); }
      else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); mark('wrong'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => Math.min(f + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => Math.max(f - 1, 0)); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mark, items.length]);

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const doExport = async () => {
    try {
      const blob = await visionApi.exportWrong(orgId!, choice?.camera.id);
      saveBlob('vision-review-export.zip', blob);
    } catch (e) { fail(e); }
  };

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('vis.eventsTab')} tabs={DEVICE_TABS(t)} lede={t('vis.eventsLede')}
        actions={<button type="button" className="btn btn-sm" title={t('vis.exportHint')} onClick={() => void doExport()}>
          <Download size={14} aria-hidden /> {t('vis.exportZip')}
        </button>} />
      <div className="flex-1 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CameraCascade pick={pick} choice={choice?.camera.id ?? null} t={t} />
          <select className="input h-8" aria-label={t('vis.filterKind')} value={kind}
            onChange={(e) => { setParam('kind', e.target.value); reset(); }}>
            <option value="">{t('vis.filterAll')}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(`vis.kind_${k}`)}</option>)}
          </select>
          <select className="input h-8" aria-label={t('vis.filterOutcome')} value={outcome}
            onChange={(e) => { setParam('outcome', e.target.value); reset(); }}>
            <option value="">{t('vis.filterAll')}</option>
            <option value="reviewed">{t('vis.out_reviewed')}</option>
            <option value="unreviewed">{t('vis.out_unreviewed')}</option>
            <option value="correct">{t('vis.out_correct')}</option>
            <option value="wrong">{t('vis.out_wrong')}</option>
          </select>
          <input className="input h-8 w-20" placeholder={t('vis.filterClass')} inputMode="numeric"
            aria-label={t('vis.filterClass')} value={cls}
            onChange={(e) => { setParam('class', e.target.value); reset(); }} />
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        {sel.size > 0 && (
          <div className="flex items-center gap-2 text-[13px]">
            <span>{t('vis.eventsSelected', { count: sel.size })}</span>
            <button type="button" className="btn btn-sm" onClick={() => bulk.mutate('correct')}>{t('vis.bulkCorrect')}</button>
            <button type="button" className="btn btn-sm" onClick={() => bulk.mutate('wrong')}>{t('vis.bulkWrong')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>{t('vis.clearSel')}</button>
          </div>
        )}
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            {events.isError ? <ErrorState onRetry={() => void events.refetch()} />
              : events.isLoading && !items.length ? <SkeletonRows rows={6} />
              : items.length === 0 ? <EmptyState icon="info" title={t('vis.noEvents')} /> : (
              <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-68">
                      <th className="w-8 px-2 py-2" aria-label="select" />
                      <th className="px-2 py-2 font-medium" />
                      <th className="px-3 py-2 font-medium">{t('vis.colTime')}</th>
                      <th className="px-3 py-2 font-medium">{t('vis.colKind')}</th>
                      <th className="px-3 py-2 font-medium">{t('vis.colClass')}</th>
                      <th className="px-3 py-2 font-medium">{t('vis.colDetScore')}</th>
                      <th className="px-3 py-2 font-medium">{t('vis.colReview')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((ev, i) => (
                      <tr key={ev.id}
                        className={`border-b border-line last:border-0 ${i === focus ? 'bg-blue/10' : ''}`}
                        onClick={() => setFocus(i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setFocus(i); }}
                        tabIndex={0} role="button" aria-selected={i === focus}>
                        <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`${t('vis.colReview')} ${ev.id.slice(0, 8)}`}
                            checked={sel.has(ev.id)} onChange={() => toggle(ev.id)} />
                        </td>
                        <td className="px-2 py-1"><RowThumb orgId={orgId} ev={ev} /></td>
                        <td className="px-3 py-1 whitespace-nowrap">{fmt(ev.fired_at)}</td>
                        <td className="px-3 py-1">{t(`vis.kind_${ev.kind}`)}
                          {ev.blocked_reason && <div className="text-[11px] text-[var(--color-danger)]">{t('vis.blockedBy', { reason: ev.blocked_reason })}</div>}
                        </td>
                        <td className="px-3 py-1">{className(ev.class_id)}</td>
                        <td className="px-3 py-1">{ev.score != null ? `${Math.round(ev.score * 100)}%` : '—'}</td>
                        <td className="px-3 py-1">{ev.review ? t(`vis.out_${ev.review.verdict}`) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {events.data?.next_cursor && (
                  <div className="border-t border-line p-2 text-center">
                    <button type="button" className="btn btn-sm btn-ghost"
                      onClick={() => setCursor(events.data!.next_cursor)}>{t('vis.moreEvents')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
          {cur && (
            <aside className="w-80 shrink-0 space-y-2 rounded-[5px] border border-line bg-white p-3 text-[13px]">
              {thumb ? <img src={thumb} alt="" className="w-full rounded border border-line" />
                : <div className="flex h-40 items-center justify-center rounded border border-line text-ink-68">{t('vis.noThumb')}</div>}
              <div><span className="text-ink-68">{t('vis.colTime')}:</span> {fmt(cur.fired_at)}</div>
              <div><span className="text-ink-68">{t('vis.colKind')}:</span> {t(`vis.kind_${cur.kind}`)}</div>
              <div><span className="text-ink-68">{t('vis.colClass')}:</span> {className(cur.class_id)}
                {cur.score != null ? ` · ${Math.round(cur.score * 100)}%` : ''}</div>
              <div><span className="text-ink-68">{t('vis.evRule')}:</span> {ruleName(cur.rule_id)}</div>
              {cur.blocked_reason && <div className="text-[var(--color-danger)]">{t('vis.blockedBy', { reason: cur.blocked_reason })}</div>}
              {cur.review && (
                <div>
                  <span className="text-ink-68">{t('vis.colReview')}:</span> {t(`vis.out_${cur.review.verdict}`)}
                  {cur.review.corrected_class_id != null && ` → ${className(cur.review.corrected_class_id)}`}
                </div>
              )}
              {cur.detail && (
                <pre className="max-h-28 overflow-auto rounded bg-paper p-1.5 text-[11px]">{JSON.stringify(cur.detail, null, 1)}</pre>
              )}
              <WrongPicker orgId={orgId} ev={cur} classes={classes}
                onPick={(cid) => review.mutate({ id: cur.id, verdict: 'wrong', corrected_class_id: cid })} t={t} />
              <div className="flex gap-2">
                <button type="button" className="btn btn-sm" onClick={() => mark('correct')}>{t('vis.markCorrect')}</button>
                <button type="button" className="btn btn-sm" onClick={() => mark('wrong')}>{t('vis.markWrong')}</button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function RowThumb({ orgId, ev }: { orgId: string | null; ev: VisionEvent }) {
  const url = useAuthedThumb(orgId, ev.has_thumb ? ev : null);
  return url
    ? <img src={url} alt="" className="h-10 w-14 rounded border border-line object-cover" />
    : <div className="h-10 w-14 rounded border border-line bg-paper" aria-hidden />;
}

function WrongPicker({ ev, classes, onPick, t }: {
  orgId: string | null; ev: VisionEvent; classes: string[];
  onPick: (cid: number | null) => void; t: (k: string) => string;
}) {
  return (
    <select className="input h-8" aria-label={t('vis.pickWrong')}
      value={ev.review?.corrected_class_id ?? ''}
      onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">{t('vis.pickWrong')}</option>
      {classes.map((c, i) => <option key={i} value={i}>{c}</option>)}
    </select>
  );
}
