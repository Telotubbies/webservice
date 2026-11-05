// Concrete batching plant (Centrale a Beton): names, units and equipment for
// the `batch` area tags, derived from the tag path so all 81 signals of the
// demo plant read as words in Thai and English. Mirrors
// backend/app/ops/concrete.py (equipment) and edge-bridge/tags.yaml (tags).
// Pure — no i18n runtime; lib/plant.ts registers the labels.

export type L = { en: string; th: string };

const SITE = 'plant1';
const tag = (p: string) => `${SITE}.batch.${p}`;

/** Tags the UI refers to by name. */
export const BATCH = {
  auto: tag('plant.auto.enabled'),
  cycles: tag('plant.auto.cycle_count'),
  stage: tag('plant.auto.stage'),
  step: tag('plant.auto.step'),
  m3Total: tag('plant.production.m3_total'),
  rate: tag('plant.production.rate_m3h'),
  aggTarget: tag('plant.recipe.agg_target_kg'),
  cemTarget: tag('plant.recipe.cem_target_kg'),
  waterTarget: tag('plant.recipe.water_target_kg'),
  mixerRun: tag('mix.mixer1.running'),
  mixerCurrent: tag('mix.mixer1.current_a'),
  mixerDoor: tag('mix.mixer1.door_open'),
  trucks: tag('mix.truck.count'),
  truckPresent: tag('mix.truck.present'),
  aggWeight: tag('agg.weigh1.weight_kg'),
  cemWeight: tag('cem.weigh1.weight_kg'),
  waterWeight: tag('liq.weigh1.weight_kg'),
  skipPos: tag('agg.skip1.position_pct'),
  blowerPressure: tag('air.blower1.pressure_bar'),
  filterDp: tag('air.filter1.dp_mbar'),
  waterTank: tag('liq.tank1.level_pct'),
  silo: (i: number) => tag(`cem.silo${i}.level_pct`),
  bin: (i: number) => tag(`agg.bin${i}.level_pct`),
} as const;

/** Batch-cycle step names, indexed by `plant.auto.step`. */
export const STEP_LABEL: L[] = [
  { en: 'Idle', th: 'รอ' },
  { en: 'Weighing aggregates', th: 'ชั่งหิน' },
  { en: 'Weighing cement', th: 'ชั่งปูน' },
  { en: 'Weighing water', th: 'ชั่งน้ำ' },
  { en: 'Charging the mixer', th: 'ป้อนเข้าโม่' },
  { en: 'Mixing', th: 'ผสม' },
  { en: 'Discharging', th: 'ปล่อยคอนกรีต' },
];

// device id (without its number) per area -> equipment name
const DEVICE: Record<string, Record<string, L>> = {
  agg: {
    bin: { en: 'Aggregate bin', th: 'ถังหิน' },
    belt: { en: 'Belt conveyor', th: 'สายพาน' },
    skip: { en: 'Skip hoist', th: 'สกิปลิฟต์' },
    weigh: { en: 'Skip weigher', th: 'ถังชั่งหิน' },
  },
  cem: {
    silo: { en: 'Cement silo', th: 'ไซโลปูน' },
    screw: { en: 'Cement screw', th: 'สกรูลำเลียงปูน' },
    weigh: { en: 'Cement weigh hopper', th: 'ถังชั่งปูน' },
  },
  liq: {
    tank: { en: 'Water tank', th: 'ถังน้ำ' },
    water: { en: 'Water valve', th: 'วาล์วน้ำ' },
    pump: { en: 'Water pump', th: 'ปั๊มน้ำ' },
    weigh: { en: 'Liquid weigher', th: 'ถังชั่งน้ำ' },
    admix: { en: 'Admixture pump', th: 'ปั๊มน้ำยาผสม' },
    drum: { en: 'Admixture drum', th: 'ถังน้ำยาผสม' },
  },
  air: {
    blower: { en: 'Roots blower', th: 'โบลเวอร์' },
    fill: { en: 'Silo fill line', th: 'ท่อเติมไซโล' },
    filter: { en: 'Mixer dust filter', th: 'ตัวกรองฝุ่น' },
  },
  mix: {
    mixer: { en: 'Mixer', th: 'โม่ผสม' },
    truck: { en: 'Truck lane', th: 'ช่องรถโม่' },
  },
};

// devices the plant has several of carry their number in the name
const NUMBERED = new Set(['bin', 'belt', 'silo', 'screw', 'drum']);

const SIGNAL: Record<string, L> = {
  level_pct: { en: 'level', th: 'ระดับ' },
  gate_open: { en: 'gate open', th: 'ประตูเปิด' },
  low_level: { en: 'low level', th: 'ระดับต่ำ' },
  high_level: { en: 'high level', th: 'ระดับสูง' },
  running: { en: 'running', th: 'ทำงาน' },
  speed_mps: { en: 'speed', th: 'ความเร็ว' },
  weight_kg: { en: 'weight', th: 'น้ำหนัก' },
  position_pct: { en: 'position', th: 'ตำแหน่ง' },
  moving: { en: 'moving', th: 'กำลังเคลื่อนที่' },
  motor_temp_c: { en: 'motor temperature', th: 'อุณหภูมิมอเตอร์' },
  filling: { en: 'filling', th: 'กำลังเติม' },
  open: { en: 'open', th: 'เปิด' },
  flow_lpm: { en: 'flow', th: 'อัตราไหล' },
  discharging: { en: 'discharging', th: 'กำลังปล่อย' },
  pressure_bar: { en: 'pressure', th: 'ความดัน' },
  flowing: { en: 'flowing', th: 'มีการไหล' },
  active: { en: 'active', th: 'ทำงาน' },
  dp_mbar: { en: 'differential pressure', th: 'ความดันตกคร่อม' },
  current_a: { en: 'motor current', th: 'กระแสมอเตอร์' },
  door_open: { en: 'discharge door open', th: 'ประตูปล่อยเปิด' },
  present: { en: 'truck present', th: 'มีรถรอ' },
  count: { en: 'trucks loaded', th: 'จำนวนรถที่บรรจุ' },
};

// plant-wide signals: named by the signal alone
const PLANT: Record<string, L> = {
  'auto.enabled': { en: 'Auto mode', th: 'โหมดอัตโนมัติ' },
  'auto.cycle_count': { en: 'Batches', th: 'จำนวนแบตช์' },
  'auto.stage': { en: 'Cycle time', th: 'เวลาในรอบ' },
  'auto.step': { en: 'Batch step', th: 'ขั้นตอนแบตช์' },
  'production.m3_total': { en: 'Concrete produced', th: 'คอนกรีตที่ผลิต' },
  'production.rate_m3h': { en: 'Production rate', th: 'อัตราการผลิต' },
  'recipe.agg_target_kg': { en: 'Aggregate target', th: 'เป้าหมายหิน' },
  'recipe.cem_target_kg': { en: 'Cement target', th: 'เป้าหมายปูน' },
  'recipe.water_target_kg': { en: 'Water target', th: 'เป้าหมายน้ำ' },
};

const UNIT: [RegExp, string, number][] = [
  [/_pct$/, '%', 0], [/_mps$/, 'm/s', 2], [/_kg$/, 'kg', 0], [/_c$/, '°C', 1],
  [/_lpm$/, 'L/min', 0], [/_mbar$/, 'mbar', 1], [/_bar$/, 'bar', 2], [/_a$/, 'A', 1],
  [/^m3_total$/, 'm³', 1], [/^rate_m3h$/, 'm³/h', 1], [/^stage$/, 's', 0],
];

export interface BatchSignal { label: L; unit?: string; decimals: number; equipment: string }

/** Name, unit and owner equipment of a `batch` tag; null for anything else. */
export function batchSignal(name: string): BatchSignal | null {
  const p = name.split('.');
  if (p[0] !== SITE || p[1] !== 'batch' || p.length !== 5) return null;
  const [, , area, dev, leaf] = p;
  const u = UNIT.find(([re]) => re.test(leaf));
  const unit = u?.[1];
  const decimals = u?.[2] ?? 0;
  if (area === 'plant') {
    const label = PLANT[`${dev}.${leaf}`];
    return label ? { label, unit, decimals, equipment: 'plant.controller' } : null;
  }
  const m = /^([a-z]+)(\d*)$/.exec(dev);
  const kind = m && DEVICE[area]?.[m[1]];
  const sig = SIGNAL[leaf];
  if (!kind || !sig) return null;
  const eq = equipmentName(`${area}.${dev}`);
  return { label: { en: `${eq.en} ${sig.en}`, th: `${eq.th} ${sig.th}` }, unit, decimals, equipment: `${area}.${dev}` };
}

export interface BatchEquipment { id: string; label: L; signals: string[] }

/** Equipment of the plant that owns at least one of `tags`, in tag order. */
export function batchEquipment(tags: string[]): BatchEquipment[] {
  const out = new Map<string, BatchEquipment>();
  for (const t of tags) {
    const s = batchSignal(t);
    if (!s) continue;
    let e = out.get(s.equipment);
    if (!e) {
      const name = equipmentName(s.equipment);
      e = { id: s.equipment, label: name, signals: [] };
      out.set(s.equipment, e);
    }
    e.signals.push(t);
  }
  return [...out.values()];
}

/** "cem.silo3" -> Cement silo 3. */
export function equipmentName(id: string): L {
  if (id === 'plant.controller') return { en: 'Batch controller', th: 'ตัวควบคุมแบตช์' };
  const [area, dev] = id.split('.');
  const m = /^([a-z]+)(\d*)$/.exec(dev ?? '');
  const kind = m && DEVICE[area]?.[m[1]];
  if (!kind) return { en: id, th: id };
  return NUMBERED.has(m[1]) ? { en: `${kind.en} ${m[2]}`, th: `${kind.th} ${m[2]}` } : kind;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** Every tag of the batching plant, in tags.yaml order (a test keeps them equal). */
export const BATCH_TAGS: string[] = [
  ...['auto.enabled', 'auto.cycle_count', 'auto.stage', 'auto.step', 'production.m3_total', 'production.rate_m3h',
    'recipe.agg_target_kg', 'recipe.cem_target_kg', 'recipe.water_target_kg'].map((s) => tag(`plant.${s}`)),
  ...range(4).flatMap((i) => ['level_pct', 'gate_open', 'low_level'].map((s) => tag(`agg.bin${i}.${s}`))),
  ...range(6).flatMap((i) => ['running', 'speed_mps'].map((s) => tag(`agg.belt${i}.${s}`))),
  tag('agg.weigh1.weight_kg'), tag('agg.skip1.position_pct'), tag('agg.skip1.moving'), tag('agg.skip1.motor_temp_c'),
  ...range(4).flatMap((i) => [...['level_pct', 'high_level', 'low_level', 'filling'].map((s) => tag(`cem.silo${i}.${s}`)), tag(`cem.screw${i}.running`)]),
  tag('cem.weigh1.weight_kg'), tag('cem.weigh1.level_pct'),
  tag('liq.tank1.level_pct'), tag('liq.tank1.low_level'), tag('liq.water1.open'),
  tag('liq.pump1.running'), tag('liq.pump1.flow_lpm'),
  tag('liq.weigh1.weight_kg'), tag('liq.weigh1.level_pct'), tag('liq.weigh1.discharging'),
  tag('liq.admix1.running'), tag('liq.admix1.flow_lpm'), tag('liq.drum1.level_pct'), tag('liq.drum2.level_pct'),
  tag('air.blower1.running'), tag('air.blower1.pressure_bar'), tag('air.fill1.flowing'),
  tag('air.filter1.active'), tag('air.filter1.dp_mbar'),
  tag('mix.mixer1.running'), tag('mix.mixer1.current_a'), tag('mix.mixer1.door_open'),
  tag('mix.truck.present'), tag('mix.truck.count'),
];
