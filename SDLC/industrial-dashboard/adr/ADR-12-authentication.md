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
8. **CSRF**: the API authenticates only with the `Authorization: Bearer` header and no cookie credentials, so cross-site requests cannot carry them. As defense in depth, mutating endpoints and the WS handshake require `Origin` to be in `ALLOWED_ORIGINS`.
9. **Rate limiting**:
   - Keycloak brute-force detection covers login.
   - The API limits per `sub` and per client IP: token bucket, 20 mutating req/10s/user, 5 command req/10s/user/tag.
   - Client IP is taken from `X-Forwarded-For` **only** when the TCP peer is in `TRUSTED_PROXIES` (nginx). Otherwise the peer address is used.
10. **Dev seeding**: `make seed-dev` imports a realm with demo users (`owner@demo`, `operator@demo`, `viewer@demo`) **only when `APP_ENV=dev`**. Passwords come from `.env`, never from code.

## WebSocket authentication

See CONTRACT.v2 §WS:
- No credential in the URL.
- The first frame is `{"type":"auth","token":…,"site_id":…}`, sent within 5s, after an `Origin` check.
- The connection is bound to (`sub`, `sid`, `org_id`, `site_id`, permission snapshot) and ends at token `exp` + 30s unless the client sends `{"type":"reauth","token":…}`.
- Rights are revalidated on every `wds_authz` NOTIFY and every 60s. Loss of membership → close **4403**; session/user revoked or token expired → close **4401**.

## Threat model (STRIDE, auth surface)

| Threat | Mitigation | Test |
|---|---|---|
| Forged/altered JWT | RS256 + JWKS, alg allowlist, iss/aud | `tests/auth/test_jwt.py` |
| Algorithm confusion (`none`, HS256 with public key) | allowlist, the library never takes alg from the header | same |
| Stolen access token | 5-min TTL, kept in memory, revocation via `sid` + NOTIFY | `test_revocation.py` |
| Stolen refresh token | rotation + reuse detection in Keycloak; not persisted by the SPA | Keycloak realm config test (`test_realm_config.py` asserts the settings) |
| Disabled user still using a valid JWT | `users.disabled_at` checked per request | `test_revocation.py` |
| Removed member keeps acting | memberships checked per request, ≤5s cache | `test_revocation.py` |
| Token leaking through logs/URLs | no tokens in URLs; WS auth via frame; redacting log formatter; nginx logs `$uri` only | `tests/ws/test_no_token_in_logs.py` |
| CSRF / cross-origin WS hijack | bearer-only + Origin allowlist | `tests/auth/test_origin.py` |
| Brute force | Keycloak lockout + API rate limits behind trusted proxy only | `test_rate_limit.py` |

## Consequences

- A heavier compose stack (Keycloak ≈ 512 MB RAM).
- Password, reset, verify and MFA are Keycloak's problem. **We own** token verification, membership authorization, back-channel logout and the revocation SLA.
- Security review gate: phase 3 cannot exit until every test in the table above passes against the real Keycloak container.
