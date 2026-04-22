import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import './Layout.module.css';

export default function Layout() {
  return (
    <div className="layout-root">
      <Sidebar />
      <main className="layout-content">
        <Outlet />
      </main>
    </div>
  );
}
