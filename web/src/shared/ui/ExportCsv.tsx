// Export CSV button (F14). Rows are built lazily on click so a page never
// pays for the CSV shape on every render; the export always reflects the
// rows the page is currently showing (its filters), never a fresh fetch.

import { useTranslation } from 'react-i18next';
import { downloadCsv, type CsvColumn } from '../../lib/csv';
import { DdIcon } from './DdIcon';
import './explorerI18n';

const pad = (n: number) => String(n).padStart(2, '0');

/** `alarms-20261015-1402` — local time, sortable, no colons (Windows-safe). */
export function csvName(base: string, at = new Date()): string {
  return `${base}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
}

export function ExportCsvButton({ name, columns, rows, count }: {
  /** file base name; a timestamp is appended */
  name: string;
  columns: CsvColumn[];
  rows: () => Record<string, unknown>[];
  /** visible row count, for the tooltip and the disabled state */
  count: number;
}) {
  const { t } = useTranslation();
  const empty = count === 0;
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost csv-export"
      disabled={empty}
      title={empty ? t('xp.exportEmpty') : t('xp.exportTitle', { count })}
      onClick={() => downloadCsv(csvName(name), columns, rows())}
    >
      <DdIcon name="export" size={13} /> {t('xp.exportCsv')}
    </button>
  );
}
