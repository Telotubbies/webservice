import { describe, expect, test } from 'bun:test';
import { DEMO_PARTS } from './plantModel';
import { PLANT_KINDS as kinds } from '../../mock/data/plantKinds';
import { TAGS } from '../../mock/sim';

describe('demo skip hoist', () => {
  const skip = DEMO_PARTS.find((p) => p.label === 'Skip hoist')!;
  test('is a slider whose kind slides, with position + run bound to live tags', () => {
    expect(skip.kind).toBe('slider');
    expect((kinds as unknown as Record<string, { behavior: string }>).slider.behavior).toBe('slide');
    expect(skip.bindings.position).toBe('batch/agg/skip1/position_pct');
    expect(skip.bindings.run).toBe('batch/agg/skip1/moving');
    const tails = TAGS.map((t) => t.tail.replace(/\./g, '/'));
    expect(tails).toContain(skip.bindings.position);
    expect(tails).toContain(skip.bindings.run);
  });
});
