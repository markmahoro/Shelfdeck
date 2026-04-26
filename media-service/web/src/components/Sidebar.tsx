import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/', label: '仪表盘' },
  { to: '/media-libraries', label: '媒体库' },
  { to: '/transcode', label: '转码设置' },
  { to: '/douban', label: '豆瓣设置' },
  { to: '/tasks', label: '任务监控' },
  { to: '/system', label: '系统设置' },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>ShelfDeck</div>
      <nav className={styles.nav}>
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${styles.navItem}${isActive ? ` ${styles.active}` : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
