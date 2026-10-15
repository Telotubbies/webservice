// App shell — auth boot (OIDC restore → sign-in wall) → live-data bootstrap
// (REST seed → WS stream + health polling) → routed console inside Shell.

import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { live } from './lib/live';
import { useStore } from './lib/hooks';
import { startWS, stopWS } from './lib/ws';
import { canOperate, getSessionRole, hasToken, refreshSession, useDenied } from './app/session';
import { initAuth, restoreSession, completeRedirectCallback, isCallbackPath, authConfig } from './features/auth/oidc';
import { signIn } from './app/session';
import { Shell } from './app/Shell';
import { SignInWall } from './features/auth/SignInWall';
import { Landing } from './features/landing/Landing';
import { RouteBoundary, RouteError } from './shared/ui/ErrorBoundary';
import { PageSkeleton } from './shared/ui/Feedback';
import { OverviewPage } from './features/overview/OverviewPage';
import type { TagInfo } from './types';
import { enabled } from './lib/features';

// Route-level code splitting: every non-index page lazy-loads so the main
// chunk stays small (three ~160KB gz and chart code stay out of it).
const LinePage = lazy(() => import('./features/line/LinePage').then((m) => ({ default: m.LinePage })));
const Line3DPage = lazy(() => import('./features/line3d/Line3DPage').then((m) => ({ default: m.Line3DPage })));
const AlarmsPage = lazy(() => import('./features/alarms/AlarmsPage').then((m) => ({ default: m.AlarmsPage })));
const AlarmDetailPage = lazy(() => import('./features/alarms/AlarmDetailPage').then((m) => ({ default: m.AlarmDetailPage })));
const TrendsPage = lazy(() => import('./features/trends/TrendsPage').then((m) => ({ default: m.TrendsPage })));
const InsightsPage = lazy(() => import('./features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })));
const TagsPage = lazy(() => import('./features/tags/TagsPage').then((m) => ({ default: m.TagsPage })));
const CommandsPage = lazy(() => import('./features/commands/CommandsPage').then((m) => ({ default: m.CommandsPage })));
const HealthPage = lazy(() => import('./features/health/HealthPage').then((m) => ({ default: m.HealthPage })));
const AdminPage = lazy(() => import('./features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const AlarmRulesPage = lazy(() => import('./features/admin/AlarmRulesPage').then((m) => ({ default: m.AlarmRulesPage })));
const RuleCreatePage = lazy(() => import('./features/admin/RuleCreatePage').then((m) => ({ default: m.RuleCreatePage })));
const UsersPage = lazy(() => import('./features/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const AuditPage = lazy(() => import('./features/admin/AuditPage').then((m) => ({ default: m.AuditPage })));
const ActivityPage = lazy(() => import('./features/notify/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const ErrorTrackingPage = lazy(() => import('./features/errors/ErrorTrackingPage').then((m) => ({ default: m.ErrorTrackingPage })));
const SloPage = lazy(() => import('./features/slo/SloPage').then((m) => ({ default: m.SloPage })));
const DowntimesPage = lazy(() => import('./features/downtimes/DowntimesPage').then((m) => ({ default: m.DowntimesPage })));
const DashboardsPage = lazy(() => import('./features/dashboards/DashboardsPage').then((m) => ({ default: m.DashboardsPage })));
const DashboardViewPage = lazy(() => import('./features/dashboards/DashboardsPage').then((m) => ({ default: m.DashboardViewPage })));
const DevicesPage = lazy(() => import('./features/devices/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const AddDeviceWizard = lazy(() => import('./features/devices/AddDeviceWizard').then((m) => ({ default: m.AddDeviceWizard })));
const AlarmQualityPage = lazy(() => import('./features/alarmquality/AlarmQualityPage').then((m) => ({ default: m.AlarmQualityPage })));
const AlarmSettingsPage = lazy(() => import('./features/alarmsettings/AlarmSettingsPage').then((m) => ({ default: m.AlarmSettingsPage })));
const EventsPage = lazy(() => import('./features/events/EventsPage').then((m) => ({ default: m.EventsPage })));
const IncidentsPage = lazy(() => import('./features/incidents/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const NotebooksPage = lazy(() => import('./features/notebooks/NotebooksPage').then((m) => ({ default: m.NotebooksPage })));
const NotebookViewPage = lazy(() => import('./features/notebooks/NotebooksPage').then((m) => ({ default: m.NotebookViewPage })));
const CatalogPage = lazy(() => import('./features/catalog/CatalogPage').then((m) => ({ default: m.CatalogPage })));
const LogsPage = lazy(() => import('./features/logs/LogsPage').then((m) => ({ default: m.LogsPage })));
const TeamsPage = lazy(() => import('./features/teams/TeamsPage').then((m) => ({ default: m.TeamsPage })));
const TracesPage = lazy(() => import('./features/traces/TracesPage').then((m) => ({ default: m.TracesPage })));
const QueryPage = lazy(() => import('./features/query/QueryPage').then((m) => ({ default: m.QueryPage })));
const ProcessesPage = lazy(() => import('./features/processes/ProcessesPage').then((m) => ({ default: m.ProcessesPage })));
const SyntheticsPage = lazy(() => import('./features/synthetics/SyntheticsPage').then((m) => ({ default: m.SyntheticsPage })));
const SecurityPage = lazy(() => import('./features/security/SecurityPage').then((m) => ({ default: m.SecurityPage })));
const SessionsPage = lazy(() => import('./features/sessions/SessionsPage').then((m) => ({ default: m.SessionsPage })));
const MetricsSummaryPage = lazy(() => import('./features/metrics/MetricsSummaryPage').then((m) => ({ default: m.MetricsSummaryPage })));
const AssistantPage = lazy(() => import('./features/assistant/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
});

/** Live-data bootstrap: REST snapshot → LiveStore, then WS + health poll. */
function useLiveBoot(tags: TagInfo[] | undefined) {
  const authRev = useStore(() => live.authRev);

  useEffect(() => {
    if (!tags) return;
    live.setTags(tags);
    void api.latestAll().then((rows) => rows.forEach((r) => live.pushTag(r.name, r.v, r.q, r.ts)))
      .catch(() => live.setSeedError());
    void api.alarms().then((a) => live.setAlarms(a)).catch(() => live.setSeedError());
    void api.insights({ state: 'open' }).then((a) => live.setInsights(a)).catch(() => live.setSeedError());
  }, [tags]);

  useEffect(() => {
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

  useEffect(() => {
    if (!canOperate(getSessionRole())) { live.setSysHealth(null); return; }
    api.systemHealth().then((h) => live.setSysHealth(h)).catch(() => live.setSysHealth(null));
  }, [authRev]);

  useEffect(() => {
    if (!canOperate(getSessionRole())) return;
    void api.listCommands(20).then((cmds) => cmds.forEach((c) => live.mergeCommand(c))).catch(() => {});
  }, [authRev]);
}

function AuthedApp() {
  const q = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  useLiveBoot(q.data);
  useEffect(() => { void refreshSession(); }, []);
  useEffect(() => { if (q.isError) live.setSeedError(); }, [q.isError]);
  return <Shell />;
}

function Boot() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const denied = useDenied();
  useStore(() => live.authRev);

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
      // dev convenience: ?token=… or ?demo=operator|viewer signs in directly.
      // Only reachable when the backend runs APP_ENV=dev (dev_tokens flag).
      const p = new URLSearchParams(loc.search);
      const demo = p.get('demo');
      const tok = p.get('token') ?? (demo ? `demo-${demo}` : null);
      if (tok && authConfig()?.dev_tokens && !hasToken()) {
        signIn(tok);
        navigate(loc.pathname, { replace: true });
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loc.pathname === '/auth/silent-callback') return null;
  if (!ready || loc.pathname === '/auth/callback') {
    return <div className="grid min-h-svh place-items-center bg-paper"><PageSkeleton rows={2} /></div>;
  }
  if (!hasToken() || denied) {
    if (!denied && loc.pathname === '/') return <Landing />;
    return <SignInWall denied={denied} />;
  }
  if (loc.pathname === '/signin') return <Navigate to="/" replace />;
  return <AuthedApp />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Boot gates everything: walls render instead of the shell when
              unauthenticated, so no API traffic fires before a token exists */}
          <Route element={<Boot />} errorElement={<RouteError />}>
            <Route index element={<RouteBoundary><OverviewPage /></RouteBoundary>} />
            <Route path="line" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><LinePage /></Suspense></RouteBoundary>} />
            <Route path="line3d" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><Line3DPage /></Suspense></RouteBoundary>} />
            <Route path="alarms" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AlarmsPage /></Suspense></RouteBoundary>} />
            <Route path="alarms/:id" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AlarmDetailPage /></Suspense></RouteBoundary>} />
            <Route path="trends" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><TrendsPage /></Suspense></RouteBoundary>} />
            <Route path="insights" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><InsightsPage /></Suspense></RouteBoundary>} />
            <Route path="tags" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><TagsPage /></Suspense></RouteBoundary>} />
            <Route path="commands" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><CommandsPage /></Suspense></RouteBoundary>} />
            <Route path="health" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><HealthPage /></Suspense></RouteBoundary>} />
            <Route path="admin" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AdminPage /></Suspense></RouteBoundary>} />
            <Route path="admin/rules" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AlarmRulesPage /></Suspense></RouteBoundary>} />
            <Route path="admin/rules/new" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><RuleCreatePage /></Suspense></RouteBoundary>} />
            <Route path="admin/users" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><UsersPage /></Suspense></RouteBoundary>} />
            <Route path="admin/audit" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AuditPage /></Suspense></RouteBoundary>} />
            <Route path="activity" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><ActivityPage /></Suspense></RouteBoundary>} />
            {enabled('errors') && <Route path="errors" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><ErrorTrackingPage /></Suspense></RouteBoundary>} />}
            <Route path="slos" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><SloPage /></Suspense></RouteBoundary>} />
            {enabled('downtimes') && <Route path="downtimes" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><DowntimesPage /></Suspense></RouteBoundary>} />}
            <Route path="dashboards" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><DashboardsPage /></Suspense></RouteBoundary>} />
            <Route path="dashboards/:id" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><DashboardViewPage /></Suspense></RouteBoundary>} />
            <Route path="infrastructure" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><DevicesPage /></Suspense></RouteBoundary>} />
            <Route path="infrastructure/add" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AddDeviceWizard /></Suspense></RouteBoundary>} />
            <Route path="settings" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><SettingsPage /></Suspense></RouteBoundary>} />
            <Route path="alarms/quality" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AlarmQualityPage /></Suspense></RouteBoundary>} />
            {enabled('alarmsettings') && <Route path="alarms/settings" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AlarmSettingsPage /></Suspense></RouteBoundary>} />}
            <Route path="events" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><EventsPage /></Suspense></RouteBoundary>} />
            {enabled('incidents') && <Route path="incidents" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><IncidentsPage /></Suspense></RouteBoundary>} />}
            {enabled('notebooks') && <Route path="notebooks" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><NotebooksPage /></Suspense></RouteBoundary>} />}
            {enabled('notebooks') && <Route path="notebooks/:id" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><NotebookViewPage /></Suspense></RouteBoundary>} />}
            {enabled('catalog') && <Route path="catalog" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><CatalogPage /></Suspense></RouteBoundary>} />}
            {enabled('logs') && <Route path="logs" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><LogsPage /></Suspense></RouteBoundary>} />}
            {enabled('teams') && <Route path="teams" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><TeamsPage /></Suspense></RouteBoundary>} />}
            {enabled('traces') && <Route path="traces" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><TracesPage /></Suspense></RouteBoundary>} />}
            {enabled('query') && <Route path="query" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><QueryPage /></Suspense></RouteBoundary>} />}
            {enabled('processes') && <Route path="processes" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><ProcessesPage /></Suspense></RouteBoundary>} />}
            {enabled('synthetics') && <Route path="synthetics" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><SyntheticsPage /></Suspense></RouteBoundary>} />}
            {enabled('security') && <Route path="security" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><SecurityPage /></Suspense></RouteBoundary>} />}
            {enabled('sessions') && <Route path="sessions" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><SessionsPage /></Suspense></RouteBoundary>} />}
            <Route path="metrics" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><MetricsSummaryPage /></Suspense></RouteBoundary>} />
            {enabled('assistant') && <Route path="assistant" element={<RouteBoundary><Suspense fallback={<PageSkeleton />}><AssistantPage /></Suspense></RouteBoundary>} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
