# 21 — Competitive Gap Analysis

Status: research finding, Oct 2026. Sources: 5-agent research sweep
(codebase inventory, industrial-SaaS competitors, observability platforms,
industrial AI landscape, B2B-SaaS platform surfaces).

## 1. Verdict

Our core is **defensible and partially differentiated**: the command-safety
lifecycle, hash-chained audit, forced-RLS isolation, and quality-gated
insight engine are things most demos and several real products lack. The
flatline/flapping detectors are genuinely ahead of observability tools
(nobody ships stuck-sensor detection for tag historians).

We are **not** yet a complete industrial SaaS. The gap list below is ordered
by how often it would kill an enterprise evaluation — not by wow factor.

## 2. What the v4 plan already covers (no new gap)

OIDC/SSO, anon-read removal, WS auth, rate limits, MQTT dynsec/TLS,
multi-org, admin UI, audit export, metrics, DR, kiosk mode, ⌘K, 3D view.

## 3. Missing must-haves (not in v4)

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| 1 | **Notification channels + escalation** | Alarms that only exist in-app are demo-grade. Every industrial product ships email/Slack/**LINE** (TH-critical)/webhook + escalation chains + ack journal. Top finding of both industrial and observability scans. | L |
| 2 | **Maintenance windows / silences** | Planned shutdowns are constant; without scoped suppression, operators learn to ignore the product. Datadog downtimes / Alertmanager silences. | S–M |
| 3 | **Retention tiers + downsampling + export** | `tag_history` is raw-only; historian-grade retention (raw 30–90d → 1m 1y → 1h 5y) + CSV/Parquet export is what "historian" means to buyers. TimescaleDB already deferred — this is where it lands. | M–L |
| 4 | **OEE / downtime analytics** | The #1 industrial KPI (Vorne/MachineMetrics/AVEVA lead with it). We have `running` state + history — auto run/down detection, reason codes, A/P/Q, Pareto is a bounded module on existing data. | L |
| 5 | **Scoped API tokens + service accounts + signed webhooks** | Integrations must survive employee churn; webhooks need HMAC + retry + delivery log (Stripe pattern). | M |
| 6 | **Robust/seasonal baseline for insights** | z-score vs EWMA is non-robust (spike corrupts baseline) and blind to shift/weekend cycles → false-positive flood. Median+MAD + daypart baselines = the industry-standard fix (S-H-ESD family). | S–M |
| 7 | **Composable alarms + dedup + flood control** | Alertstorm during process upset = trust loss. Need AND/OR conditions, `for` duration, grouping, renotify intervals, inhibition-lite. | M |
| 8 | **Guided onboarding + sample site** | demo→production hinge; empty org = dead trial. | S |
| 9 | **PDPA/GDPR deletion + per-org retention controls** | Thai enterprise compliance requirement, not optional. | S–M |
| 10 | **Status page + usage meters** | A monitoring vendor with no status page fails its own demo. Buy status page; meters = quota display pre-billing. | S |

## 4. Production blockers for real plants (not v4, likely v5)

- **OPC-UA + Modbus ingestion** — MQTT-only reads as demo-grade to any
  plant integrator; two drivers minimum.
- **Edge store-and-forward + fleet management** — offline buffering,
  remote config/health (Ignition EAM pattern); our edge currently has
  no offline buffer.
- **Multi-site rollup/benchmark UI** — RLS plumbing exists post-T9; needs
  cross-site KPI aggregation view.
- **Shift/PDF reports** — scheduled email; cheap, high demo value.
- **Andon scoreboard** — nearly free: fullscreen kiosk of existing ops wall.

## 5. Deliberately skip (field consensus)

Native SAML/SCIM (Keycloak brokers), query language (PromQL/NRQL), APM,
incident notebooks (lightweight timeline is enough), LLM copilot (ARC:
>65% of industrial copilots fail under real ops; deterministic+explainable
is a selling point), billing/metering internals, mobile native app
(responsive+push suffices), CMMS/work-orders beyond alarm→case-lite.

## 6. Recommendations

1. Keep v4 as approved — it closes the security/tenant layer everything
   else depends on.
2. Plan a **v5 "operations product"** batch after v4: notifications +
   silences + alarm dedup (3,2,7 fold together), OEE module, retention
   tiers + export, robust/seasonal baselines, API tokens + webhooks,
   onboarding. That batch is what turns us from "monitoring UI" into
   "the thing a plant runs on."
3. Cheap immediate wins inside v4 scope: kiosk mode already in T11
   doubles as Andon; audit export in T10 covers part of #3's export.
