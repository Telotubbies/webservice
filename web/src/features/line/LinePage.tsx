import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { EQUIPMENT, SIGNALS, formatSignal, type EquipmentId } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { Icon } from '../../shared/ui/Icon';
import { QualityMark, StatePill } from '../../shared/ui/Status';
import { LineSchematic } from './LineSchematic';
import { MotorControls } from './EquipmentControls';

function Inspector({ id, onClose }: { id: EquipmentId; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  useStore(() => live.version);
  const now = useNow(1000);
  const eq = EQUIPMENT.find((e) => e.id === id)!;
  return (
    <aside className="panel inspector" aria-label={t('line.inspector')}>
      <header className="panel-head">
        <h2>{t(eq.labelKey)}</h2>
        <div className="tools">
          <button className="icon-btn" onClick={onClose} aria-label={t('line.close')}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="panel-body flush">
        <ul className="signal-list">
          {eq.signals.map((name) => {
            const v = live.latest.get(name);
            const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;
            const meta = SIGNALS[name];
            return (
              <li key={name}>
                <span className="name">
                  {t(meta.labelKey)}
                  <span className="hint" style={{ display: 'block' }}>{v ? fmtAge(v.ts, now) : t('state.never')}</span>
                </span>
                <QualityMark q={v?.q} stale={stale} />
                {typeof v?.v === 'boolean' && !stale ? (
                  <StatePill state={v.v ? 'running' : 'stopped'} />
                ) : (
                  <span className="val">
                    {stale ? '—' : formatSignal(name, v?.v, i18n.language)}
                    {!stale && meta.unit && <span className="unit">{meta.unit}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {id === 'motor' && <MotorControls />}
      </div>
    </aside>
  );
}

export function LinePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const sel = params.get('eq') as EquipmentId | null;
  const selected = EQUIPMENT.some((e) => e.id === sel) ? sel : null;
  const select = (id: EquipmentId | null) => {
    const next = new URLSearchParams(params);
    if (id && id !== selected) next.set('eq', id); else next.delete('eq');
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('line.title')}</h1>
          <p className="lede">{t('line.lede')}</p>
        </div>
      </header>
      <div className={`line-layout${selected ? '' : ' no-inspector'}`}>
        <section className="panel schematic-panel">
          <LineSchematic selected={selected} onSelect={(id) => select(id)} />
        </section>
        {selected && <Inspector id={selected} onClose={() => select(null)} />}
      </div>
    </div>
  );
}
