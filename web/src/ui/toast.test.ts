import { expect, test } from 'bun:test';
import { expire, pushToast, type ToastItem } from './toast';

const t = (id: string): ToastItem => ({ id, tone: 'info', text: id, ttlMs: 4000 });

test('newest first, capped', () =>
  expect(pushToast([t('a'), t('b'), t('c'), t('d')], t('e')).map((x) => x.id)).toEqual(['e', 'a', 'b', 'c']));
test('same id replaces', () => expect(pushToast([t('a')], { ...t('a'), text: 'x' })).toHaveLength(1));
test('a replaced toast moves to the top with its new text', () =>
  expect(pushToast([t('a'), t('b')], { ...t('b'), text: 'x' })[0]).toMatchObject({ id: 'b', text: 'x' }));
test('expires after ttl', () => expect(expire([t('a')], 5000, new Map([['a', 0]]))).toHaveLength(0));
test('stays before ttl', () => expect(expire([t('a')], 3000, new Map([['a', 0]]))).toHaveLength(1));
test('crit toasts never expire on their own', () =>
  expect(expire([{ ...t('a'), tone: 'crit' }], 60_000, new Map([['a', 0]]))).toHaveLength(1));
