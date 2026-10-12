import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { api, tokenRole } from './lib/api';
import { live } from './lib/live';
import { startWS, stopWS } from './lib/ws';
import { useStore } from './lib/hooks';
import { Shell } from './app/Shell';
import { OverviewPage } from './features/overview/OverviewPage';
import { LinePage } from './features/line/LinePage';
import { AlarmsPage } from './features/alarms/AlarmsPage';
import { TrendsPage } from './features/trends/TrendsPage';
import { TagsPage } from './features/tags/TagsPage';
import { InsightsPage } from './features/insights/InsightsPage';
import { CommandsPage } from './features/commands/CommandsPage';
import { HealthPage } from './features/health/HealthPage';
import { ErrorState } from './shared/ui/Feedback';
import type { TagInfo } from './types';

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
    const poll = async () => {
      try { live.setHealth(await api.health()); } catch { live.setHealth(null); }
      try { live.setSysHealth(await api.systemHealth()); } catch { live.setSysHealth(null); }
    };
    void poll();
    const id = setInterval(() => void poll(), 10_000);
    startWS();
    return () => { clearInterval(id); stopWS(); };
  }, []);

  // command history is operator-only server-side: re-seed when the role changes
  useEffect(() => {
    const role = tokenRole();
    if (role !== 'operator' && role !== 'custom') return;
    void api.listCommands(20).then((cmds) => cmds.forEach((c) => live.mergeCommand(c))).catch(() => {});
  }, [authRev]);
}

function Root({ page }: { page: (tags: TagInfo[]) => JSX.Element }) {
  const q = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  if (q.isError) return <div className="page"><ErrorState onRetry={() => void q.refetch()} /></div>;
  return page(q.data ?? []);
}

function Boot() {
  const q = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  useLiveBoot(q.data);
  return <Shell />;
}

const router = createBrowserRouter([
  {
    element: <Boot />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'line', element: <LinePage /> },
      { path: 'alarms', element: <AlarmsPage /> },
      { path: 'trends', element: <Root page={(tags) => <TrendsPage tags={tags} />} /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'tags', element: <Root page={(tags) => <TagsPage tags={tags} />} /> },
      { path: 'commands', element: <CommandsPage /> },
      { path: 'health', element: <HealthPage /> },
      { path: '*', element: <OverviewPage /> },
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
