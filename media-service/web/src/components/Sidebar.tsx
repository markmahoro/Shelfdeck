import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const GROUP_1 = [
  { to: '/', label: '仪表盘' },
];

const GROUP_2 = [
  { to: '/tasks', label: '任务监控' },
];

const GROUP_3 = [
  { to: '/system', label: '任务调度设置' },
  { to: '/douban', label: '豆瓣评分抓取设置' },
  { to: '/transcode', label: '转码设置' },
  { to: '/moviepilot', label: '洗版设置' },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>ShelfDeck</div>
      <nav className={styles.nav}>
        <div className={styles.groupLabel}>概览</div>
        {GROUP_1.map(({ to, label }) => (
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

        <div className={styles.groupLabel}>监控</div>
        {GROUP_2.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.navItem}${isActive ? ` ${styles.active}` : ''}`
            }
          >
            {label}
          </NavLink>
        ))}

        <div className={styles.groupLabel}>设置</div>
        {GROUP_3.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
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
