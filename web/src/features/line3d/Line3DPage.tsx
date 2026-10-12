// /line3d — isometric three.js twin of the line. SUPPLEMENTARY to the 2D
// mimic (doc 22 §6: 3D helps spatial lookup, 2D stays primary). Selection
// works exactly like /line: click → ?eq=<id> → global faceplate.

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EQUIPMENT, type EquipmentId } from '../../lib/plant';
import { LineScene } from './LineScene';
import './line3d.css';

export function Line3DPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const sel = params.get('eq') as EquipmentId | null;
  const selected = EQUIPMENT.some((e) => e.id === sel) ? sel : null;
  const select = (id: EquipmentId | null) => {
    const next = new URLSearchParams(params);
    // ?fp wins over ?eq — clear it so a canvas click always takes effect
    if (id && id !== selected) { next.set('eq', id); next.delete('fp'); }
    else next.delete('eq');
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('line3d.title')}</h1>
          <p className="lede">{t('line3d.lede')}</p>
        </div>
      </header>
      <section className="panel line3d-panel">
        <LineScene selected={selected} onSelect={select} />
      </section>
    </div>
  );
}
