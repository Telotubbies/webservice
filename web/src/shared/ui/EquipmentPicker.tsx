// "Which equipment?" — one picker for every page. Reads the site's plant-model
// parts (lib/equipment) and keeps the choice across pages. Renders nothing when
// the site has no mapped equipment yet.

import { useTranslation } from 'react-i18next';
import { useEquipment } from '../../lib/equipment';
import '../../features/assets/i18n';

export function EquipmentPicker({ onChange }: { onChange?: (tags: string[] | null) => void }) {
  const { t } = useTranslation();
  const { items, groups, current, select } = useEquipment();
  if (items.length === 0 && groups.length === 0) return null;
  const areas = groups.filter((g) => g.kind === 'area');
  const lines = groups.filter((g) => g.kind === 'line');
  const tagsOf = (id: string) => items.find((x) => x.id === id)?.tags ?? groups.find((x) => x.id === id)?.tags ?? null;
  const kinds = [...new Set(items.map((e) => e.kind))].sort();
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-46">
      {t('equipment.label')}
      <select
        className="input h-7 max-w-[220px] text-[12px]"
        value={current?.id ?? ''}
        aria-label={t('equipment.label')}
        onChange={(e) => {
          const id = e.target.value || null;
          select(id);
          onChange?.(id ? tagsOf(id) : null);
        }}
      >
        <option value="">{t('equipment.all')}</option>
        {areas.length > 0 && <optgroup label={t('asset.scopeAreas')}>{areas.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</optgroup>}
        {lines.length > 0 && <optgroup label={t('asset.scopeLines')}>{lines.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</optgroup>}
        {kinds.map((k) => (
          <optgroup key={k} label={k}>
            {items.filter((e) => e.kind === k).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
