// OIDC (ADR-12): Authorization Code + PKCE through oidc-client-ts.
//
// - Authority is <origin>/realms/<realm> — nginx proxies the IdP same-origin,
//   so iss == authority and the CSP stays `connect-src 'self'`.
// - Tokens live in memory only (InMemoryWebStorage) — a reload re-auths
//   through the Keycloak SSO cookie via signinSilent (hidden iframe).
// - automaticSilentRenew keeps the 5-min access token fresh; every user load
//   swaps the session token and bumps authRev so gates re-render.
// - dev mode (`/api/auth/config` -> dev_tokens) also offers the dev-token
//   sign-in for UAT; the wall shows SSO when oidc config is present.

import {
  InMemoryWebStorage, User, UserManager, WebStorageStateStore,
} from 'oidc-client-ts';
import { getToken, setSessionToken, setUnauthorizedHandler } from '../../lib/api';
import { live } from '../../lib/live';

export interface AuthConfig {
  env: string;
  dev_tokens: boolean;
  oidc: { realm: string; client_id: string } | null;
  /** brokered IdPs configured in Keycloak, e.g. ["google"]; absent = none */
  idps?: string[];
}

const SILENT_PATH = '/auth/silent-callback';
const CALLBACK_PATH = '/auth/callback';

let cfg: AuthConfig | null = null;
let mgr: UserManager | null = null;
let initPromise: Promise<AuthConfig> | null = null;

export function authConfig(): AuthConfig | null {
  return cfg;
}

export function oidcEnabled(): boolean {
  return cfg?.oidc != null;
}

export function isCallbackPath(pathname: string): boolean {
  return pathname === CALLBACK_PATH || pathname === SILENT_PATH;
}

/** Fetch the auth bootstrap + build the UserManager. Idempotent — safe under
 * StrictMode double-mount. */
export function initAuth(): Promise<AuthConfig> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const r = await fetch('/api/auth/config');
      cfg = (await r.json()) as AuthConfig;
    } catch {
      // backend unreachable — dev-shaped config keeps the dev wall usable
      cfg = { env: 'dev', dev_tokens: true, oidc: null };
    }
    if (cfg?.oidc) {
      mgr = new UserManager({
        authority: `${location.origin}/realms/${cfg.oidc.realm}`,
        client_id: cfg.oidc.client_id,
        redirect_uri: `${location.origin}${CALLBACK_PATH}`,
        silent_redirect_uri: `${location.origin}${SILENT_PATH}`,
        post_logout_redirect_uri: location.origin,
        response_type: 'code',
        scope: 'openid profile email',
        automaticSilentRenew: true,
        // ADR-12 §2: memory only — never localStorage/sessionStorage
        userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
      });
      mgr.events.addUserLoaded((u: User) => {
        if (u.access_token) {
          setSessionToken(u.access_token);
          live.bumpAuth();
        }
      });
      mgr.events.addUserUnloaded(() => {
        setSessionToken('');
        live.bumpAuth();
      });
      mgr.events.addSilentRenewError(() => {
        // the connection's exp clock closes the WS at exp+30s; the next API
        // 401 drops the session. Nothing extra to do here.
      });
      setUnauthorizedHandler(() => {
        setSessionToken('');
        live.bumpAuth();
      });
    } else {
      setUnauthorizedHandler(() => {
        setSessionToken('');
        live.bumpAuth();
      });
    }
    return cfg;
  })();
  return initPromise;
}

/** Run the redirect/silent callback on the matching route. Returns true once
 * the callback was consumed (caller navigates home). */
export async function completeRedirectCallback(pathname: string): Promise<boolean> {
  if (!mgr) return false;
  try {
    if (pathname === CALLBACK_PATH) {
      await mgr.signinRedirectCallback();
    } else if (pathname === SILENT_PATH) {
      await mgr.signinSilentCallback();
    }
    return true;
  } catch {
    return false;
  }
}

let restorePromise: Promise<boolean> | null = null;

/** Restore a session after reload: an in-memory user, else a silent renew
 * against the IdP SSO cookie. Bounded — a hung IdP must not wedge the boot.
 * Singleton: StrictMode double-effects must not race two signinSilent calls. */
export function restoreSession(): Promise<boolean> {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    if (!mgr) return getToken() !== '';
    try {
      const m = mgr;
      const user = await Promise.race([
        (async () => (await m.getUser()) ?? (await m.signinSilent()))(),
        new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
      ]);
      if (user?.access_token && !user.expired) {
        setSessionToken(user.access_token);
        live.bumpAuth();
        return true;
      }
    } catch {
      // no SSO session — the wall is the honest answer
    }
    return getToken() !== '';
  })();
  return restorePromise;
}

/** For the WS 4401 path: get a fresh access token or report dead session. */
export async function ensureFreshToken(): Promise<boolean> {
  if (!mgr) return false; // dev tokens never expire — a 4401 means real failure
  try {
    const user = await mgr.signinSilent();
    if (user?.access_token) {
      setSessionToken(user.access_token);
      live.bumpAuth();
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

export function signInWithSSO(): Promise<void> | undefined {
  return mgr?.signinRedirect();
}

/** kc_idp_hint makes Keycloak skip its chooser and go straight to Google. */
export function signInWithGoogle(): Promise<void> | undefined {
  return mgr?.signinRedirect({ extraQueryParams: { kc_idp_hint: 'google' } });
}

export function signOutSSO(): Promise<void> | undefined {
  setSessionToken('');
  live.bumpAuth();
  return mgr?.signoutRedirect();
}
