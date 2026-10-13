import { useEffect, useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { pages } from './helix/surface-model';
import HelixPage from './helix/HelixPage';
import MaterialFieldsPage from './helix/MaterialFieldsPage';
import ShelvesPage from './helix/ShelvesPage';
import FormationPage from './helix/FormationPage';
import FormationStubPage from './helix/FormationStubPage';
import CollectionPage from './helix/CollectionPage';
import SettingsPage from './helix/SettingsPage';
import OffdeckPage from './helix/OffdeckPage';
import OverviewPage from './helix/OverviewPage';
import PeoplePage from './helix/PeoplePage';
import { helixAdminApi } from './helix/api';
import { isUnauthorized, SessionProvider, useSession } from './helix/session';
import './helix/helix.css';
import './helix/polish.css';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 } },
  });
}

const pageElement: Record<string, ReactElement> = {
  overview: <OverviewPage />,
  'material-fields': <MaterialFieldsPage />,
  shelves: <ShelvesRoute />,
  formation: <FormationRoute />,
  collection: <CollectionPage />,
  offdeck: <OffdeckPage />,
  people: <PeoplePage />,
  settings: <SettingsPage />,
};

function ShelvesRoute() {
  const location=useLocation();
  return <ShelvesPage openSettlementAuthorization={new URLSearchParams(location.search).get('configure')==='source-cleanup'} />;
}

function FormationRoute() {
  const location = useLocation();
  return new URLSearchParams(location.search).get('stub') === '1' ? <FormationStubPage /> : <FormationPage />;
}

function railKind(data: { systemState:{ kind:string }; todos?: Array<{ key:string }> }) {
  if (data.systemState.kind !== 'faulted' && data.todos?.some((item) => item.key === 'field_access')) return 'attention';
  return data.systemState.kind;
}

function RailStatus() {
  const {expire}=useSession();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(timer);
  }, []);
  const { data, error } = useQuery({ queryKey: ['overview'], queryFn: () => helixAdminApi.getOverview(), enabled: ready });
  const runtime=useQuery({queryKey:['runtime-operations'],queryFn:()=>helixAdminApi.getRuntimeStatus(),enabled:ready,
    refetchInterval:query=>['stopping','resuming','resetting'].includes(query.state.data?.mode||'')?1000:5000});
  useEffect(()=>{if(runtime.error&&isUnauthorized(runtime.error))expire();},[expire,runtime.error]);
  const runtimeLabels={starting:'正在启动',stopping:'正在安全停机',stopped:'已安全停机',resuming:'正在恢复运行',resetting:'正在 Reset',error:'运行操作未完成'};
  if(!runtime.error&&runtime.data?.mode&&runtime.data.mode!=='running')return <p className="rail-status" data-kind="maintenance">{runtimeLabels[runtime.data.mode]}</p>;
  if(runtime.error)return <p className="rail-status" data-kind="unknown">状态读取失败</p>;
  if (error || data?.projection && data.projection.state !== 'ready') return <p className="rail-status" data-kind="unknown">状态读取失败</p>;
  if (!data?.systemState) return null;
  const kind = railKind(data);
  return <p className="rail-status" data-kind={kind}>{kind === 'attention' ? '需要你处理' : data.systemState.label}</p>;
}

export default function App() {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}><SessionProvider>
    <div className="helix-shell">
      <a className="skip-link" href="#main">跳到主要内容</a>
      <aside className="helix-rail" aria-label="ShelfDeck 主导航">
        <div className="helix-brand"><span className="brand-mark" aria-hidden="true">SD</span><div><strong>ShelfDeck</strong><small>媒体库管家</small></div></div>
        <RailStatus />
        <nav>
          {pages.filter((page) => page.group !== 'config').map((page) => <NavLink key={page.slug} to={page.path} end={page.path === '/'} className={({ isActive }) => isActive ? 'active' : ''}>{page.label}</NavLink>)}
          <span className="nav-separator">配置</span>
          {pages.filter((page) => page.group === 'config').map((page) => <NavLink key={page.slug} to={page.path} end={page.path === '/'} className={({ isActive }) => isActive ? 'active' : ''}>{page.label}</NavLink>)}
        </nav>
      </aside>
      <main id="main" className="helix-main">
        <Routes>
          {pages.map((page) => <Route key={page.slug} path={page.path} element={pageElement[page.slug] || <HelixPage page={page} />} />)}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  </SessionProvider></QueryClientProvider>;
}
