# IEC 62443 mapping — self-assessment

*Status: self-assessment, not a certification. Target: **SL 2** (IEC 62443-3-3 system requirements).
Updated each phase of the SCADA parity spec (`docs/superpowers/specs/2026-10-19-scada-parity-design.md`).*

## 1. Zones and conduits

```
 [Users zone]  browsers / PWA ──HTTPS (nginx CSP, HSTS)──┐
                                                         ▼
 [Cloud zone]  web · backend (FastAPI) · Postgres (RLS) · Keycloak · Garage
                                                         │
 [Conduit C1]  MQTT over TLS 1.2+, port 8883, dynsec ACL per edge, no anonymous
                                                         ▼
 [Edge zone]   edge-bridge (per site, enrolled identity, sealed cfg cache)
                                                         │
 [Conduit C2]  plant network: Modbus / S7 / OPC UA / BACnet / Sparkplug (local broker)
                                                         ▼
 [Control zone] PLCs, BACnet devices, third-party Sparkplug nodes
```

Rule: nothing in the Control zone talks to the Cloud zone directly. Third-party devices
(Sparkplug, BACnet) reach the cloud only through an enrolled edge (spec §9).

## 2. Foundational requirements (IEC 62443-3-3)

Status: **Met** · **Partial** · **Gap**

### FR1 — Identification and authentication control

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 1.1 | Human user identification & authentication | Met | Keycloak OIDC (`infra/keycloak*/realm-wds.json`); JWT verify `backend/app/iam/security.py` (`JwtVerifier`, alg allow-list, JWKS) |
| 1.1 RE1 | Unique identification | Met | `users.sub` = IdP subject; first-sight provisioning `Security._load_authz` |
| 1.1 RE2 | Multifactor for untrusted networks | Met | TOTP via realm flow `browser-loa` (LoA 2); org policy `organizations.mfa_required` enforced by `deps.mfa_gate` |
| 1.2 | Software process / device identification | Met | Edge enrollment + per-edge MQTT identity (`edge/enroll_codes.py`, `edge/dynsec.py`); API keys as service users (`api/api_keys.py`) |
| 1.3 | Account management | Met | Members/invites API, disable user, revoke key (`api/members.py`, `api/api_keys.py`) |
| 1.5 | Authenticator management | Partial | Keycloak password + OTP policy; API key secrets stored as sha256 only. Gap: MFA reset is a Keycloak admin-console task (backend holds no realm-admin credential on purpose) |
| 1.7 | Strength of password authentication | Met | Realm `passwordPolicy` length ≥ 12, not username/email; `bruteForceProtected` |
| 1.11 | Unsuccessful login attempts | Met | Keycloak brute-force protection |

### FR2 — Use control

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 2.1 | Authorization enforcement | Met | Roles owner/admin/operator/viewer (`deps._v2_org`), Postgres RLS on every tenant table (`migrations/0001`), API keys cannot mint keys |
| 2.1 RE2 | Permission mapping to roles | Met | CONTRACT.v2 §1 permission levels (`_READ/_OPERATE/_CONFIG`) |
| 2.1 RE4 | Dual approval | Planned P6 | Four-eyes approval for recipes and sequences |
| 2.4 | Mobile code | Met | CSP `script-src 'self'` (`web/nginx.conf`) |
| 2.5 | Session lock | Met | Keycloak SSO idle timeout; back-channel logout revokes `sid` (`revoked_sessions`) |
| 2.8 | Auditable events | Met | `audit_log` with hash chain (`backend/app/db/audit.py`), command lifecycle `command_events` |
| 2.12 | Non-repudiation | Partial | Every command carries `actor_user_id`; step-up (`deps.step_up`) proves fresh MFA at issue time. No electronic signatures |

### FR3 — System integrity

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 3.1 | Communication integrity | Met | TLS on HTTPS and MQTT 8883 (`infra/mosquitto.conf`) |
| 3.2 | Malicious code protection | Partial | Pickle scan for uploaded `.pt` models (`vision/ptscan.py`), GLB validation (`plant/glb.py`) |
| 3.3 | Security functionality verification | Met | `tests/security/` (auth bypass, BOLA, function-level), `tests/tenancy/` |
| 3.5 | Input validation | Met | Pydantic models on every route; tag path grammar CHECK; telemetry validation `TelemetryMsg` |
| 3.6 | Deterministic output | Partial | Edge holds last value on loss; command TTL 1–60 s; sequences go to Held on restart (P6) |

### FR4 — Data confidentiality

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 4.1 | Information confidentiality | Met | Tenant isolation by RLS; data-source secrets AES-GCM sealed (`datasources/secretbox.py`) |
| 4.2 | Information persistence | Partial | Org soft-delete + purge job (`tenancy/orgapi.py`); PWA must not cache API data (P4) |
| 4.3 | Use of cryptography | Met | TLS 1.2+, AES-GCM, sha256 key hashes |

### FR5 — Restricted data flow

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 5.1 | Network segmentation | Met (design) | Zones above; edge is the only conduit to control zone |
| 5.2 | Zone boundary protection | Partial | dynsec ACL limits each edge to its own topic subtree; egress guard for outbound notifications (`core/egress.py`) |

### FR6 — Timely response to events

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 6.1 | Audit log accessibility | Met | Audit API + page, `audit_cli` chain verification |
| 6.2 | Continuous monitoring | Partial | Observability module, edge heartbeat + clock check, alarm notifications |

### FR7 — Resource availability

| SR | Requirement | Status | Evidence |
|---|---|---|---|
| 7.1 | DoS protection | Met | Per-user mutation rate limit, per-tag command bucket, API-key rate per plan (`core/ratelimit.py`) |
| 7.3 | Control system backup | Met | `infra/backup/backup.sh`, pre-migration dumps |
| 7.4 | Recovery and reconstitution | Partial | Restore from dump; no documented RTO/RPO |
| 7.6 | Network and security configuration settings | Met | Prod fail-fast on missing/dev secrets (`core/config.py::_enforce_prod_env`) |

## 3. IEC 62443-4-1 (secure development) practices in place

- Threat model: `docs/security/storage-and-ai-threat-model.md`
- Security requirements in specs; ADRs for decisions (`docs/adr/`)
- Code review per PR; CI runs contract + security suites (`.github/workflows/ci.yml`)
- Pinned dependencies (`edge-bridge/requirements.txt`, `backend` lockfiles)
- Migrations never edited after apply (ADR-0001)

## 4. Gaps and plan

| Gap | Plan |
|---|---|
| MFA reset from the app | Kept in Keycloak console by design; document the runbook |
| Dual approval (SR 2.1 RE4) | P6 recipes/sequences |
| Area-level authorization | P1 `area_grants` |
| RTO/RPO not documented | Add to DEPLOY.md |
| BACnet/IP has no encryption | Keep BACnet inside the control zone; BACnet/SC later |
