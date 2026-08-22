import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { pages } from './helix/surface-model';
import HelixPage from './helix/HelixPage';
import MaterialFieldsPage from './helix/MaterialFieldsPage';
import ShelvesPage from './helix/ShelvesPage';
import FormationPage from './helix/FormationPage';
import CollectionPage from './helix/CollectionPage';
import SettingsPage from './helix/SettingsPage';
import OffdeckPage from './helix/OffdeckPage';
import OverviewPage from './helix/OverviewPage';
import PeoplePage from './helix/PeoplePage';
import { helixAdminApi } from './helix/api';
import { SessionProvider } from './helix/session';
import './helix/helix.css';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 } },
  });
}

const pageElement: Record<string, ReactElement> = {
  overview: <OverviewPage />,
  'material-fields': <MaterialFieldsPage />,
  shelves: <ShelvesPage />,
  formation: <FormationPage />,
  collection: <CollectionPage />,
  offdeck: <OffdeckPage />,
  people: <PeoplePage />,
  settings: <SettingsPage />,
};

function railKind(data: { systemState:{ kind:string }; todos?: Array<{ key:string }> }) {
  if (data.systemState.kind !== 'faulted' && data.todos?.some((item) => item.key === 'field_access')) return 'attention';
  return data.systemState.kind;
}

function RailStatus() {
  const { data } = useQuery({ queryKey: ['overview'], queryFn: () => helixAdminApi.getOverview() });
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
