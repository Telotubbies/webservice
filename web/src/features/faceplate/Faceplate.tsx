// Global tag-keyed faceplate panel (spec §3.3-B) — mounted once in the Shell,
// docked right inside .main, opened from any surface via FaceplateContext /
// ?fp=<tag>. Content adapts to the tag: mapped signals get equipment context,
// operable equipment gets controls; unknown/unmapped tags get a tag-level
// faceplate (PV + limits + trend + insights + commands) and never crash.

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge, fmtClock } from '../../lib/format';
import {
  bubbleCode, displayNumber, EQUIPMENT, equipmentOf, formatSignal, SIGNALS, T, unitOf,
} from '../../lib/plant';
import { Icon } from '../../shared/ui/Icon';
import { InsightChip } from '../../shared/ui/InsightChip';
import { Sparkline } from '../../shared/ui/Sparkline';
import {
  normSeverity, QualityMark, SeverityBadge, StatePill, type RunState, type Severity,
} from '../../shared/ui/Status';
import { useSignalLabel } from '../alarms/AlarmRows';
import { MotorControls } from '../line/EquipmentControls';
import { useFaceplate } from './FaceplateContext';
import './faceplate.css';

const CMD_GOOD = new Set(['done', 'acknowledged']);
const CMD_PENDING = new Set(['issued', 'sent', 'accepted', 'dispatched', 'acked']);

/** Alarm rules configured for one tag (same query key as OverviewPage's limits map). */
function useTagRules(tag: string) {
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });
  return useMemo(() => (q.data ?? []).filter((r) => r.tag === tag), [q.data, tag]);
}

export function FaceplatePanel() {
  const { activeTag, closeFaceplate } = useFaceplate();

  // Esc closes — unless a modal dialog (e.g. ConfirmCommand) is open on top.
  useEffect(() => {
    if (!activeTag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeFaceplate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTag, closeFaceplate]);

  if (!activeTag) return null;
  return <Faceplate tag={activeTag} onClose={closeFaceplate} />;
}

function Faceplate({ tag, onClose }: { tag: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  useStore(() => live.version);
  useStore(() => live.alarmRev);
  useStore(() => live.tagRev);
  const insightRev = useStore(() => live.insightRev);
  const cmdRev = useStore(() => live.cmdRev);
  const now = useNow(1000);
  const label = useSignalLabel();

  const meta = SIGNALS[tag]; // undefined → unknown/unmapped tag → tag-level fallback
  const eq = meta ? EQUIPMENT.find((e) => e.id === meta.equipment) : undefined;
  const info = live.tags.find((ti) => ti.name === tag);
  const unit = unitOf(tag, info?.unit);
  const v = live.latest.get(tag);
  const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;

  // worst open alarm severity on this tag (for the header badge)
  let worst: Severity | null = null;
  for (const a of live.alarms) {
    if (a.tag !== tag || a.state === 'cleared') continue;
    const s = normSeverity(a.severity);
    if (s === 'critical') { worst = 'critical'; break; }
    if (s === 'warning' || worst === null) worst = s;
  }

  const pill: RunState | null = stale
    ? 'stale'
    : typeof v?.v === 'boolean' ? (v.v ? 'running' : 'stopped') : null;

  const rules = useTagRules(tag);
  const hiLimit = useMemo(() => {
    let m: number | undefined;
    for (const r of rules) {
      if (r.enabled && r.threshold != null && (r.kind === 'hi' || r.kind === 'hihi')) {
        m = m === undefined ? r.threshold : Math.min(m, r.threshold);
      }
    }
    return m;
  }, [rules]);
  const scale = displayNumber(tag, 1); // ratio tags (gravel) render as percent

  const openInsights = useMemo(
    () => live.insights.filter((i) => i.tag === tag && i.state === 'open'),
    [tag, insightRev],
  );

  const tagCmds = useMemo(
    () => [...live.commands.values()]
      .filter((c) => c.tag === tag)
      .sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0))
      .slice(0, 5),
    [tag, cmdRev],
  );

  // Controls: only when the tag maps to operable equipment AND is writable.
  // MotorControls itself applies useControlGate and states the reason when
  // denied — the gate is unchanged, only its host panel moved here.
  const writable = info?.writable ?? (tag === T.running || tag === T.speedSp);
  const showControls = equipmentOf(tag) === 'motor' && writable;

  return (
    <aside className="faceplate" role="complementary" aria-label={t('faceplate.title')}>
      <header className="panel-head fp-head">
        <div className="fp-title">
          <h2 className="fp-name">{label(tag)}</h2>
          <span className="badge mono fp-bubble" title={tag}>{bubbleCode(tag)}</span>
          {eq && <span className="dim fp-eq">{t(eq.labelKey)}</span>}
          {(worst || pill) && (
            <span className="fp-flags">
              {worst && <SeverityBadge severity={worst} />}
              {pill && <StatePill state={pill} />}
            </span>
          )}
        </div>
        <div className="tools">
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div className="fp-body">
        {!meta && (
          <p className="hint fp-unknown">
            {t('faceplate.unknownTag')}: <span className="mono">{tag}</span>
          </p>
        )}

        <section className="fp-pv">
          <span className="fp-pv-num num">
            {stale ? '—' : formatSignal(tag, v?.v, i18n.language)}
          </span>
          {!stale && unit && <span className="fp-pv-unit">{unit}</span>}
          <span className="fp-pv-meta">
            <QualityMark q={v?.q} stale={stale && !!v} />
            <span className="hint">
              {v ? t('state.updated', { age: fmtAge(v.ts, now) }) : t('state.never')}
            </span>
          </span>
        </section>

        <section className="fp-sec">
          <h3>{t('faceplate.limits')}</h3>
          {rules.length === 0 ? (
            <p className="hint">{t('faceplate.noLimits')}</p>
          ) : (
            <ul className="fp-limits">
              {rules.map((r) => (
                <li key={r.name} className={r.enabled ? '' : 'is-off'}>
                  <SeverityBadge severity={r.severity} />
                  <span className="fp-rule-name">{r.name}</span>
                  <span className="mono fp-rule-val">
                    {r.kind === 'stale'
                      ? `${r.stale_s ?? '—'}s`
                      : `${r.kind.toUpperCase()} ${r.threshold ?? '—'}${unit ? ` ${unit}` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fp-sec">
          <h3>{t('faceplate.trend')}</h3>
          <div className="fp-spark"><Sparkline tag={tag} limit={hiLimit} scale={scale} /></div>
        </section>

        <section className="fp-sec">
          <h3>{t('faceplate.insights')}</h3>
          {openInsights.length === 0 ? (
            <p className="hint">{t('faceplate.noInsights')}</p>
          ) : (
            <ul className="fp-chips">
              {openInsights.map((i) => (
                <li key={i.id}>
                  <InsightChip
                    insight={i}
                    onClick={() => navigate(`/trends?s=${encodeURIComponent(i.tag)}&w=1H`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fp-sec">
          <h3>{t('faceplate.commands')}</h3>
          {tagCmds.length === 0 ? (
            <p className="hint">{t('faceplate.noCommands')}</p>
          ) : (
            <ul className="fp-cmds">
              {tagCmds.map((c) => {
                const tone = CMD_GOOD.has(c.status) ? 'ok' : CMD_PENDING.has(c.status) ? 'pending' : 'bad';
                return (
                  <li key={c.id}>
                    <span className={`cmd-result is-${tone}`}>
                      <span className="lc-dot" aria-hidden />{t(`lifecycle.${c.status}`)}
                    </span>
                    <span className="mono dim">{formatSignal(c.tag, c.value, i18n.language)}</span>
                    <span className="hint fp-cmd-ts">{fmtClock(c.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {showControls && <MotorControls />}
      </div>
    </aside>
  );
}
