# ADR-12 — Authentication: OIDC via Keycloak (backend verifies, never issues)

Status: **Accepted** (design review rev 2) · Supersedes: demo bearer tokens (`backend/app/auth.py`), doc 08 §1 Cognito-only wording

## Context

The product is now multi-tenant. Users can belong to several organizations, roles are scoped to an organization, and the public read-only mode is removed. The review rejected backend-native auth: we would own password storage, reset/verify flows, lockout, MFA and session incident response for good. The user chose to hand that ownership to a standard IdP.

## Decision

1. **Identity provider**: Keycloak (pinned image, realm `wds`) in docker compose. It owns credentials, email verification, password reset, brute-force lockout, MFA and SSO sessions. We use plain OIDC, so Keycloak can later be replaced with Cognito or any other OIDC IdP by changing only issuer/JWKS/audience config.
2. **Browser flow**: Authorization Code + **PKCE (S256)**, public client `web`, through `oidc-client-ts`. Tokens live **in memory only** (no localStorage/sessionStorage). Each tab gets its own token family by redirect/silent-renew against the Keycloak SSO cookie. There is no cross-tab shared refresh token, so concurrent refreshes in different tabs never collide.
3. **Refresh tokens**: Keycloak "Revoke Refresh Token" = ON, max reuse = 0. Reusing a rotated token revokes that session in Keycloak. The SPA does not keep refresh tokens after a reload; it re-authenticates through the SSO cookie.
4. **Access token**: lifetime **5 minutes**, RS256. It **carries no roles**. Authorization comes from our `memberships` table (ADR-13).
5. **Backend verification** (`core/security.py`):
   - Algorithm allowlist `["RS256"]`; anything else (`none`, `HS256` key confusion) → 401.
   - Required claims: `iss` == configured issuer, `aud` contains `wds-api`, `exp`, `nbf` (optional, checked if present), `iat`, `sub`, `sid`. Leeway 30s.
   - JWKS cached for 10 min. An unknown `kid` triggers one refetch, rate-limited to one every 30s, which supports key rollover.
6. **User record**: on first valid token, upsert `users(sub, email, display_name)`. `users.disabled_at` is ours: if set, every request → 401 even when the JWT is still valid.
7. **Revocation SLA**: an authorization change takes effect within **≤5s** for REST and open WebSockets.
   - The membership/permission cache (per process) has TTL 5s and is invalidated immediately by Postgres `NOTIFY wds_authz` (`membership_changed`, `user_disabled`, `session_revoked`).
   - Keycloak **back-channel logout** → `POST /api/v1/auth/backchannel-logout`. The `logout_token` JWT is verified (signature, `iss`, `aud`, `events` claim contains the back-channel-logout event, no `nonce`). That writes `revoked_sessions(sid, revoked_at)` and NOTIFYs. A request whose `sid` is revoked → 401.
   - NOTIFY is the millisecond path for open WebSockets, but Postgres drops notifications published while the `wds_authz` LISTEN connection is reconnecting. Two backstops bound that hole to one interval: the listener revalidates every connected client on each (re)subscribe, and a periodic **revalidation sweep** (`AUTHZ_SWEEP_S`, default 5 s) re-reads `revoked_sessions` + `users.disabled_at` + `memberships` for the connected sid/sub set — one batched sid probe, one batched disabled probe, one memberships read per distinct user — closing violators 4401/4403. The missed-notify worst case is the sweep interval, which is kept ≤ the SLA.
8. **CSRF**: the API authenticates only with the `Authorization: Bearer` header and no cookie credentials, so cross-site requests cannot carry them. As defense in depth, the WS handshake and every mutating `/api` request (`OriginGuardMiddleware`) that carries an `Origin` header must match `ALLOWED_ORIGINS` or be same-origin (`Origin` host == `Host`) — a mismatch → 403 / close 4403. A missing `Origin` is allowed: browsers always send it on cross-origin mutations, so absence means a non-browser client (curl, tests, the back-channel logout POST); see CONTRACT.v2 §2.
9. **Rate limiting**:
   - Keycloak brute-force detection covers login.
   - The API limits per `sub` and per client IP: token bucket, 60 mutating req/60s/user, 5 command req/10s/user+tag.
   - Client IP is taken from `X-Real-IP` **only** when the TCP peer is loopback or in `TRUSTED_PROXIES` (nginx). Otherwise the peer address is used. (`X-Forwarded-For` is never trusted — its first element is client-controlled.)
10. **Dev seeding**: `make seed-dev` imports a realm with demo users (`owner@demo`, `operator@demo`, `viewer@demo`) **only when `APP_ENV=dev`**. Passwords come from `.env`, never from code.

## WebSocket authentication

See CONTRACT.v2 §WS:
- No credential in the URL.
- The first frame is `{"type":"auth","token":…,"site_id":…}`, sent within 5s, after an `Origin` check.
- The connection is bound to (`sub`, `sid`, `org_id`, `site_id`, permission snapshot) and ends at token `exp` + 30s unless the client sends `{"type":"reauth","token":…}`.
- Rights are revalidated on every `wds_authz` NOTIFY, on every listener (re)subscribe, and by the periodic revalidation sweep (`AUTHZ_SWEEP_S`, default 5 s — the missed-NOTIFY backstop). Loss of membership → close **4403**; session/user revoked or token expired → close **4401**.

## Threat model (STRIDE, auth surface)

| Threat | Mitigation | Test |
|---|---|---|
| Forged/altered JWT | RS256 + JWKS, alg allowlist, iss/aud | `tests/contract/test_jwt_security.py` |
| Algorithm confusion (`none`, HS256 with public key) | allowlist, the library never takes alg from the header | same |
| Stolen access token | 5-min TTL, kept in memory, revocation via `sid` + NOTIFY + revalidation sweep | `tests/integration/test_oidc.py` |
| Stolen refresh token | rotation + reuse detection in Keycloak; not persisted by the SPA | realm config test (`tests/contract/test_jwt_security.py::test_realm_json_is_pkce_public_client` asserts the settings) |
| Disabled user still using a valid JWT | `users.disabled_at` checked per request + sweep | `tests/integration/test_oidc.py` |
| Removed member keeps acting | memberships checked per request, ≤5s cache + sweep | `tests/integration/test_oidc.py` |
| Token leaking through logs/URLs | no tokens in URLs; WS auth via frame; redacting log formatter; nginx logs `$uri` only | `tests/integration/test_ws.py::test_nginx_access_log_drops_query_string` |
| CSRF / cross-origin WS hijack | bearer-only + Origin allowlist (WS upgrade gate + `OriginGuardMiddleware` on mutations) | `tests/contract/test_ratelimit.py`, `tests/security/test_ws_admission.py`, `tests/integration/test_rest.py` |
| Brute force | Keycloak lockout + API rate limits behind trusted proxy only | `tests/integration/test_ratelimit.py` |

## Consequences

- A heavier compose stack (Keycloak ≈ 512 MB RAM).
- Password, reset, verify and MFA are Keycloak's problem. **We own** token verification, membership authorization, back-channel logout and the revocation SLA.
- Security review gate: phase 3 cannot exit until every test in the table above passes against the real Keycloak container.
