import { expect, test } from 'bun:test';
import { editEndGuard } from './gridEdit';

const field = {} as Element;
const other = {} as Element;

test('a blur after Enter or Esc does not commit the same edit a second time', () => {
  const g = editEndGuard();
  expect(g.claim(field)).toBe(false); // an ordinary blur is the commit
  g.mark(field); // the key handler committed (or cancelled) and moved focus
  expect(g.claim(field)).toBe(true); // the blur that follows is swallowed
  expect(g.claim(field)).toBe(false); // and only once
});

test('ending one edit does not swallow the next edit on another field', () => {
  const g = editEndGuard();
  g.mark(field);
  expect(g.claim(other)).toBe(false);
  expect(g.claim(field)).toBe(true);
});
