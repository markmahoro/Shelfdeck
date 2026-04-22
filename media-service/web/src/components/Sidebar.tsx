import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/admin/dashboard', label: '仪表盘', icon: '📊' },
  { to: '/admin/config', label: '配置管理', icon: '⚙️' },
  { to: '/admin/tasks', label: '任务中心', icon: '📋' },
  { to: '/admin/douban', label: '豆瓣集成', icon: '🍊' },
  { to: '/admin/paths', label: '路径映射', icon: '📁' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">🖥️ ShelfDeck</div>
      <nav className="sidebar-nav">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `sidebar-nav-item${isActive ? ' active' : ''}`
            }
          >
            <span className="sidebar-nav-icon">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          className="logout-btn"
          onClick={() => {
            sessionStorage.removeItem('admin_session');
            window.location.href = '/admin/login';
          }}
        >
          退出登录
        </button>
      </div>
    </aside>
  );
}
