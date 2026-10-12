# Industrial Dashboard — SDLC Documentation

Datadog-grade industrial monitoring + control dashboard for the Aggregate project.
Deploys to AWS, reads/writes Factory I/O (Modbus TCP) today, Siemens PLC (S7/OPC UA) tomorrow — behind a protocol-abstraction edge bridge.

## Documents

| # | File | Scope |
|---|---|---|
| 00 | [overview](00-overview.md) | Vision, personas, scope, success criteria |
| 01 | [requirements](01-requirements.md) | FR/NFR, MoSCoW prioritization |
| 02 | [architecture](02-architecture.md) | C4 levels, data flow, Purdue placement, deployment view |
| 03 | [tech-stack](03-tech-stack.md) | ADRs + tradeoff tables (MQTT, TimescaleDB, FastAPI, React+Vite SPA, ECS…) |
| 04 | [edge-bridge](04-edge-bridge.md) | `TagAdapter` contract, Modbus/S7/OPC UA/sim, tag mapping YAML, store-and-forward |
| 05 | [data-model](05-data-model.md) | MQTT topics (UNS), `TagValue`/`Command` schemas, Postgres + Timescale schema |
| 06 | [api-realtime](06-api-realtime.md) | REST + WebSocket contracts, command lifecycle state machine, auth flow |
| 07 | [ui-design-system](07-ui-design-system.md) | Datadog density × Mitsubishi HMI tokens, page specs, mimic SVG assets |
| 08 | [security](08-security.md) | Cognito RBAC, OT safety boundary, STRIDE threat model, IEC 62443 map |
| 09 | [testing](09-testing.md) | Test pyramid, integration/contract/E2E/load/security tests, DoD |
| 10 | [aws-deployment](10-aws-deployment.md) | VPC/ECS/RDS/IoT Core topology, IoT policy, CI/CD, envs, cost estimate |
| 11 | [roadmap](11-roadmap.md) | Sprint 0–5 with exit criteria + deferred items |
| 12 | [aggregate-integration](12-aggregate-integration.md) | Vision service (yolo26n-seg) → MQTT → dashboard wiring |
| 13 | [business-case](13-business-case.md) | Build-vs-buy (ราคาจริง), ต้นทุน, risk register, เหตุผลธุรกิจของทุก ADR |
| 14 | [real-world-cases](14-real-world-cases.md) | Auditable research log — community/industry lessons → design changes |
| 15 | [uat-signoff](15-uat-signoff.md) | Adversarial review → P0/P1 remediation → UAT evidence, per-role sign-off, pre-AWS blockers |
| 16 | [command-safety-contract](16-command-safety-contract.md) | Server gates, lifecycle `accepted→dispatched→acknowledged…`, outbox, audit |
| 17 | [mqtt-security-contract](17-mqtt-security-contract.md) | v2 topics, per-edge dynsec identity, ACL lifecycle, reconciliation |
| 18 | [release-recovery](18-release-recovery.md) | Migrations, SQLite→PG, backup/restore, rotation, rollback |
| ADR | [adr/](adr/) | ADR-12 auth (OIDC/Keycloak), ADR-13 tenant isolation, ADR-14 frontend/design system |

## Key Decisions (locked)

- **Protocol**: Factory I/O via **Modbus TCP server** (Factory I/O is the server; we are the client). Future PLC via S7 (snap7) or OPC UA — same adapter interface. Two topologies: **Mode A** edge→Factory I/O ตรง (bring-up) / **Mode B** edge→OpenPLC→Factory I/O (PLC-in-the-loop, ดู 04 §1.5).
- **Cloud transport**: MQTT → AWS IoT Core (X.509 device cert, TLS).
- **Control**: two-way. Every command has lifecycle (issued→sent→done/denied/timeout), idempotency key, audit record. Safety interlocks live in PLC — this system never bypasses.
- **Tag naming**: `site.area.line.device.signal` — one name end-to-end (YAML → MQTT → DB → UI).
- **Quality**: every value carries `good|bad|stale|uncertain` — bad data is never shown as real.

## Repo layout target

```
services/edge-bridge/      services/backend/      services/vision-inference/
apps/dashboard/            infra/terraform/        SDLC/industrial-dashboard/
```

## Open items (not blocking coding)

- Siemens model + firmware → decides S7 vs OPC UA adapter
- Factory I/O scene + tag addresses → `tags.modbus.yaml`
- AWS account/region, domain name
- Camera source for vision service (file/RTSP/USB)
