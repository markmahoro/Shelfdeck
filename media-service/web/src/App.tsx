import { useEffect, useState, type ReactElement } from 'react';
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
import { helixAdminApi, type OverviewProjection } from './helix/api';
import { SessionProvider } from './helix/session';
import './helix/helix.css';

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

function RailStatus() {
  const [state, setState] = useState<OverviewProjection['systemState'] | null>(null);
  useEffect(() => {
    helixAdminApi.getOverview().then((value) => setState(value.systemState)).catch(() => setState(null));
  }, []);
  if (!state) return null;
  return <p className="rail-status" data-kind={state.kind}>{state.label}</p>;
}

export default function App() {
  return <SessionProvider>
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
  </SessionProvider>;
}
