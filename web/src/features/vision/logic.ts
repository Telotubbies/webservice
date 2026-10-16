// Pure helpers for the Models and class-configuration UI (unit-tested in logic.test.ts).

export const MAX_MODEL_BYTES = 500 * 1024 * 1024;

export interface ClassEntry {
  enabled: boolean; names: { en: string; th: string }; min_score: number; colour: string; alert: boolean;
}
export type ClassConfig = Record<string, ClassEntry>;
export interface ClassDiff { added: number[]; removed: number[]; renamed: number[] }

export function modelFileError(f: { name: string; size: number }): 'type' | 'size' | null {
  const ext = f.name.includes('.') ? f.name.toLowerCase().split('.').pop() : '';
  if (ext !== 'onnx' && ext !== 'pt') return 'type';
  return f.size > 0 && f.size <= MAX_MODEL_BYTES ? null : 'size';
}

export function namesFromText(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function nameCountError(names: string[], expected: number | null): { got: number; expected: number | null } | null {
  if (names.length === 0) return { got: 0, expected };
  return expected != null && names.length !== expected ? { got: names.length, expected } : null;
}

export function classRows(classes: string[], cfg: ClassConfig): (ClassEntry & { id: string; name: string })[] {
  // a class without a config entry yet (config still loading) is skipped, never half-rendered
  return classes.flatMap((name, i) => (cfg[String(i)] ? [{ id: String(i), name, ...cfg[String(i)] }] : []));
}

export function patchClass(cfg: ClassConfig, id: string, patch: Partial<ClassEntry>): ClassConfig {
  return { ...cfg, [id]: { ...cfg[id], ...patch } };
}

export const scoreOk = (s: number): boolean => Number.isFinite(s) && s >= 0.05 && s <= 0.95;

export function diffSummary(d: ClassDiff | null | undefined): { added: number; removed: number; renamed: number } | null {
  if (!d) return null;
  const s = { added: d.added.length, removed: d.removed.length, renamed: d.renamed.length };
  return s.added + s.removed + s.renamed === 0 ? null : s;
}
