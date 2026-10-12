// Line view — full-width mimic. Selecting equipment sets ?eq=<id>, which the
// global FaceplateContext maps to the equipment's primary signal and opens the
// faceplate (spec §3.3-B); the old per-page Inspector is gone.

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EQUIPMENT, type EquipmentId } from '../../lib/plant';
import { LineSchematic } from './LineSchematic';

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
      <section className="panel schematic-panel">
        <LineSchematic selected={selected} onSelect={(id) => select(id)} />
      </section>
    </div>
  );
}
