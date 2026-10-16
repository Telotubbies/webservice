// Vision rules (roadmap 9.7): sentence-style rule builder per camera.
// "When [class] [score≥] [in zone] for [N frames] → then [actions]".
// Rules are written here in the backend only; the gateway receives them via
// cfg and enforces its own local gate. New rules default to dry_run=true.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { DEVICE_TABS } from '../devices/tabs';
import { visionApi, type RuleAction, type RuleBody, type VisionRule } from './api';
import { CameraCascade, useCameraPick, type CameraChoice } from './CameraSelect';
import './i18n';

const ZONES: Record<string, number[][] | undefined> = {
  none: undefined,
  full: [[0, 0], [1, 0], [1, 1], [0, 1]],
  half: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
  band: [[0.33, 0], [0.67, 0], [0.67, 1], [0.33, 1]],
};
const zoneKey = (z: number[][] | undefined): string => {
  for (const [k, v] of Object.entries(ZONES)) {
    if (JSON.stringify(v ?? null) === JSON.stringify(z ?? null)) return k;
  }
  return 'custom';
};

const blank = (cam: string, classes: number[]): RuleBody => ({
  camera_id: cam, name: '', enabled: true, dry_run: true,
  conditions: { class_ids: classes.length ? [classes[0]] : [] },
  actions: [{ kind: 'alarm', severity: 'warning' }],
});

const num = (s: string): number | null => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function ZoneEditor({ zone, onChange, t }: {
  zone: number[][] | undefined; onChange: (z: number[][] | undefined) => void; t: (k: string) => string;
}) {
  const preset = zoneKey(zone);
  const pts = zone ?? [];
  const set = (i: number, j: 0 | 1, v: string) => {
    const n = num(v);
    if (n == null) return;
    const next = pts.map((p, k) => (k === i ? (j === 0 ? [n, p[1]] : [p[0], n]) : p));
    onChange(next);
  };
  return (
    <div className="space-y-1">
      <select className="input h-8" aria-label={t('vis.sentenceZone')} value={preset}
        onChange={(e) => onChange(e.target.value === 'custom' ? pts : ZONES[e.target.value])}>
        {Object.keys(ZONES).map((k) => <option key={k} value={k}>{t(`vis.zone${k[0].toUpperCase()}${k.slice(1)}`)}</option>)}
        <option value="custom" disabled={preset !== 'custom'}>{t('vis.zonePoints')}</option>
      </select>
      {zone && (
        <div className="space-y-1 pt-1">
          <div className="text-[11px] text-ink-68">{t('vis.zonePoints')}</div>
          {pts.map((p, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="w-10 text-[11px] text-ink-68">{t('vis.zonePoint')} {i + 1}</span>
              <input className="input h-7 w-20" inputMode="decimal" aria-label={`x ${i + 1}`}
                value={p[0]} onChange={(e) => set(i, 0, e.target.value)} />
              <input className="input h-7 w-20" inputMode="decimal" aria-label={`y ${i + 1}`}
                value={p[1]} onChange={(e) => set(i, 1, e.target.value)} />
              <button type="button" className="btn btn-sm btn-ghost" disabled={pts.length <= 3}
                aria-label={`${t('vis.zoneRemove')} ${i + 1}`}
                onClick={() => onChange(pts.filter((_, k) => k !== i))}><Trash2 size={12} aria-hidden /></button>
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-ghost"
            onClick={() => onChange([...pts, [0.5, 0.5]])}>{t('vis.zoneAdd')}</button>
          {pts.length < 3 && <span className="text-[11px] text-[var(--color-danger)]">{t('vis.zoneNeed3')}</span>}
        </div>
      )}
    </div>
  );
}

function ActionRow({ a, onChange, onRemove, t }: {
  a: RuleAction; onChange: (a: RuleAction) => void; onRemove: () => void; t: (k: string) => string;
}) {
  const kindLabel: Record<RuleAction['kind'], string> = {
    plc_write: t('vis.actWrite'), counter: t('vis.actCounter'), alarm: t('vis.actAlarm'),
    notify: t('vis.actNotify'), snapshot: t('vis.actSnapshot'),
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[5px] border border-line px-2 py-1.5">
      <span className="text-[12px] font-medium">{kindLabel[a.kind]}</span>
      {(a.kind === 'plc_write' || a.kind === 'counter') && (
        <input className="input h-7 w-44" placeholder={t('vis.actTag')} value={a.tag_path}
          aria-label={t('vis.actTag')}
          onChange={(e) => onChange({ ...a, tag_path: e.target.value })} />
      )}
      {a.kind === 'plc_write' && (
        <>
          <input className="input h-7 w-24" placeholder={t('vis.actValue')} aria-label={t('vis.actValue')}
            value={String(a.value)}
            onChange={(e) => {
              const v = e.target.value;
              const parsed = v === 'true' ? true : v === 'false' ? false : num(v);
              onChange({ ...a, value: parsed ?? a.value });
            }} />
          <input className="input h-7 w-28" placeholder={t('vis.actPulse')} aria-label={t('vis.actPulse')}
            inputMode="numeric" value={a.pulse_ms ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : num(e.target.value);
              onChange({ ...a, pulse_ms: v ?? undefined });
            }} />
        </>
      )}
      {a.kind === 'counter' && (
        <input className="input h-7 w-20" placeholder={t('vis.actBy')} aria-label={t('vis.actBy')}
          inputMode="numeric" value={a.by ?? 1}
          onChange={(e) => onChange({ ...a, by: num(e.target.value) ?? a.by })} />
      )}
      {a.kind === 'alarm' && (
        <select className="input h-7" aria-label={t('vis.actSeverity')} value={a.severity ?? 'warning'}
          onChange={(e) => onChange({ ...a, severity: e.target.value as 'info' | 'warning' | 'critical' })}>
          <option value="info">{t('vis.sev_info')}</option>
          <option value="warning">{t('vis.sev_warning')}</option>
          <option value="critical">{t('vis.sev_critical')}</option>
        </select>
      )}
      {(a.kind === 'alarm' || a.kind === 'notify') && (
        <input className="input h-7 w-48" placeholder={t('vis.actMessage')} aria-label={t('vis.actMessage')}
          value={a.message ?? ''} onChange={(e) => onChange({ ...a, message: e.target.value || null })} />
      )}
      <button type="button" className="btn btn-sm btn-ghost ml-auto" aria-label={t('vis.delete')}
        onClick={onRemove}><Trash2 size={12} aria-hidden /></button>
    </div>
  );
}

export function RulesPage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const admin = canAdmin(orgRole ?? 'none');
  const qc = useQueryClient();
  // ?cam=<id> mirrors the camera pick into the URL — shareable, same
  // useSearchParams pattern as the alarms page
  const [params, setParams] = useSearchParams();
  const [choice, setChoice] = useState<CameraChoice | null>(null);
  const pickCam = (c: CameraChoice | null) => {
    setChoice(c);
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (c) n.set('cam', c.camera.id); else n.delete('cam');
      return n;
    }, { replace: true });
  };
  const cam = choice?.camera ?? null;
  const pick = useCameraPick(orgId, cam?.id ?? null, pickCam);
  // deep link: reselect ?cam= once the cascade has loaded that camera
  const wantCam = params.get('cam');
  useEffect(() => {
    if (wantCam && !choice && (pick.cams.data?.items ?? []).some((c) => c.id === wantCam)) pick.select(wantCam);
  }, [wantCam, choice, pick.cams.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<RuleBody | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState<{ tag: string; value: string } | null>(null);
  const [del, setDel] = useState<VisionRule | null>(null);

  const rules = useQuery({
    queryKey: ['vis-rules', orgId, cam?.id],
    queryFn: () => visionApi.cameraRules(orgId!, cam!.id), enabled: !!orgId && !!cam,
  });
  const pin = useQuery({
    queryKey: ['vis-pin', orgId, cam?.id],
    queryFn: () => visionApi.pin(orgId!, cam!.id), enabled: !!orgId && !!cam,
  });
  const classes = pin.data?.classes ?? [];
  const className = (id: number) => classes[id] ?? `class ${id}`;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['vis-rules', orgId, cam?.id] });
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? String(e.message) : t('dev.errNetwork'));
  const save = useMutation({
    mutationFn: () => editId
      ? visionApi.patchRule(orgId!, editId, draft!)
      : visionApi.createRule(orgId!, draft!),
    onSuccess: () => { setDraft(null); setEditId(null); setMsg(''); refresh(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => visionApi.deleteRule(orgId!, id),
    onSuccess: () => { setDel(null); refresh(); }, onError: fail,
  });

  const hasPlc = (b: RuleBody) => b.actions.some((a) => a.kind === 'plc_write' || a.kind === 'counter');
  const plcAction = (b: RuleBody) => b.actions.find((a) => a.kind === 'plc_write') ?? null;

  const trySave = () => {
    if (!draft) return;
    if (!draft.name.trim()) return setMsg(t('vis.errRuleName'));
    if (!draft.conditions.class_ids.length) return setMsg(t('vis.errRuleClass'));
    if (!draft.actions.length) return setMsg(t('vis.errRuleAction'));
    if (draft.actions.some((a) => (a.kind === 'plc_write' || a.kind === 'counter') && !a.tag_path.trim()))
      return setMsg(t('vis.errRuleTag'));
    setMsg('');
    // V9: any rule that can touch a tag and is not a dry run asks for a
    // confirmation that names the tag and the value.
    if (!draft.dry_run && hasPlc(draft)) {
      const a = plcAction(draft);
      setConfirm({ tag: a?.tag_path ?? '?', value: a ? String(a.value) : '?' });
      return;
    }
    save.mutate();
  };

  const dryRuns = useQuery({
    queryKey: ['vis-dry', orgId, editId],
    queryFn: () => visionApi.events(orgId!, { rule: editId!, kind: 'dry_run', limit: 10 }),
    enabled: !!orgId && !!editId,
  });

  const items = rules.data?.items ?? [];
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('vis.rulesTab')} tabs={DEVICE_TABS(t)} lede={t('vis.rulesLede')}
        actions={admin && cam && !draft ? (
          <button type="button" className="btn btn-sm" onClick={() => {
            setEditId(null);
            setDraft(blank(cam.id, classes.map((_, i) => i)));
          }}><Plus size={14} aria-hidden /> {t('vis.newRule')}</button>
        ) : undefined} />
      <div className="flex-1 space-y-3 p-4">
        <CameraCascade pick={pick} choice={cam?.id ?? null} t={t} />
        {!admin && <Notice tone="info">{t('vis.readOnly')}</Notice>}
        {msg && <Notice tone="error">{msg}</Notice>}
        {!cam ? <Notice tone="info">{t('vis.noCameras')}</Notice> : rules.isError ? (
          <ErrorState onRetry={() => void rules.refetch()} />
        ) : rules.isLoading ? <SkeletonRows rows={3} /> : null}

        {draft ? (
          <form className="space-y-3 rounded-[5px] border border-line bg-white p-3"
            onSubmit={(e) => { e.preventDefault(); trySave(); }}>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input h-8 w-64" placeholder={t('vis.name')} value={draft.name}
                maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              {hasPlc(draft) && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  {t('vis.writesPlc')}
                </span>
              )}
            </div>
            {/* sentence layout: When [class] [score ≥] [in zone] for [hold] */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px]">
              <span className="font-medium">{t('vis.sentenceWhen')}</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label={t('vis.filterClass')}>
                {classes.map((c, i) => {
                  const on = draft.conditions.class_ids.includes(i);
                  return (
                    <button key={i} type="button"
                      className={`rounded border px-2 py-0.5 text-[12px] ${on ? 'border-blue bg-blue/10 text-ink' : 'border-line text-ink-68'}`}
                      aria-pressed={on}
                      onClick={() => setDraft({
                        ...draft,
                        conditions: {
                          ...draft.conditions,
                          class_ids: on
                            ? draft.conditions.class_ids.filter((x) => x !== i)
                            : [...draft.conditions.class_ids, i].sort((a, b) => a - b),
                        },
                      })}>{c}</button>
                  );
                })}
                {!classes.length && <span className="text-ink-68">{t('vis.none')}</span>}
              </div>
              <span>{t('vis.sentenceScore')}</span>
              <input className="input h-7 w-20" inputMode="decimal"
                aria-label={t('vis.sentenceScore')}
                value={Math.round((draft.conditions.min_score ?? 0.5) * 100)}
                onChange={(e) => {
                  const v = num(e.target.value);
                  setDraft({ ...draft, conditions: { ...draft.conditions, min_score: v == null ? undefined : v / 100 } });
                }} />
              <span>%</span>
              <span>{t('vis.sentenceZone')}</span>
              <ZoneEditor zone={draft.conditions.zone}
                onChange={(z) => setDraft({ ...draft, conditions: { ...draft.conditions, zone: z } })} t={t} />
              <span>{t('vis.sentenceFor')}</span>
              <input className="input h-7 w-16" inputMode="numeric" aria-label={t('vis.sentFrames')}
                value={draft.conditions.hold_frames ?? 1}
                onChange={(e) => setDraft({
                  ...draft,
                  conditions: { ...draft.conditions, hold_frames: num(e.target.value) ?? undefined },
                })} />
              <span>{t('vis.sentFrames')}</span>
              <input className="input h-7 w-20" inputMode="numeric" aria-label={t('vis.sentMs')}
                placeholder="0"
                value={draft.conditions.hold_ms ?? ''}
                onChange={(e) => setDraft({
                  ...draft,
                  conditions: { ...draft.conditions, hold_ms: num(e.target.value) ?? undefined },
                })} />
              <span>{t('vis.sentMs')}</span>
              <span>{t('vis.sentCount')}</span>
              <input className="input h-7 w-16" inputMode="numeric" aria-label={t('vis.sentCount')}
                placeholder="1"
                value={draft.conditions.count_in_zone ?? ''}
                onChange={(e) => setDraft({
                  ...draft,
                  conditions: { ...draft.conditions, count_in_zone: num(e.target.value) ?? undefined },
                })} />
              <span className="font-medium">→ {t('vis.sentenceThen')}</span>
            </div>
            {/* actions */}
            <div className="space-y-1.5">
              {draft.actions.map((a, i) => (
                <ActionRow key={i} a={a} t={t}
                  onChange={(na) => setDraft({
                    ...draft, actions: draft.actions.map((x, k) => (k === i ? na : x)),
                  })}
                  onRemove={() => setDraft({
                    ...draft, actions: draft.actions.filter((_, k) => k !== i),
                  })} />
              ))}
              <select className="input h-8" aria-label={t('vis.sentenceThen')} value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const k = e.target.value;
                  const add: RuleAction = k === 'plc_write' ? { kind: 'plc_write', tag_path: '', value: true }
                    : k === 'counter' ? { kind: 'counter', tag_path: '', by: 1 }
                    : k === 'alarm' ? { kind: 'alarm', severity: 'warning' }
                    : k === 'notify' ? { kind: 'notify' }
                    : { kind: 'snapshot' };
                  setDraft({ ...draft, actions: [...draft.actions, add] });
                  e.target.value = '';
                }}>
                <option value="">+ {t('vis.sentenceThen')}…</option>
                <option value="plc_write">{t('vis.actWrite')}</option>
                <option value="counter">{t('vis.actCounter')}</option>
                <option value="alarm">{t('vis.actAlarm')}</option>
                <option value="notify">{t('vis.actNotify')}</option>
                <option value="snapshot">{t('vis.actSnapshot')}</option>
              </select>
            </div>
            {/* flags */}
            <div className="flex flex-wrap items-center gap-4 text-[13px]">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.enabled ?? true}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                {t('vis.enabled')}
              </label>
              <label className="flex items-center gap-1.5" title={t('vis.dryRunHint')}>
                <input type="checkbox" checked={draft.dry_run ?? true}
                  onChange={(e) => setDraft({ ...draft, dry_run: e.target.checked })} />
                {t('vis.dryRun')}
              </label>
              {hasPlc(draft) && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={draft.allow_cloud_write ?? false}
                    onChange={(e) => setDraft({ ...draft, allow_cloud_write: e.target.checked })} />
                  {t('vis.allowCloud')}
                </label>
              )}
              <label className="flex items-center gap-1.5">
                {t('vis.offlineWindow')}
                <input className="input h-7 w-20" inputMode="numeric"
                  value={draft.offline_write_window_s ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    offline_write_window_s: e.target.value === '' ? null : num(e.target.value),
                  })} />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn btn-sm" disabled={save.isPending}>
                {t('vis.saveClassSettings')}
              </button>
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => { setDraft(null); setEditId(null); }}>{t('vis.cancel')}</button>
            </div>
            {editId && (
              <div className="border-t border-line pt-2">
                <div className="text-[12px] font-medium">{t('vis.dryResults')}</div>
                {(dryRuns.data?.items ?? []).length === 0 ? (
                  <div className="text-[12px] text-ink-68">{t('vis.noDryResults')}</div>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-[12px]">
                    {dryRuns.data!.items.map((ev) => (
                      <li key={ev.id} className="text-ink-68">
                        {new Date(ev.fired_at).toLocaleString()} — {ev.class_id != null ? className(ev.class_id) : '—'}
                        {ev.score != null ? ` · ${Math.round(ev.score * 100)}%` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </form>
        ) : (
          cam && (rules.isLoading ? null : items.length === 0 ? (
            <EmptyState icon="info" title={t('vis.noRules')} />
          ) : (
            <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] text-ink-68">
                    <th className="px-3 py-2 font-medium">{t('vis.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('vis.colKind')}</th>
                    <th className="px-3 py-2 font-medium">{t('vis.enabled')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('vis.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-medium">{r.name}
                        {r.actions.some((a) => a.kind === 'plc_write' || a.kind === 'counter') && (
                          <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">{t('vis.writesPlc')}</span>)}
                      </td>
                      <td className="px-3 py-2">{r.dry_run ? t('vis.dryRun') : t('vis.kind_rule_fire')}</td>
                      <td className="px-3 py-2">{r.enabled ? '✓' : '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {admin && <button type="button" className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setEditId(r.id);
                            setDraft({
                              name: r.name, enabled: r.enabled, dry_run: r.dry_run,
                              allow_cloud_write: r.allow_cloud_write,
                              offline_write_window_s: r.offline_write_window_s ?? null,
                              conditions: r.conditions, actions: r.actions,
                            });
                          }}>{t('vis.test')}</button>}
                        {admin && <button type="button" className="btn btn-sm btn-ghost"
                          aria-label={`${t('vis.delete')} ${r.name}`}
                          onClick={() => setDel(r)}><Trash2 size={14} aria-hidden /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
      {confirm && (
        <Confirm title={t('vis.confirmWriteTitle')}
          body={t('vis.writesPlcWarn', { tag: confirm.tag, value: confirm.value })}
          confirm={t('vis.actWrite')}
          onYes={() => { setConfirm(null); save.mutate(); }}
          onNo={() => setConfirm(null)} />
      )}
      {del && (
        <Confirm title={t('vis.deleteRuleTitle', { name: del.name })}
          body={t('vis.deleteRuleBody')} confirm={t('vis.delete')}
          onYes={() => remove.mutate(del.id)} onNo={() => setDel(null)} />
      )}
    </div>
  );
}
