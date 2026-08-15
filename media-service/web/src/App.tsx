import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { pages } from './helix/surface-model';
import HelixPage from './helix/HelixPage';
import MaterialFieldsPage from './helix/MaterialFieldsPage';
import ShelvesPage from './helix/ShelvesPage';
import FormationPage from './helix/FormationPage';
import CollectionPage from './helix/CollectionPage';
import SettingsPage from './helix/SettingsPage';
import OffdeckPage from './helix/OffdeckPage';
import './helix/helix.css';

export default function App() {
  return <div className="helix-shell">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <aside className="helix-rail" aria-label="ShelfDeck 主导航">
      <div className="helix-brand"><span className="brand-mark" aria-hidden="true">SD</span><div><strong>ShelfDeck</strong><small>收藏运营台</small></div></div>
      <nav>{pages.map((page) => <NavLink key={page.slug} to={page.path} end={page.path === '/'} className={({isActive}) => isActive ? 'active' : ''}><span aria-hidden="true">{page.glyph}</span>{page.label}</NavLink>)}</nav>
      <div className="rail-status"><span className="pulse" aria-hidden="true"/>正常运行<small>本地 Projection</small></div>
    </aside>
    <main id="main" className="helix-main"><Routes>
      {pages.map((page) => <Route key={page.slug} path={page.path} element={page.slug === 'material-fields' ? <MaterialFieldsPage/> : page.slug === 'shelves' ? <ShelvesPage/> : page.slug === 'formation' ? <FormationPage/> : page.slug === 'collection' ? <CollectionPage/> : page.slug === 'offdeck'?<OffdeckPage/>:page.slug === 'settings' ? <SettingsPage/> : <HelixPage page={page}/>}/>) }
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes></main>
  </div>;
}
