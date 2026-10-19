// Plant structure — the ISA-95 tree of the site (Area › Line › Equipment) with
// tag and alarm counts. Admins build and reorganise it here; everyone else
// reads it. Moving never touches tag paths, so dashboards and alarms survive.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError, hierarchyApi, type HArea, type HEquipment, type HLine, type LineKind } from '../../lib/api';
import { useAdminOrg, useAdminSite, canAdmin } from '../admin/admin';
import { PageBar } from '../../shared/ui/Page';
import { Confirm } from '../../shared/ui/Confirm';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import './i18n';

type Sel = { kind: 'area' | 'line' | 'equipment'; id: string };
type LineN = HLine & { area: HArea };
type EquipN = HEquipment & { line: LineN };
type Node = HArea | LineN | EquipN;

const KINDS = ['motor', 'conveyor', 'vessel', 'valve', 'pump', 'mixer', 'indicator', 'other'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'area';

export function AssetTreePage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const admin = canAdmin(orgRole ?? '');
  const qc = useQueryClient();
  const key = ['hierarchy', orgId, site?.id];
  const q = useQuery({ queryKey: key, enabled: !!orgId && !!site, queryFn: () => hierarchyApi.tree(orgId!, site!.id) });
  const [sel, setSel] = useState<Sel | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [move, setMove] = useState<{ label: string; run: () => Promise<unknown> } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['hierarchy-scope'] });
  };
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const err = run.error instanceof ApiError && run.error.status !== 401 ? run.error.message : null;

  const areas = q.data?.areas ?? [];
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const lines: LineN[] = areas.flatMap((a) => a.lines.map((l) => ({ ...l, area: a })));
  const equipment: EquipN[] = lines.flatMap((l) => l.equipment.map((e) => ({ ...e, line: l })));
  const found: Node | null = !sel ? null
    : sel.kind === 'area' ? areas.find((a) => a.id === sel.id) ?? null
    : sel.kind === 'line' ? lines.find((l) => l.id === sel.id) ?? null
    : equipment.find((e) => e.id === sel.id) ?? null;

  const quickStart = () => run.mutate(async () => {
    const a = await hierarchyApi.createArea(orgId!, site!.id, { name: t('asset.tplArea'), code: `${slug(t('asset.tplArea'))}-1` });
    const l = await hierarchyApi.createLine(orgId!, site!.id, { name: t('asset.tplLine'), area_id: a.id });
    await hierarchyApi.createDevice(orgId!, site!.id, { name: t('asset.tplEquip'), line_id: l.id });
  });

  return (
    <>
      <PageBar icon="service-map" title={t('asset.title')} lede={t('asset.lede')} />
      <div className="space-y-3 p-4">
        {err && <Notice tone="error">{t(`asset.err.${err}`, { defaultValue: err })}</Notice>}
        {q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorState onRetry={q.refetch} /> : (
          areas.every((a) => a.lines.length === 0) ? (
            <EmptyState icon="tags" title={t('asset.emptyTitle')} body={t(admin ? 'asset.emptyBody' : 'asset.emptyViewer')}
              action={admin ? <button type="button" className="btn" onClick={quickStart} disabled={run.isPending}>{t('asset.quickStart')}</button> : undefined} />
          ) : (
            <div className="grid gap-4 md:grid-cols-[minmax(260px,340px)_1fr]">
              <nav aria-label={t('asset.title')} className="self-start rounded-[5px] border border-line bg-white p-1">
                <ul role="tree" className="text-[13px]">
                  {areas.map((a) => <TreeArea key={a.id} a={a} open={open} toggle={toggle} sel={sel} onSel={setSel} />)}
                </ul>
                {admin && <AddArea onAdd={(name) => run.mutate(() => hierarchyApi.createArea(orgId!, site!.id, { name, code: slug(name) }))} />}
              </nav>
              <section aria-live="polite" className="min-w-0 rounded-[5px] border border-line bg-white p-4">
                {!found || !sel ? <p className="text-[13px] text-ink-68">{t('asset.pick')}</p> : (
                  <Detail sel={sel} node={found} areas={areas} lines={lines} admin={admin}
                    onMove={(label, fn) => setMove({ label, run: fn })}
                    onRun={(fn) => run.mutate(fn)} orgId={orgId!} siteId={site!.id} />
                )}
              </section>
            </div>
          )
        )}
      </div>
      {move && (
        <Confirm danger={false} title={t('asset.moveTitle', { to: move.label })} body={t('asset.moveBody')} confirm={t('asset.moveYes')}
          onNo={() => setMove(null)} onYes={() => { const m = move; setMove(null); run.mutate(m.run); }} />
      )}
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="shrink-0 rounded-full bg-line px-1.5 text-[10px] font-semibold text-ink-68">{n}</span>;
}

function Row({ id, level, sel, onSel, kind, label, tags, alarms, expandable, isOpen, toggle }: {
  id: string; level: number; sel: Sel | null; onSel: (s: Sel) => void; kind: Sel['kind']; label: string;
  tags: number; alarms: number; expandable?: boolean; isOpen?: boolean; toggle?: () => void;
}) {
  const { t } = useTranslation();
  const on = sel?.id === id;
  return (
    <li role="treeitem" aria-selected={on} aria-expanded={expandable ? isOpen : undefined}>
      <div className={`flex h-8 items-center gap-1 rounded pr-2 ${on ? 'bg-info-soft font-semibold text-blue' : 'hover:bg-subtle'}`} style={{ paddingLeft: 4 + level * 14 }}>
        {expandable ? (
          <button type="button" className="grid h-6 w-6 place-items-center text-ink-46" onClick={toggle} aria-label={t(isOpen ? 'asset.collapse' : 'asset.expand', { name: label })}>
            <Icon name={isOpen ? 'chevron-down' : 'chevron'} size={12} />
          </button>
        ) : <span className="w-6" />}
        <button type="button" className="min-w-0 flex-1 truncate text-left focus-visible:outline-2 focus-visible:outline-blue" onClick={() => onSel({ kind, id })}>{label}</button>
        {alarms > 0 && <span className="text-[10px] font-semibold text-danger" aria-label={t('asset.alarms', { count: alarms })}>◆ {alarms}</span>}
        <Count n={tags} />
      </div>
    </li>
  );
}

function TreeArea({ a, open, toggle, sel, onSel }: { a: HArea; open: Set<string>; toggle: (id: string) => void; sel: Sel | null; onSel: (s: Sel) => void }) {
  return (
    <>
      <Row id={a.id} level={0} kind="area" label={a.name} tags={a.tags} alarms={a.alarms} sel={sel} onSel={onSel}
        expandable isOpen={open.has(a.id)} toggle={() => toggle(a.id)} />
      {open.has(a.id) && a.lines.map((l) => (
        <ul key={l.id} role="group">
          <Row id={l.id} level={1} kind="line" label={l.name} tags={l.tags} alarms={l.alarms} sel={sel} onSel={onSel}
            expandable isOpen={open.has(l.id)} toggle={() => toggle(l.id)} />
          {open.has(l.id) && l.equipment.map((e) => (
            <ul key={e.id} role="group"><Row id={e.id} level={2} kind="equipment" label={e.name} tags={e.tags} alarms={e.alarms} sel={sel} onSel={onSel} /></ul>
          ))}
        </ul>
      ))}
    </>
  );
}

function AddForm({ placeholder, onAdd, className = '' }: { placeholder: string; onAdd: (name: string) => void; className?: string }) {
  const { t } = useTranslation();
  const [v, setV] = useState('');
  return (
    <form className={`flex gap-1 ${className}`} onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}>
      <input className="input h-7 min-w-0 flex-1 text-[12px]" value={v} maxLength={120} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button type="submit" className="btn btn-sm btn-ghost" disabled={!v.trim()}><DdIcon name="plus" size={12} /> {t('asset.add')}</button>
    </form>
  );
}

function AddArea({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useTranslation();
  return <AddForm className="border-t border-line p-2" placeholder={t('asset.newArea')} onAdd={onAdd} />;
}

function Detail({ sel, node, areas, lines, admin, onMove, onRun, orgId, siteId }: {
  sel: Sel; node: Node; areas: HArea[]; lines: LineN[]; admin: boolean;
  onMove: (label: string, fn: () => Promise<unknown>) => void;
  onRun: (fn: () => Promise<unknown>) => void; orgId: string; siteId: string;
}) {
  const { t } = useTranslation();
  const n = node as HArea & HLine & HEquipment;
  const parentId = sel.kind === 'line' ? (node as LineN).area.id : sel.kind === 'equipment' ? (node as EquipN).line.id : '';
  const targets = sel.kind === 'line' ? areas.map((a) => ({ id: a.id, label: a.name }))
    : sel.kind === 'equipment' ? lines.map((l) => ({ id: l.id, label: `${l.area.name} › ${l.name}` })) : [];
  const childKind = sel.kind === 'area' ? 'line' : sel.kind === 'line' ? 'equipment' : null;
  return (
    <div className="space-y-4 text-[13px]">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t(`asset.level.${sel.kind === 'line' ? n.kind : sel.kind}`)}</p>
        <h2 className="text-[16px] font-semibold">{n.name}</h2>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="text-ink-46">{t('asset.tags')}</dt><dd className="font-mono">{n.tags}</dd>
        <dt className="text-ink-46">{t('asset.alarmsOpen')}</dt><dd className="font-mono">{n.alarms}</dd>
        {sel.kind === 'equipment' && <><dt className="text-ink-46">{t('asset.parts3d')}</dt><dd className="font-mono">{n.parts}</dd></>}
      </dl>
      {sel.kind === 'equipment' && n.tags > 0 && <Link className="text-blue hover:underline" to="/tags">{t('asset.seeTags')}</Link>}
      {admin && (
        <div className="space-y-3 border-t border-line pt-3">
          {sel.kind === 'equipment' && (
            <label className="flex items-center gap-2">{t('asset.kind')}
              <select className="input h-7 text-[12px]" value={n.kind ?? ''} onChange={(e) => onRun(() => hierarchyApi.moveDevice(orgId, siteId, sel.id, { kind: e.target.value }))}>
                <option value="" disabled>—</option>
                {KINDS.map((k) => <option key={k} value={k}>{t(`asset.eqKind.${k}`)}</option>)}
              </select>
            </label>
          )}
          {sel.kind === 'line' && (
            <label className="flex items-center gap-2">{t('asset.kind')}
              <select className="input h-7 text-[12px]" value={n.kind} onChange={(e) => onRun(() => hierarchyApi.moveLine(orgId, siteId, sel.id, { kind: e.target.value as LineKind }))}>
                {(['line', 'cell', 'unit'] as const).map((k) => <option key={k} value={k}>{t(`asset.level.${k}`)}</option>)}
              </select>
            </label>
          )}
          {targets.length > 0 && (
            <label className="flex flex-wrap items-center gap-2">{t('asset.moveTo')}
              <select className="input h-7 max-w-full text-[12px]" value="" onChange={(e) => {
                const to = targets.find((x) => x.id === e.target.value);
                if (!to) return;
                onMove(to.label, () => sel.kind === 'line'
                  ? hierarchyApi.moveLine(orgId, siteId, sel.id, { area_id: to.id })
                  : hierarchyApi.moveDevice(orgId, siteId, sel.id, { line_id: to.id }));
              }}>
                <option value="" disabled>{t('asset.choose')}</option>
                {targets.filter((x) => x.id !== parentId).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          )}
          {childKind && (
            <AddForm placeholder={t(`asset.new.${childKind}`)} onAdd={(nm) => onRun(() => childKind === 'line'
              ? hierarchyApi.createLine(orgId, siteId, { name: nm, area_id: sel.id })
              : hierarchyApi.createDevice(orgId, siteId, { name: nm, line_id: sel.id }))} />
          )}
          {sel.kind === 'area' && n.lines.length === 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRun(() => hierarchyApi.deleteArea(orgId, siteId, sel.id))}>{t('asset.deleteArea')}</button>
          )}
        </div>
      )}
    </div>
  );
}
