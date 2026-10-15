// CSV export (F14) — RFC-4180 quoting (embedded " , \r \n), a \uFEFF BOM so
// Excel reads the sheet as UTF-8, and a blob/object-URL anchor download that
// revokes its URL after the click.

export interface CsvColumn {
  key: string;
  label: string;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(cols: CsvColumn[], rows: Record<string, unknown>[]): string {
  const head = cols.map((c) => quote(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => quote(cell(r[c.key]))).join(','));
  return [head, ...body].join('\r\n');
}

export function downloadCsv(
  filename: string,
  cols: CsvColumn[],
  rows: Record<string, unknown>[],
): void {
  const blob = new Blob(['\uFEFF' + toCsv(cols, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
