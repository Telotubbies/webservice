import { expect, test } from 'bun:test';
import { outcomeOf } from './commandOutcome';

// identity-ish t: returns "key|json(params)" so the test pins which message and values are used
const t = ((k: string, p?: Record<string, unknown>) => (p ? `${k}|${JSON.stringify(p)}` : k)) as never;

test('only done/acknowledged is success', () => {
  expect(outcomeOf(t, 'done', 'readback_ok:40').tone).toBe('ok');
  expect(outcomeOf(t, 'acknowledged').tone).toBe('ok');
});

test('read-back mismatch is not successful and shows both values', () => {
  const o = outcomeOf(t, 'failed', 'readback_mismatch:expected=32,actual=40');
  expect(o.tone).toBe('bad');
  expect(o.text).toContain('"expected":"32"');
  expect(o.text).toContain('"actual":"40"');
});

test('timeout and unknown never read as success', () => {
  expect(outcomeOf(t, 'timeout').tone).toBe('bad');
  expect(outcomeOf(t, 'unknown', 'readback_unavailable:quality_bad').tone).toBe('warn');
});

test('refusals and in-flight states', () => {
  expect(outcomeOf(t, 'denied', 'out_of_range').tone).toBe('bad');
  expect(outcomeOf(t, 'sent').tone).toBe('wait');
});
