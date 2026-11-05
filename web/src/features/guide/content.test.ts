import { expect, test } from 'bun:test';
import { GUIDE } from './content';

test('EN and TH guides have the same sections, roles, links and step counts', () => {
  const shape = (lang: 'en' | 'th') => GUIDE[lang].map((s) => [s.id, s.part, s.roles, s.steps.length, s.links.map((l) => l.to), !!s.note]);
  expect(shape('th')).toEqual(shape('en'));
});

test('section ids are unique and glossary rows are "term — definition"', () => {
  for (const lang of ['en', 'th'] as const) {
    const ids = GUIDE[lang].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GUIDE[lang].find((s) => s.id === 'glossary')!.steps) expect(g.split(' — ')).toHaveLength(2);
  }
});

test('bold markers are balanced so no label renders half-bold', () => {
  for (const lang of ['en', 'th'] as const) {
    for (const s of GUIDE[lang]) for (const step of s.steps) expect(step.split('**').length % 2).toBe(1);
  }
});
