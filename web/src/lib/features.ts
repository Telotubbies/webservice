// Feature flags for pages that still run on demo data. Dev shows everything;
// a prod build shows only real-data pages plus whatever VITE_FEATURES lists
// (comma-separated flag names, or "all").

const raw = (import.meta.env.VITE_FEATURES as string | undefined) ?? (import.meta.env.DEV ? 'all' : '');
const on = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));

export function enabled(flag?: string): boolean {
  return !flag || on.has('all') || on.has(flag);
}
