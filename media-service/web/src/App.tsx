import type { ReactElement } from 'react';
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

export default function App() {
  return <div className="helix-shell">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <aside className="helix-rail" aria-label="ShelfDeck 主导航">
      <div className="helix-brand"><span className="brand-mark" aria-hidden="true">SD</span><div><strong>ShelfDeck</strong><small>媒体库管家</small></div></div>
      <nav>{pages.map((page) => <NavLink key={page.slug} to={page.path} end={page.path === '/'} className={({ isActive }) => isActive ? 'active' : ''}>{page.label}</NavLink>)}</nav>
    </aside>
    <main id="main" className="helix-main">
      <SessionProvider>
        <Routes>
          {pages.map((page) => <Route key={page.slug} path={page.path} element={pageElement[page.slug] || <HelixPage page={page} />} />)}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </main>
  </div>;
}
