import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Icon from './Icon';

export default function Layout() {
  const [open, setOpen] = useState(false);
  return <div className="app-shell">
    <div className="mobile-bar"><button className="btn btn-quiet icon-btn" aria-label="打开导航" onClick={() => setOpen(true)}><Icon name="menu" width={20} /></button><strong>ShelfDeck</strong></div>
    <Sidebar open={open} onNavigate={() => setOpen(false)} />
    <button className={`mobile-scrim ${open ? 'open' : ''}`} aria-label="关闭导航" onClick={() => setOpen(false)} />
    <main className="app-main"><Outlet /></main>
  </div>;
}
