// Pure helpers for the onboarding card — kept separate so bun tests can
// exercise the progress/dismiss logic without a DOM.

import type { OnboardingStep } from '../../lib/api';

export const DISMISS_PREFIX = 'wds.onb.dismissed:';

export function dismissKey(orgId: string): string {
  return `${DISMISS_PREFIX}${orgId}`;
}

export function progress(steps: Pick<OnboardingStep, 'done'>[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/** Show the card? Hidden once the user dismisses it OR every step is done
 *  (a finished checklist collapses to nothing instead of nagging). */
export function visible(steps: Pick<OnboardingStep, 'done'>[], dismissed: boolean): boolean {
  return !dismissed && progress(steps).done < steps.length;
}
