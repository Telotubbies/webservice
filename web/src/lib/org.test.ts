import { expect, test } from 'bun:test';
import { pickInitialOrg } from './org';
import { scopeHeaders, setScope } from './scope';

const m = (id: string) => ({ org_id: id, org_name: id, role: 'owner', permissions: [] });

test('pickInitialOrg: stored org wins while still a membership', () => {
  expect(pickInitialOrg([m('a'), m('b')], 'b')?.org_id).toBe('b');
});

test('pickInitialOrg: stale stored id falls back to the first membership', () => {
  expect(pickInitialOrg([m('a'), m('b')], 'gone')?.org_id).toBe('a');
});

test('pickInitialOrg: no memberships -> null', () => {
  expect(pickInitialOrg([], 'a')).toBeNull();
});

test('scopeHeaders: empty without scope, org+site with one', () => {
  setScope(null);
  expect(scopeHeaders()).toEqual({});
  setScope({ orgId: 'o1', siteId: 's1', orgName: 'x', role: 'admin' });
  expect(scopeHeaders()).toEqual({ 'X-WDS-Org': 'o1', 'X-WDS-Site': 's1' });
  setScope(null);
});
