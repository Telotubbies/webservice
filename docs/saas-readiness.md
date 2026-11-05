# SaaS readiness (as of 2026-10-16)

Status against the "customer-ready" list in
`docs/superpowers/specs/2026-10-16-saas-launch-roadmap.md` §1. **Present** means
the route or migration exists in the code; it does not mean the flow was run
end to end on a production host. Automated evidence so far: contract suite
979 passed, tenancy/RLS 63 passed, OpenAPI unchanged by the refactor.

| # | Customer can... | Status | Evidence / gap |
|---|---|---|---|
| 1 | Sign up, verify email, create an org | **Blocked** | `POST /api/v1/orgs` present; prod realm has `registrationAllowed` + `verifyEmail: true`, but **no SMTP server is configured** for Keycloak (realm) or in `.env.prod.example`, so verification mails cannot be sent |
| 2 | Enroll a gateway, add PLC/tags, see live values | Present | enroll codes, data-sources and tag routes; edge enroll flow has contract tests |
| 3 | Dashboards, alarm rules, phone alarm notification | Present, delivery path fixed today | notify channels, on-call, escalation, ack tokens present; `SELECT *` permission bug in the send path fixed (6a4647e). Needs a real email/LINE send test |
| 4 | Invite team with roles | Present, fixed today | invite insert was failing on a trigger bug (migration 0046) |
| 5 | KPIs (OEE, downtime), export a report | Present | `production/oee`, `production/reports`, report schedules |
| 6 | Choose a plan, pay, stay in limits | Limits present, **payment missing** | plans + 402 `plan_limit` enforcement; no payment provider code. Roadmap §10 already recommends manual invoicing for the first 1-3 pilots |
| 7 | Export/delete data, read terms and privacy | Partly | consents API, org export, soft-delete/restore, purge function present; Terms/Privacy page content not in repo |
| 8 | Upload YOLO model, pick classes, live detections drive PLC | Present | vision routes, converter sandbox, model server; real-image proof in commit 59aee73 |

## Launch blockers (need a decision or credentials from you)

1. **Email delivery.** Pick a provider (SES, SendGrid, or any SMTP). It is
   needed for Keycloak verification and reset mails, and for the backend
   `SMTP_*` settings used by notifications and scheduled reports.
2. **Production hosting.** Domain, TLS proxy, S3 for backups (`DEPLOY.md`).
   Rehearse one deploy and one restore before any customer.
3. **Legal text.** Terms of Service and Privacy Policy (PDPA) from counsel;
   the app records consent versions but ships no text.
4. **Payment** (optional for pilots): Stripe or Omise, plus Thai tax invoicing.
5. **External penetration test**, including the model upload path (roadmap §12).

## Engineering follow-ups (no decision needed)

- Run integration and security suites to completion against the rebuilt stack
  and record the result here (the integration suite is long; a run was still in
  progress when this was written).
- Add the missing `DEPLOY.md` rehearsal result and a monitored backup job alert.
- Multi-replica backend: rate limiter and WS hub are in-process (single replica).
- Replace the remaining `_m()` lookups with `deps` imports (ADR-0001 item 2).
