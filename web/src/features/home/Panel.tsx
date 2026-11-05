// One Home panel: Datadog-style chrome (status stripe, header value or one
// value per series, table / full-screen / edit tools, customize bar) around
// a body chosen by the panel's visualization.

import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, equipmentOf, shortName } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { normSeverity } from '../../shared/ui/Status';
import { useAlarms } from '../alarms/alarms';
import { fmtNum, type Limit } from '../trends/viz';
import { aggOf, colorOf, isStatus, thToken, type Theme } from './chart';
import { HEIGHTS, WIDTHS, type Panel } from './model';
import { srcInfo, thresholdsOf, type Filters, type useHomeData, type Win } from './data';
import { PlotBody, StatBody, TableBody, type Series } from './Plot';
import { Ico } from './icons';

export interface PanelCtx {
  win: Win; theme: Theme; f: Filters; customize: boolean; rangeShort: string;
  data: ReturnType<typeof useHomeData>; limits: Map<string, Limit[]>;
}
export interface PanelOps {
  edit(): void; full(): void; table(): void; legend(src: string, toggle: boolean): void;
  move(dir: -1 | 1): void; resize(dir: -1 | 1): void; duplicate(): void; remove(): void; clearFilters(): void;
  dragStart(e: DragEvent): void; dragOver(e: DragEvent): void; drop(e: DragEvent): void; dragEnd(): void;
}

const BUCKETS = { line: 120, area: 120, bars: 60, stat: 60 } as const;

export function PanelView({ p, title, idx, count, ctx, st, on }: {
  p: Panel; title: string; idx: number; count: number; ctx: PanelCtx;
  st: { editing: boolean; full: boolean; table: boolean; over: boolean; dragging: boolean };
  on: PanelOps;
}) {
  const { t, i18n } = useTranslation();
  const isTs = p.viz in BUCKETS;
  const th = thresholdsOf(p, ctx.limits);
  const n = isTs ? BUCKETS[p.viz as keyof typeof BUCKETS] : 0;

  const all: Series[] = isTs ? p.series.map((r) => {
    const info = srcInfo(r.src, t);
    const d = ctx.data.get(r.src, n);
    return { info, token: r.color, color: colorOf(r.color, ctx.theme), hidden: !!r.hidden, cur: d.cur, prev: d.prev };
  }) : [];
  const shown = all.filter((s) => ctx.f.equip === 'all' || !s.info.equipment || s.info.equipment === ctx.f.equip);
  const vis = shown.filter((s) => !s.hidden);
  const unit = p.unit || all[0]?.info.unit || '';
  const dec = p.dec ?? all[0]?.info.dec ?? 1;
  const fmt = (v: number | null) => fmtNum(v, dec, i18n.language);

  // header value(s) and the value the stripe judges
  let single: { value: string; delta: string } | null = null;
  let judged: number | null = null;
  if (isTs && p.viz !== 'stat' && p.header === 'single' && vis.length) {
    const cur = aggOf(vis.map((s) => s.cur), p.agg);
    const prev = aggOf(vis.map((s) => s.prev), p.agg);
    judged = cur;
    const dlt = cur != null && prev != null ? cur - prev : null;
    single = {
      value: fmt(cur),
      delta: dlt == null ? '' : `${dlt >= 0 ? '↑ +' : '↓ −'}${fmt(Math.abs(dlt))}${unit === '%' ? ` ${t('home.pts')}` : unit ? ` ${unit}` : ''} ${t('home.vsPrev', { range: ctx.rangeShort })}`,
    };
  }
  if (judged == null && vis.length) {
    const lasts = vis.map((s) => aggOf([s.cur], p.viz === 'stat' ? p.agg : 'last')).filter((v): v is number => v != null);
    judged = lasts.length ? Math.max(...lasts) : null;
  }

  let stripe = 'transparent';
  if (p.stripe === 'custom') stripe = colorOf(p.stripeColor, ctx.theme);
  else if (p.stripe === 'auto') {
    if (th && judged != null) stripe = colorOf(thToken(th, judged) ?? 'info', ctx.theme);
    else {
      const sev = vis.filter((s) => (s.token === 'crit' || s.token === 'warn') && (aggOf([s.cur], 'sum') ?? 0) > 0).map((s) => s.token);
      if (sev.length) stripe = colorOf(sev.includes('crit') ? 'crit' : 'warn', ctx.theme);
      if (p.viz === 'alarms') stripe = alarmStripe(ctx, ctx.theme);
    }
  }

  const ci = WIDTHS.indexOf(p.cols);
  let body;
  if (isTs && !all.length) body = <Empty msg={t('home.emptyNoSignal')} />;
  else if (isTs && !shown.length) body = <Empty msg={t('home.emptyFiltered')} onClear={on.clearFilters} />;
  else if (p.viz === 'stat') body = <StatBody p={p} s={shown[0]} th={th} theme={ctx.theme} />;
  else if (isTs && st.table) body = <TableBody p={p} series={shown} win={ctx.win} />;
  // every visible series empty in the window: say so instead of drawing axes over nothing
  // (a real zero still plots — only null means "no data")
  else if (isTs && vis.length > 0 && vis.every((s) => s.cur.every((v) => v == null))) body = <Empty msg={t('home.emptyNoData')} />;
  else if (isTs) body = <PlotBody p={{ ...p, title }} series={shown} th={th} win={ctx.win} theme={ctx.theme} onLegend={on.legend} />;
  else if (p.viz === 'top') body = <TopBody ctx={ctx} color={colorOf(p.barColor, ctx.theme)} onClear={on.clearFilters} />;
  else body = <AlarmsBody ctx={ctx} onClear={on.clearFilters} />;

  return (
    <div
      className={`hm-cell hm-panel${st.full ? ' is-full' : ''}${st.editing ? ' is-editing' : ''}${st.over ? ' is-over' : ''}${st.dragging ? ' is-drag' : ''}`}
      style={{ '--span': p.cols, '--stripe': stripe, height: HEIGHTS[p.h] } as React.CSSProperties}
      draggable={ctx.customize} onDragStart={on.dragStart} onDragOver={on.dragOver} onDrop={on.drop} onDragEnd={on.dragEnd}
    >
      <div className="hm-ph">
        <div className="hm-ph-text">
          <h3 className="hm-ph-title" title={title}>{title}</h3>
          {single && (
            <div className="hm-single">
              <span className="hm-big">{single.value}</span><span className="hm-unit">{unit}</span>
              <span className="hm-delta">{single.delta}</span>
            </div>
          )}
          {isTs && p.viz !== 'stat' && p.header === 'perSeries' && (
            <div className="hm-per">
              {shown.map((s) => (
                <button key={s.info.src} type="button" className={`hm-per-b ${s.hidden ? 'off' : ''}`} aria-pressed={!s.hidden}
                  title={t('home.isolateHint')} onClick={(e) => on.legend(s.info.src, e.ctrlKey || e.metaKey)}>
                  <span className="hm-per-key" style={{ background: s.color }} />
                  <span className="hm-per-name">{s.info.label}</span>
                  <span className="hm-per-val" style={{ color: isStatus(s.token) ? colorOf(s.token, ctx.theme, true) : undefined }}>
                    {fmt(aggOf([s.cur], p.agg))}<span className="hm-unit"> {unit}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hm-tools-p">
          {isTs && p.viz !== 'stat' && (
            <button type="button" className={`hm-ib ${st.table ? 'on' : ''}`} aria-pressed={st.table}
              aria-label={t('home.asTable', { title })} title={t('home.asTable', { title })} onClick={on.table}><Ico name="table" size={15} /></button>
          )}
          <button type="button" className="hm-ib" aria-label={st.full ? t('home.exitFull') : t('home.fullscreen', { title })}
            title={st.full ? t('home.exitFull') : t('home.fullscreen', { title })} onClick={on.full}>
            <Ico name={st.full ? 'minimize' : 'maximize'} size={15} />
          </button>
          <button type="button" className="hm-ib" aria-label={t('home.edit', { title })} title={t('home.edit', { title })} onClick={on.edit}>
            <Ico name="pencil" size={15} />
          </button>
        </div>
      </div>
      <div className="hm-pb">{body}</div>
      {ctx.customize && (
        <div className="hm-ebar">
          <span className="hm-grip"><Ico name="grip" size={14} />{t('home.drag')}</span>
          <button type="button" className="hm-ib" disabled={idx === 0} aria-label={t('home.moveEarlier', { title })} title={t('home.moveEarlier', { title })} onClick={() => on.move(-1)}><Ico name="left" size={14} /></button>
          <button type="button" className="hm-ib" disabled={idx === count - 1} aria-label={t('home.moveLater', { title })} title={t('home.moveLater', { title })} onClick={() => on.move(1)}><Ico name="right" size={14} /></button>
          <span className="grow" />
          <button type="button" className="hm-ib" disabled={ci === 0} aria-label={t('home.narrower', { title })} title={t('home.narrower', { title })} onClick={() => on.resize(-1)}><Ico name="narrower" size={14} /></button>
          <span className="w">{t('home.widthOf', { n: p.cols })}</span>
          <button type="button" className="hm-ib" disabled={ci === WIDTHS.length - 1} aria-label={t('home.wider', { title })} title={t('home.wider', { title })} onClick={() => on.resize(1)}><Ico name="wider" size={14} /></button>
          <span className="grow" />
          <button type="button" className="hm-ib" aria-label={t('home.duplicate', { title })} title={t('home.duplicate', { title })} onClick={on.duplicate}><Ico name="copy" size={14} /></button>
          <button type="button" className="hm-ib" aria-label={t('home.remove', { title })} title={t('home.remove', { title })} onClick={on.remove}><Ico name="trash" size={14} /></button>
        </div>
      )}
    </div>
  );
}

function Empty({ msg, onClear }: { msg: string; onClear?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="hm-empty">
      <p>{msg}</p>
      {onClear && <button type="button" className="hm-btn sm" onClick={onClear}>{t('home.clearFilters')}</button>}
    </div>
  );
}

const GLYPH: Record<string, string> = { critical: '▲', warning: '◆', info: '●' };
const SEV_TOKEN: Record<string, string> = { critical: 'crit', warning: 'warn', info: 'info' };
const passes = (tag: string, sev: string, f: Filters) =>
  (f.equip === 'all' || equipmentOf(tag) === f.equip) && (f.sev === 'all' || sev === f.sev);

function alarmStripe(ctx: PanelCtx, theme: Theme): string {
  const open = live.alarms.filter((a) => a.state === 'active' && passes(a.tag, normSeverity(a.severity), ctx.f));
  const worst = open.some((a) => normSeverity(a.severity) === 'critical') ? 'crit'
    : open.some((a) => normSeverity(a.severity) === 'warning') ? 'warn' : null;
  return worst ? colorOf(worst, theme) : 'transparent';
}

function labelOf(tag: string, t: (k: string) => string) {
  const m = SIGNALS[tag];
  return m ? t(m.labelKey) : shortName(tag);
}

function TopBody({ ctx, color, onClear }: { ctx: PanelCtx; color: string; onClear: () => void }) {
  const { t } = useTranslation();
  useStore(() => live.alarmRev);
  const counts = new Map<string, number>();
  for (const a of live.alarms) {
    const ts = Date.parse(a.ts);
    if (ts < ctx.win.from || ts > ctx.win.to || !passes(a.tag, normSeverity(a.severity), ctx.f)) continue;
    counts.set(a.tag, (counts.get(a.tag) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) return <Empty msg={t('home.emptyTop')} onClear={ctx.f.equip !== 'all' || ctx.f.sev !== 'all' ? onClear : undefined} />;
  const max = rows[0][1];
  return (
    <div className="hm-top-list">
      {rows.map(([tag, c]) => (
        <div key={tag} className="hm-top-row">
          <span className="hm-top-label" title={labelOf(tag, t)}>{labelOf(tag, t)}</span>
          <span className="hm-top-bar" aria-hidden><span style={{ width: `${(c / max) * 100}%`, background: color }} /></span>
          <span className="hm-top-val">{c}</span>
        </div>
      ))}
    </div>
  );
}

function AlarmsBody({ ctx, onClear }: { ctx: PanelCtx; onClear: () => void }) {
  const { t } = useTranslation();
  const now = useNow(15_000);
  const role = useRole();
  const { open } = useAlarms();
  const [err, setErr] = useState<string | null>(null);
  const rows = open.filter((a) => passes(a.tag, normSeverity(a.severity), ctx.f)).slice(0, 12);
  if (!rows.length) return <Empty msg={t('home.emptyAlarms')} onClear={ctx.f.equip !== 'all' || ctx.f.sev !== 'all' ? onClear : undefined} />;
  const ack = (id: string | number) => { setErr(null); api.ackAlarm(id).catch((e: Error) => setErr(t('home.ackFailed', { why: e.message }))); };
  return (
    <div className="hm-alist">
      {err && <p className="hm-hint" role="alert">{err}</p>}
      {rows.map((a) => {
        const sev = normSeverity(a.severity);
        const acked = a.state !== 'active';
        return (
          <div key={a.id} className={`hm-arow ${acked ? 'acked' : ''}`}>
            <span className="hm-aglyph" style={{ color: colorOf(SEV_TOKEN[sev], ctx.theme, true) }}>
              <span aria-hidden>{GLYPH[sev]}</span><span className="sr">{t(`home.sev${sev[0].toUpperCase()}${sev.slice(1)}`)}</span>
            </span>
            <div style={{ minWidth: 0 }}>
              <Link to={`/alarms/${a.id}`} className="hm-amsg" style={{ display: 'block' }}>{labelOf(a.tag, t)} · {a.rule}</Link>
              <div className="hm-atag">{a.tag}</div>
            </div>
            <span className="hm-aage">{fmtAge(a.ts, now)}</span>
            {canOperate(role) && (
              <button type="button" className="hm-btn sm" disabled={acked} onClick={() => ack(a.id)}>{acked ? t('home.acked') : t('home.ack')}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
