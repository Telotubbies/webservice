// App shell — auth boot (OIDC restore → sign-in wall) → live-data bootstrap
// (REST seed → WS stream + health polling) → routed console inside Shell.

import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { live } from './lib/live';
import { useStore } from './lib/hooks';
import { startWS, stopWS } from './lib/ws';
import { canOperate, getSessionRole, hasToken, refreshSession, useDenied, useNoOrg } from './app/session';
import { CreateOrgPage } from './features/orgs/CreateOrgPage';
import { getScope } from './lib/scope';
import { initAuth, restoreSession, completeRedirectCallback, isCallbackPath, authConfig, takeReturnTo } from './features/auth/oidc';
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
const ApiKeysPage = lazy(() => import('./features/admin/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })));
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
const NetworkMapPage = lazy(() => import('./features/devices/NetworkMapPage').then((m) => ({ default: m.NetworkMapPage })));
const ProfilesPage = lazy(() => import('./features/devices/ProfilesPage').then((m) => ({ default: m.ProfilesPage })));
const AddDeviceWizard = lazy(() => import('./features/devices/AddDeviceWizard').then((m) => ({ default: m.AddDeviceWizard })));
const DataSourcesPage = lazy(() => import('./features/datasources/DataSourcesPage').then((m) => ({ default: m.DataSourcesPage })));
const ModelsPage = lazy(() => import('./features/vision/ModelsPage').then((m) => ({ default: m.ModelsPage })));
const CamerasPage = lazy(() => import('./features/cameras/CamerasPage').then((m) => ({ default: m.CamerasPage })));
const GatewayPage = lazy(() => import('./features/datasources/GatewayPage').then((m) => ({ default: m.GatewayPage })));
const AlarmQualityPage = lazy(() => import('./features/alarmquality/AlarmQualityPage').then((m) => ({ default: m.AlarmQualityPage })));
const AlarmSettingsPage = lazy(() => import('./features/alarmsettings/AlarmSettingsPage').then((m) => ({ default: m.AlarmSettingsPage })));
const EventsPage = lazy(() => import('./features/events/EventsPage').then((m) => ({ default: m.EventsPage })));
const IncidentsPage = lazy(() => import('./features/incidents/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const IncidentSettingsPage = lazy(() => import('./features/incidents/IncidentSettingsPage').then((m) => ({ default: m.IncidentSettingsPage })));
const NotebooksPage = lazy(() => import('./features/notebooks/NotebooksPage').then((m) => ({ default: m.NotebooksPage })));
const NotebookViewPage = lazy(() => import('./features/notebooks/NotebooksPage').then((m) => ({ default: m.NotebookViewPage })));
const CatalogPage = lazy(() => import('./features/catalog/CatalogPage').then((m) => ({ default: m.CatalogPage })));
const LogsPage = lazy(() => import('./features/logs/LogsPage').then((m) => ({ default: m.LogsPage })));
const TeamsPage = lazy(() => import('./features/teams/TeamsPage').then((m) => ({ default: m.TeamsPage })));
const TracesPage = lazy(() => import('./features/traces/TracesPage').then((m) => ({ default: m.TracesPage })));
const QueryPage = lazy(() => import('./features/query/QueryPage').then((m) => ({ default: m.QueryPage })));
const ProcessesPage = lazy(() => import('./features/processes/ProcessesPage').then((m) => ({ default: m.ProcessesPage })));
const SyntheticsCoveragePage = lazy(() => import('./features/synthetics/CoveragePage').then((m) => ({ default: m.SyntheticsCoveragePage })));
const SyntheticsSettingsPage = lazy(() => import('./features/synthetics/SettingsPage').then((m) => ({ default: m.SyntheticsSettingsPage })));
const SyntheticsPage = lazy(() => import('./features/synthetics/SyntheticsPage').then((m) => ({ default: m.SyntheticsPage })));
const MonitorsPage = lazy(() => import('./features/monitors/MonitorsPage').then((m) => ({ default: m.MonitorsPage })));
const TemplatesPage = lazy(() => import('./features/monitors/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const SecurityPage = lazy(() => import('./features/security/SecurityPage').then((m) => ({ default: m.SecurityPage })));
const SecurityIssuesPage = lazy(() => import('./features/security/IssuesPage').then((m) => ({ default: m.IssuesPage })));
const SecurityFindingsPage = lazy(() => import('./features/security/FindingsPage').then((m) => ({ default: m.FindingsPage })));
const SecurityApiPage = lazy(() => import('./features/security/ApiProtectionPage').then((m) => ({ default: m.ApiProtectionPage })));
const SecurityAccessPage = lazy(() => import('./features/security/AccessPage').then((m) => ({ default: m.AccessPage })));
const SessionsPage = lazy(() => import('./features/sessions/SessionsPage').then((m) => ({ default: m.SessionsPage })));
const MetricsSummaryPage = lazy(() => import('./features/metrics/MetricsSummaryPage').then((m) => ({ default: m.MetricsSummaryPage })));
const AssistantPage = lazy(() => import('./features/assistant/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const VisionRulesPage = lazy(() => import('./features/vision/RulesPage').then((m) => ({ default: m.RulesPage })));
const VisionEventsPage = lazy(() => import('./features/vision/EventsPage').then((m) => ({ default: m.EventsPage })));
const OeePage = lazy(() => import('./features/production/OeePage').then((m) => ({ default: m.OeePage })));
const ShiftsPage = lazy(() => import('./features/production/ShiftsPage').then((m) => ({ default: m.ShiftsPage })));
const ProductionDowntimesPage = lazy(() => import('./features/production/DowntimesPage').then((m) => ({ default: m.DowntimesPage })));
const ReportsPage = lazy(() => import('./features/production/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ChannelsPage = lazy(() => import('./features/notify/ChannelsPage').then((m) => ({ default: m.ChannelsPage })));
const AckLinkPage = lazy(() => import('./features/notify/AckLinkPage').then((m) => ({ default: m.AckLinkPage })));
const PlanPage = lazy(() => import('./features/platform/PlanPage').then((m) => ({ default: m.PlanPage })));
const DangerZone = lazy(() => import('./features/platform/DangerZone').then((m) => ({ default: m.DangerZone })));
const PlatformPage = lazy(() => import('./features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })));
const PlatformOrgPage = lazy(() => import('./features/platform/PlatformOrgPage').then((m) => ({ default: m.PlatformOrgPage })));
const PlatformSupportPage = lazy(() => import('./features/platform/PlatformOpsPage').then((m) => ({ default: m.PlatformSupportPage })));
const PlatformAnnouncementsPage = lazy(() => import('./features/platform/PlatformOpsPage').then((m) => ({ default: m.PlatformAnnouncementsPage })));
const StatusPage = lazy(() => import('./features/status/StatusPage').then((m) => ({ default: m.StatusPage })));

// One wrapper for every page route: error boundary + lazy-load skeleton.
const page = (P: ComponentType) => <RouteBoundary><Suspense fallback={<PageSkeleton />}><P /></Suspense></RouteBoundary>;

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
  useStore(() => live.authRev); // org switch bumps authRev
  const scopeKey = getScope()?.siteId ?? 'none';
  const q = useQuery({ queryKey: ['tags', scopeKey], queryFn: api.tags, staleTime: 60_000 });
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
  const noOrg = useNoOrg();
  useStore(() => live.authRev);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initAuth();
      if (cancelled) return;
      if (isCallbackPath(loc.pathname)) {
        await completeRedirectCallback(loc.pathname);
        if (loc.pathname !== '/auth/silent-callback') {
          // deep link stashed before signinRedirect (ack links etc.)
          navigate(takeReturnTo(), { replace: true });
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
  if (noOrg) return <CreateOrgPage />;
  if (loc.pathname === '/signin') return <Navigate to="/" replace />;
  return <AuthedApp />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* public status page — reachable signed-out (roadmap 8.4) */}
          <Route path="status" element={page(StatusPage)} />
          {/* Boot gates everything: walls render instead of the shell when
              unauthenticated, so no API traffic fires before a token exists */}
          <Route element={<Boot />} errorElement={<RouteError />}>
            <Route index element={<RouteBoundary><OverviewPage /></RouteBoundary>} />
            <Route path="line" element={page(LinePage)} />
            <Route path="line3d" element={page(Line3DPage)} />
            <Route path="monitors" element={page(MonitorsPage)} />
            <Route path="monitors/templates" element={page(TemplatesPage)} />
            <Route path="alarms" element={page(AlarmsPage)} />
            <Route path="alarms/:id" element={page(AlarmDetailPage)} />
            <Route path="trends" element={page(TrendsPage)} />
            <Route path="insights" element={page(InsightsPage)} />
            <Route path="tags" element={page(TagsPage)} />
            <Route path="commands" element={page(CommandsPage)} />
            <Route path="health" element={page(HealthPage)} />
            <Route path="admin" element={page(AdminPage)} />
            <Route path="admin/rules" element={page(AlarmRulesPage)} />
            <Route path="admin/rules/new" element={page(RuleCreatePage)} />
            <Route path="admin/users" element={page(UsersPage)} />
            <Route path="admin/audit" element={page(AuditPage)} />
            <Route path="admin/keys" element={page(ApiKeysPage)} />
            <Route path="activity" element={page(ActivityPage)} />
            {enabled('errors') && <Route path="errors" element={page(ErrorTrackingPage)} />}
            <Route path="slos" element={page(SloPage)} />
            <Route path="downtimes" element={page(DowntimesPage)} />
            <Route path="dashboards" element={page(DashboardsPage)} />
            <Route path="dashboards/:id" element={page(DashboardViewPage)} />
            <Route path="infrastructure" element={page(DevicesPage)} />
            <Route path="infrastructure/sources" element={page(DataSourcesPage)} />
            <Route path="infrastructure/sources/:edgeId" element={page(GatewayPage)} />
            <Route path="infrastructure/cameras" element={page(CamerasPage)} />
            <Route path="infrastructure/models" element={page(ModelsPage)} />
            <Route path="infrastructure/rules" element={page(VisionRulesPage)} />
            <Route path="infrastructure/events" element={page(VisionEventsPage)} />
            <Route path="infrastructure/add" element={page(AddDeviceWizard)} />
            <Route path="infrastructure/map" element={page(NetworkMapPage)} />
            <Route path="infrastructure/profiles" element={page(ProfilesPage)} />
            <Route path="settings" element={page(SettingsPage)} />
            <Route path="settings/plan" element={page(PlanPage)} />
            <Route path="settings/org" element={page(DangerZone)} />
            <Route path="orgs/new" element={<CreateOrgPage />} />
            <Route path="alarms/quality" element={page(AlarmQualityPage)} />
            {enabled('alarmsettings') && <Route path="alarms/settings" element={<Navigate to="/alarms/settings/general" replace />} />}
            {enabled('alarmsettings') && <Route path="alarms/settings/:section" element={page(AlarmSettingsPage)} />}
            <Route path="events" element={page(EventsPage)} />
            {enabled('incidents') && <Route path="incidents" element={page(IncidentsPage)} />}
            {enabled('incidents') && <Route path="incidents/settings" element={page(IncidentSettingsPage)} />}
            <Route path="notebooks" element={page(NotebooksPage)} />
            <Route path="notebooks/:id" element={page(NotebookViewPage)} />
            {enabled('catalog') && <Route path="catalog" element={page(CatalogPage)} />}
            <Route path="logs" element={page(LogsPage)} />
            {enabled('teams') && <Route path="teams" element={page(TeamsPage)} />}
            {enabled('traces') && <Route path="traces" element={page(TracesPage)} />}
            <Route path="query" element={page(QueryPage)} />
            {enabled('processes') && <Route path="processes" element={page(ProcessesPage)} />}
            {enabled('synthetics') && <Route path="synthetics" element={page(SyntheticsPage)} />}
            {enabled('synthetics') && <Route path="synthetics/coverage" element={page(SyntheticsCoveragePage)} />}
            {enabled('synthetics') && <Route path="synthetics/settings" element={page(SyntheticsSettingsPage)} />}
            <Route path="security" element={page(SecurityPage)} />
            <Route path="security/issues" element={page(SecurityIssuesPage)} />
            <Route path="security/findings" element={page(SecurityFindingsPage)} />
            <Route path="security/api" element={page(SecurityApiPage)} />
            <Route path="security/access" element={page(SecurityAccessPage)} />
            {enabled('sessions') && <Route path="sessions" element={page(SessionsPage)} />}
            <Route path="metrics" element={page(MetricsSummaryPage)} />
            {enabled('assistant') && <Route path="assistant" element={page(AssistantPage)} />}
            {/* production KPIs (Phase 5) */}
            <Route path="oee" element={page(OeePage)} />
            <Route path="stops" element={page(ProductionDowntimesPage)} />
            <Route path="shifts" element={page(ShiftsPage)} />
            <Route path="reports" element={page(ReportsPage)} />
            {/* notifications + signed ack link (Phase 3) */}
            <Route path="notifications/channels" element={page(ChannelsPage)} />
            <Route path="ack/:token" element={page(AckLinkPage)} />
            {/* platform back-office (Phase 7) — page enforces platform admin */}
            <Route path="platform" element={page(PlatformPage)} />
            <Route path="platform/orgs/:id" element={page(PlatformOrgPage)} />
            <Route path="platform/support" element={page(PlatformSupportPage)} />
            <Route path="platform/announcements" element={page(PlatformAnnouncementsPage)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
