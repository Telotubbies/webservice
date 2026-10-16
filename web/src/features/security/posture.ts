// Security posture — computed from data the backend really has (org API keys,
// members, edge fleet, audit log). No scanner, no invented findings: every
// rule below is a predicate over a real resource, so "passed 8/12" means 8 of
// 12 actual keys/edges/members satisfy it. Admin-only sources (keys, members,
// audit) are simply absent for operators; their rules are skipped, not faked.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type ApiKey, type AuditRow, type Member } from '../../lib/api';
import { canAdmin, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { edgeState, useEdgeFleet, type FleetEdge } from '../health/fleet';

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const RULE_SEVERITIES: RuleSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
export type ResourceKind = 'api_key' | 'edge' | 'member' | 'org';

export interface Resource { id: string; kind: ResourceKind; name: string; detail?: string; to: string }
export interface SecRule {
  id: string;
  /** SOC-style control family the rule rolls up under */
  control: 'access' | 'credentials' | 'edge' | 'monitoring';
  ref: string;               // control id, e.g. "AC-1"
  severity: RuleSeverity;
  title: string;             // i18n key under sec.rules.*
  resourceKind: ResourceKind;
  passed: Resource[];
  failed: Resource[];
}

const DAY = 86_400_000;
const UNUSED_AFTER_DAYS = 90;
const isSvc = (m: Member) => m.sub.startsWith('dev:') || m.sub.startsWith('svc:');

export function buildRules(input: {
  keys: ApiKey[] | null; members: Member[] | null; audit: AuditRow[] | null; edges: FleetEdge[]; now: number;
}): SecRule[] {
  const { keys, members, audit, edges, now } = input;
  const out: SecRule[] = [];
  const split = <T,>(list: T[], ok: (x: T) => boolean, res: (x: T) => Resource) => ({
    passed: list.filter(ok).map(res), failed: list.filter((x) => !ok(x)).map(res),
  });

  if (keys) {
    const live = keys.filter((k) => !k.revoked_at);
    const keyRes = (k: ApiKey): Resource => ({ id: k.id, kind: 'api_key', name: k.name, detail: `${k.prefix}…`, to: '/admin/keys' });
    out.push({ id: 'key-expiry', control: 'credentials', ref: 'CR-1', severity: 'high', title: 'keyExpiry', resourceKind: 'api_key',
      ...split(live, (k) => !!k.expires_at, keyRes) });
    out.push({ id: 'key-unused', control: 'credentials', ref: 'CR-2', severity: 'medium', title: 'keyUnused', resourceKind: 'api_key',
      ...split(live, (k) => !!k.last_used_at && now - Date.parse(k.last_used_at) < UNUSED_AFTER_DAYS * DAY || now - Date.parse(k.created_at) < UNUSED_AFTER_DAYS * DAY, keyRes) });
    out.push({ id: 'key-admin', control: 'access', ref: 'AC-3', severity: 'medium', title: 'keyAdmin', resourceKind: 'api_key',
      ...split(live, (k) => k.role !== 'admin' && k.role !== 'owner', keyRes) });
  }
  if (members) {
    const memRes = (m: Member): Resource => ({ id: m.user_id, kind: 'member', name: m.display_name ?? m.email ?? m.sub, detail: m.role, to: '/admin/users' });
    const humans = members.filter((m) => !isSvc(m));
    out.push({ id: 'member-sso', control: 'access', ref: 'AC-1', severity: 'medium', title: 'memberSso', resourceKind: 'member',
      ...split(members.filter((m) => !m.disabled), (m) => !isSvc(m), memRes) });
    const owners = members.filter((m) => m.role === 'owner' && !m.disabled);
    out.push({ id: 'owner-count', control: 'access', ref: 'AC-2', severity: 'low', title: 'ownerCount', resourceKind: 'member',
      ...split(owners, () => owners.length <= 2, memRes) });
    out.push({ id: 'member-disabled-role', control: 'access', ref: 'AC-4', severity: 'info', title: 'memberDisabled', resourceKind: 'member',
      ...split(members.filter((m) => m.disabled), (m) => m.role === 'viewer' || m.role === 'none', memRes) });
    void humans;
  }
  const edgeRes = (e: FleetEdge): Resource => ({ id: e.id, kind: 'edge', name: e.name, detail: e.adapter ?? undefined, to: '/infrastructure' });
  const active = edges.filter((e) => e.status !== 'disabled');
  out.push({ id: 'edge-rotation', control: 'edge', ref: 'ED-1', severity: 'high', title: 'edgeRotation', resourceKind: 'edge',
    ...split(active, (e) => !e.needsRotation, edgeRes) });
  out.push({ id: 'edge-clock', control: 'edge', ref: 'ED-2', severity: 'medium', title: 'edgeClock', resourceKind: 'edge',
    ...split(active.filter((e) => e.clockOk !== null), (e) => e.clockOk === true, edgeRes) });
  out.push({ id: 'edge-online', control: 'edge', ref: 'ED-3', severity: 'low', title: 'edgeOnline', resourceKind: 'edge',
    ...split(active, (e) => edgeState(e, now) === 'online', edgeRes) });
  out.push({ id: 'edge-buffer', control: 'edge', ref: 'ED-4', severity: 'low', title: 'edgeBuffer', resourceKind: 'edge',
    ...split(active.filter((e) => e.bufferDepth !== null), (e) => (e.bufferDepth ?? 0) === 0, edgeRes) });
  if (audit) {
    const recent = audit.some((a) => now - Date.parse(a.at) < 7 * DAY);
    const org: Resource = { id: 'audit', kind: 'org', name: 'Audit log', to: '/admin/audit' };
    out.push({ id: 'audit-active', control: 'monitoring', ref: 'MN-1', severity: 'info', title: 'auditActive', resourceKind: 'org',
      passed: recent ? [org] : [], failed: recent ? [] : [org] });
  }
  return out.filter((r) => r.passed.length + r.failed.length > 0);
}

export interface Posture {
  rules: SecRule[]; score: number | null; admin: boolean; loading: boolean;
  bySeverity: Record<RuleSeverity, { passed: number; total: number }>;
  topFailures: SecRule[];
  audit: AuditRow[]; keys: ApiKey[]; members: Member[];
}

export function usePosture(): Posture {
  const admin = canAdmin(useRole());
  const { orgId } = useAdminOrg();
  const fleet = useEdgeFleet();
  const on = !!orgId && admin;
  const audit = useQuery({ queryKey: ['security-audit', orgId], queryFn: () => adminApi.audit(orgId!, { limit: 200 }), enabled: on });
  const keys = useQuery({ queryKey: ['security-keys', orgId], queryFn: () => adminApi.apiKeys(orgId!), enabled: on });
  const members = useQuery({ queryKey: ['security-members', orgId], queryFn: () => adminApi.members(orgId!), enabled: on });
  const loading = fleet.loading || (on && (audit.isLoading || keys.isLoading || members.isLoading));

  return useMemo(() => {
    const now = Date.now();
    const rules = buildRules({
      keys: on ? keys.data?.items ?? null : null, members: on ? members.data?.items ?? null : null,
      audit: on ? audit.data?.items ?? null : null, edges: fleet.edges, now,
    });
    const bySeverity = Object.fromEntries(RULE_SEVERITIES.map((s) => [s, { passed: 0, total: 0 }])) as Posture['bySeverity'];
    for (const r of rules) {
      bySeverity[r.severity].total += 1;
      if (r.failed.length === 0) bySeverity[r.severity].passed += 1;
    }
    const passedRules = rules.filter((r) => r.failed.length === 0).length;
    const topFailures = rules.filter((r) => r.failed.length > 0)
      .sort((a, b) => RULE_SEVERITIES.indexOf(a.severity) - RULE_SEVERITIES.indexOf(b.severity) || b.failed.length - a.failed.length)
      .slice(0, 3);
    return {
      rules, loading, admin, bySeverity, topFailures,
      score: rules.length ? Math.round((passedRules / rules.length) * 100) : null,
      audit: audit.data?.items ?? [], keys: keys.data?.items ?? [], members: members.data?.items ?? [],
    };
  }, [on, keys.data, members.data, audit.data, fleet.edges, loading, admin]);
}

/** One row per failed (rule, resource) pair — the unit the issue inbox and
 *  the findings explorer both list. */
export interface Finding { id: string; rule: SecRule; resource: Resource }
export function findingsOf(rules: SecRule[]): Finding[] {
  return rules.flatMap((rule) => rule.failed.map((resource) => ({ id: `${rule.id}:${resource.id}`, rule, resource })));
}

export const SEV_RANK = (s: RuleSeverity) => RULE_SEVERITIES.indexOf(s);
