// "Which equipment?" — one picker for every page. Reads the site's plant-model
// parts (lib/equipment) and keeps the choice across pages. Renders nothing when
// the site has no mapped equipment yet.

import { useTranslation } from 'react-i18next';
import { useEquipment } from '../../lib/equipment';

export function EquipmentPicker({ onChange }: { onChange?: (tags: string[] | null) => void }) {
  const { t } = useTranslation();
  const { items, current, select } = useEquipment();
  if (items.length === 0) return null;
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
          onChange?.(id ? (items.find((x) => x.id === id)?.tags ?? null) : null);
        }}
      >
        <option value="">{t('equipment.all')}</option>
        {kinds.map((k) => (
          <optgroup key={k} label={k}>
            {items.filter((e) => e.kind === k).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
