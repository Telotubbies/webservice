import { describe, expect, it } from 'bun:test';
import { dismissKey, progress, visible } from './steps';

const step = (done: boolean) => ({ done });

describe('onboarding steps', () => {
  it('progress counts done steps', () => {
    expect(progress([step(true), step(false), step(true)])).toEqual({ done: 2, total: 3 });
    expect(progress([])).toEqual({ done: 0, total: 0 });
  });

  it('visible hides when dismissed or complete', () => {
    const partial = [step(true), step(false)];
    const doneAll = [step(true), step(true)];
    expect(visible(partial, false)).toBe(true);
    expect(visible(partial, true)).toBe(false);   // browser-local dismissal
    expect(visible(doneAll, false)).toBe(false);  // finished -> self-hides
    expect(visible([], false)).toBe(false);
  });

  it('dismissKey is per-org so one tenant cannot hide another tenant\'s card', () => {
    expect(dismissKey('org-a')).not.toBe(dismissKey('org-b'));
    expect(dismissKey('org-a')).toBe('wds.onb.dismissed:org-a');
  });
});
