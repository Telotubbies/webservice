import { Suspense, lazy, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, useLocation, useNavigate } from 'react-router';
import { api } from './lib/api';
import { live } from './lib/live';
import { startWS, stopWS } from './lib/ws';
import { useStore } from './lib/hooks';
import { Shell } from './app/Shell';
import {
  canOperate, getSessionRole, hasToken, refreshSession, useDenied,
} from './app/session';
import {
  completeRedirectCallback, initAuth, isCallbackPath, restoreSession,
} from './features/auth/oidc';
import { SignInWall } from './features/auth/SignInWall';
import { OverviewPage } from './features/overview/OverviewPage';
import { LinePage } from './features/line/LinePage';
import { AlarmsPage } from './features/alarms/AlarmsPage';
import { TrendsPage } from './features/trends/TrendsPage';
import { TagsPage } from './features/tags/TagsPage';
import { InsightsPage } from './features/insights/InsightsPage';
import { CommandsPage } from './features/commands/CommandsPage';
import { HealthPage } from './features/health/HealthPage';
import { AdminPage } from './features/admin/AdminPage';
import { AlarmRulesPage } from './features/admin/AlarmRulesPage';
import { UsersPage } from './features/admin/UsersPage';
import { AuditPage } from './features/admin/AuditPage';
import { ErrorState, PageSkeleton } from './shared/ui/Feedback';
import { CrashProbe, RouteBoundary, RouteError } from './shared/ui/ErrorBoundary';
import type { TagInfo } from './types';

// /line3d pulls in three (~160KB gz) — keep it out of the main chunk.
const Line3DPage = lazy(() => import('./features/line3d/Line3DPage').then((m) => ({ default: m.Line3DPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
});

/** Live-data bootstrap: REST snapshot → LiveStore, then WS stream + health polling. */
function useLiveBoot(tags: TagInfo[] | undefined) {
  const authRev = useStore(() => live.authRev);

  useEffect(() => {
    if (!tags) return;
    live.setTags(tags);
    void api.latestAll().then((rows) => rows.forEach((r) => live.pushTag(r.name, r.v, r.q, r.ts))).catch(() => {});
    void api.alarms().then((a) => live.setAlarms(a)).catch(() => {});
    void api.insights({ state: 'open' }).then((a) => live.setInsights(a)).catch(() => {});
  }, [tags]);

  useEffect(() => {
    // /api/system/health detail is operator+ (v4 T8) — viewers/anon get the
    // coarse /api/health + WS health events only. Fetching it under a viewer
    // session would 403 every poll and trip the zero-4xx gate.
    const poll = async () => {
      try { live.setHealth(await api.health()); } catch { live.setHealth(null); }
      if (canOperate(getSessionRole())) {
        try { live.setSysHealth(await api.systemHealth()); } catch { live.setSysHealth(null); }
      } else {
        live.setSysHealth(null);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 10_000);
    startWS();
    return () => { clearInterval(id); stopWS(); };
  }, []);

  // Role arrives asynchronously via refreshSession (/api/me) — re-poll the
  // detail endpoint the moment the session resolves so an operator doesn't
  // wait a full poll interval for the health page to populate.
  useEffect(() => {
    if (!canOperate(getSessionRole())) { live.setSysHealth(null); return; }
    api.systemHealth().then((h) => live.setSysHealth(h)).catch(() => live.setSysHealth(null));
  }, [authRev]);

  // command history is operator-only server-side: re-seed when the role changes
  useEffect(() => {
    if (!canOperate(getSessionRole())) return;
    void api.listCommands(20).then((cmds) => cmds.forEach((c) => live.mergeCommand(c))).catch(() => {});
  }, [authRev]);
}

function Root({ page }: { page: (tags: TagInfo[]) => JSX.Element }) {
  const q = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  if (q.isError) return <div className="page"><ErrorState onRetry={() => void q.refetch()} /></div>;
  // cold-start: shaped skeleton, not an empty table (v4 T12)
  if (q.isPending) return <PageSkeleton />;
  return page(q.data ?? []);
}

/** Mounted only when a session token exists — every query inside is
 * authenticated, so an unauthenticated load produces zero 401 traffic. */
function AuthedApp() {
  const q = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  useLiveBoot(q.data);
  useEffect(() => { void refreshSession(); }, []);
  return <Shell />;
}

/**
 * Auth gate (v4 T5): bootstrap the auth layer, restore the session, then
 * either render the app or the sign-in wall. No API traffic happens before
 * a token exists — the UAT's "zero unexpected 4xx" gate covers this.
 */
function Boot() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const denied = useDenied();
  useStore(() => live.authRev); // re-render when the session token changes

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initAuth();
      if (cancelled) return;
      if (isCallbackPath(loc.pathname)) {
        await completeRedirectCallback(loc.pathname);
        if (loc.pathname !== '/auth/silent-callback') {
          navigate('/', { replace: true });
        }
      } else {
        await restoreSession();
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hidden silent-renew iframe — boot the callback, render nothing
  if (loc.pathname === '/auth/silent-callback') return null;
  if (!ready || loc.pathname === '/auth/callback') {
    return <div className="auth-splash" />;
  }
  if (!hasToken() || denied) return <SignInWall denied={denied} />;
  return <AuthedApp />;
}

// Every page renders inside a route-level ErrorBoundary (v4 T12): a render
// crash shows the recovery block in place and leaves the shell alive;
// RouteError on the root is the last-resort catch for boot/lazy failures.
const B = (el: JSX.Element) => <RouteBoundary>{el}</RouteBoundary>;

const router = createBrowserRouter([
  {
    element: <Boot />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: B(<OverviewPage />) },
      { path: 'line', element: B(<LinePage />) },
      { path: 'line3d', element: B(<Suspense fallback={<PageSkeleton />}><Line3DPage /></Suspense>) },
      { path: 'alarms', element: B(<AlarmsPage />) },
      { path: 'trends', element: B(<Root page={(tags) => <TrendsPage tags={tags} />} />) },
      { path: 'insights', element: B(<InsightsPage />) },
      { path: 'tags', element: B(<Root page={(tags) => <TagsPage tags={tags} />} />) },
      { path: 'commands', element: B(<CommandsPage />) },
      { path: 'health', element: B(<HealthPage />) },
      // v4 T10 admin — role-gated inside the pages (nav hides them too)
      { path: 'admin', element: B(<AdminPage />) },
      { path: 'admin/rules', element: B(<AlarmRulesPage />) },
      { path: 'admin/users', element: B(<UsersPage />) },
      { path: 'admin/audit', element: B(<AuditPage />) },
      // v4 T12 UAT hook — a route that throws on render so the boundary's
      // recovery UI can be asserted end-to-end
      { path: 'crash-test', element: B(<CrashProbe />) },
      // OIDC redirect targets — Boot handles them before the children render
      { path: 'auth/callback', element: null },
      { path: 'auth/silent-callback', element: null },
      { path: '*', element: B(<OverviewPage />) },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
