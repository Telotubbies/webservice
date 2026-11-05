// Plant model for the UI: which signals belong to which equipment, how to
// label and format them. Tag names stay the backend contract; labels are
// i18n keys so nothing user-facing is a raw tag string.

import i18n from './i18n';
import { BATCH_TAGS, batchEquipment, batchSignal } from './concrete';

/** Equipment of the 2D sorting-line mimic (LinePage), the legacy contract plant. */
export type LineEquipmentId = 'motor' | 'conveyor' | 'camera' | 'bin';
/** Any equipment id: a line id above or a batching-plant device ("cem.silo3"). */
export type EquipmentId = string;

export interface SignalMeta {
  labelKey: string;
  unit?: string;
  decimals: number;
  /** display range for bars/gauges (not a safety limit) */
  range?: [number, number];
  equipment: EquipmentId;
  /** value is simulated / not from a real source yet */
  stub?: boolean;
}

export const T = {
  running: 'plant1.sort.line1.motor1.running',
  speedSp: 'plant1.sort.line1.motor1.speed_sp',
  beltSpeed: 'plant1.sort.line1.conv1.speed_mps',
  beltTemp: 'plant1.sort.line1.conv1.temp_c',
  binLevel: 'plant1.sort.line1.bin1.level_pct',
  gravel: 'plant1.sort.vision.cam1.gravel_ratio',
} as const;

export const SIGNALS: Record<string, SignalMeta> = {
  [T.running]: { labelKey: 'overview.lineState', decimals: 0, equipment: 'motor' },
  [T.speedSp]: { labelKey: 'overview.setpoint', unit: 'Hz', decimals: 1, range: [0, 60], equipment: 'motor' },
  [T.beltSpeed]: { labelKey: 'overview.beltSpeed', unit: 'm/s', decimals: 2, range: [0, 2], equipment: 'conveyor' },
  [T.beltTemp]: { labelKey: 'overview.motorTemp', unit: '°C', decimals: 1, range: [0, 100], equipment: 'conveyor' },
  [T.binLevel]: { labelKey: 'overview.binLevel', unit: '%', decimals: 0, range: [0, 100], equipment: 'bin' },
  [T.gravel]: { labelKey: 'overview.gravelRatio', unit: '%', decimals: 0, range: [0, 100], equipment: 'camera', stub: true },
};

export const LINE_EQUIPMENT: { id: LineEquipmentId; labelKey: string; signals: string[] }[] = [
  { id: 'motor', labelKey: 'line.motor', signals: [T.running, T.speedSp] },
  { id: 'conveyor', labelKey: 'line.conveyor', signals: [T.beltSpeed, T.beltTemp] },
  { id: 'camera', labelKey: 'line.camera', signals: [T.gravel] },
  { id: 'bin', labelKey: 'line.bin', signals: [T.binLevel] },
];

// ── Concrete batching plant (the demo site) ─────────────────────────────────
// Labels are generated from the tag path (lib/concrete.ts) and registered as
// i18n keys `sig.*` / `eq.*`, so every page that reads SIGNALS / EQUIPMENT
// shows the plant's own words in Thai and English.
const flat = (s: string) => s.replace(/\./g, '_');
{
  const en: Record<string, Record<string, string>> = { sig: {}, eq: {} };
  const th: Record<string, Record<string, string>> = { sig: {}, eq: {} };
  for (const tag of BATCH_TAGS) {
    const m = batchSignal(tag)!;
    en.sig[flat(tag)] = m.label.en;
    th.sig[flat(tag)] = m.label.th;
    SIGNALS[tag] = { labelKey: `sig.${flat(tag)}`, unit: m.unit, decimals: m.decimals, equipment: m.equipment };
  }
  for (const e of batchEquipment(BATCH_TAGS)) {
    en.eq[flat(e.id)] = e.label.en;
    th.eq[flat(e.id)] = e.label.th;
  }
  i18n.addResourceBundle('en', 'translation', en, true, true);
  i18n.addResourceBundle('th', 'translation', th, true, true);
}

/** Equipment of the plant, for filters, grouping and pickers. */
export const EQUIPMENT: { id: EquipmentId; labelKey: string; signals: string[] }[] =
  batchEquipment(BATCH_TAGS).map((e) => ({ id: e.id, labelKey: `eq.${flat(e.id)}`, signals: e.signals }));

const UNIT_ALIAS: Record<string, string> = { degC: '°C', ratio: '%' };

export function unitOf(name: string, fallback?: string): string | undefined {
  return SIGNALS[name]?.unit ?? (fallback ? UNIT_ALIAS[fallback] ?? fallback : undefined);
}

/** Engineering value for display. Ratio tags are shown as percent. */
export function displayNumber(name: string, v: number): number {
  return name === T.gravel ? v * 100 : v;
}

export function formatSignal(name: string, v: number | boolean | undefined, locale: string): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return i18n.t(v ? 'state.on' : 'state.off');
  if (!Number.isFinite(v)) return '—';
  const d = SIGNALS[name]?.decimals ?? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return displayNumber(name, v).toLocaleString(locale === 'th' ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
}

/** Last two path segments, human-ish: "conv1 temp_c" — fallback label. */
export function shortName(name: string): string {
  return name.split('.').slice(-2).join(' ').replace(/_/g, ' ');
}

export function equipmentOf(name: string): EquipmentId | undefined {
  return SIGNALS[name]?.equipment;
}

/** leaf substring -> ISA-5.1-style function letters for instrument bubbles */
const BUBBLE_LEAF: Record<string, string> = {
  temp: 'TT', speed: 'ST', level: 'LT', ratio: 'RT', running: 'XR', cam: 'VC',
};

/** Measurement signals get the loop number; `running` is a state flag, not a
 *  loop instrument, so it falls back to its raw SIGNALS position. */
const BUBBLE_SERIES = Object.keys(SIGNALS).filter((k) => k !== T.running);

/** ISA-5.1-flavor short code for bubble readouts, e.g. conv1.temp_c -> "TT-03".
 *  Pure: derived only from the tag leaf + the tag's position in SIGNALS. */
export function bubbleCode(tag: string): string {
  const leaf = tag.split('.').pop() ?? '';
  let prefix = `${(leaf[0] ?? 'x').toUpperCase()}X`;
  for (const [key, code] of Object.entries(BUBBLE_LEAF)) {
    if (leaf.includes(key)) {
      prefix = code;
      break;
    }
  }
  const i = BUBBLE_SERIES.indexOf(tag);
  const n = i >= 0 ? i + 1 : Math.max(0, Object.keys(SIGNALS).indexOf(tag) + 1);
  return `${prefix}-${String(n).padStart(2, '0')}`;
}
