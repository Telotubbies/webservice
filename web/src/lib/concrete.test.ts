import { expect, test } from 'bun:test';
import { batchEquipment, batchSignal, BATCH, BATCH_TAGS } from './concrete';

test('a silo level reads as equipment + signal in both languages', () => {
  const m = batchSignal('plant1.batch.cem.silo3.level_pct')!;
  expect(m.label.en).toBe('Cement silo 3 level');
  expect(m.label.th).toBe('ไซโลปูน 3 ระดับ');
  expect(m.unit).toBe('%');
  expect(m.equipment).toBe('cem.silo3');
});

test('the same device id means different equipment in different areas', () => {
  expect(batchSignal('plant1.batch.agg.weigh1.weight_kg')!.label.en).toBe('Skip weigher weight');
  expect(batchSignal('plant1.batch.cem.weigh1.weight_kg')!.label.en).toBe('Cement weigh hopper weight');
  expect(batchSignal('plant1.batch.liq.weigh1.weight_kg')!.label.en).toBe('Liquid weigher weight');
});

test('plant-wide signals are named by the signal alone', () => {
  expect(batchSignal('plant1.batch.plant.production.rate_m3h')!.label.en).toBe('Production rate');
  expect(batchSignal('plant1.batch.plant.production.rate_m3h')!.unit).toBe('m³/h');
});

test('units and decimals follow the leaf suffix', () => {
  expect(batchSignal('plant1.batch.mix.mixer1.current_a')).toMatchObject({ unit: 'A', decimals: 1 });
  expect(batchSignal('plant1.batch.agg.belt4.speed_mps')).toMatchObject({ unit: 'm/s', decimals: 2 });
  expect(batchSignal('plant1.batch.agg.skip1.motor_temp_c')).toMatchObject({ unit: '°C', decimals: 1 });
  expect(batchSignal('plant1.batch.mix.mixer1.running')!.unit).toBeUndefined();
});

test('tags outside the batching plant are not described', () => {
  expect(batchSignal('plant1.sort.line1.conv1.temp_c')).toBeNull();
  expect(batchSignal('plant1.batch.unknown.thing1.level_pct')).toBeNull();
});

test('equipment list covers every device once, with its signals', () => {
  const eq = batchEquipment(['plant1.batch.cem.silo1.level_pct', 'plant1.batch.cem.silo1.low_level', 'plant1.batch.mix.mixer1.running']);
  expect(eq.map((e) => e.id)).toEqual(['cem.silo1', 'mix.mixer1']);
  expect(eq[0].signals).toHaveLength(2);
  expect(eq[0].label.en).toBe('Cement silo 1');
});

test('well-known tags are exported by name', () => {
  expect(BATCH.auto).toBe('plant1.batch.plant.auto.enabled');
  expect(BATCH.mixerCurrent).toBe('plant1.batch.mix.mixer1.current_a');
});

test('BATCH_TAGS lists exactly the batch tags of edge-bridge/tags.yaml, each with a name', async () => {
  const { readFileSync } = await import('node:fs');
  const yaml = readFileSync(new URL('../../../edge-bridge/tags.yaml', import.meta.url), 'utf8');
  const inYaml = [...yaml.matchAll(/^ {4}(batch\.[a-z0-9_.]+):\s*$/gm)].map((m) => `plant1.${m[1]}`);
  expect([...BATCH_TAGS].sort()).toEqual(inYaml.sort());
  expect(BATCH_TAGS.filter((t) => !batchSignal(t))).toEqual([]);
});
