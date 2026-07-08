import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const GROUP_1 = [
  { to: '/', label: '仪表盘' },
];

const GROUP_2 = [
  { to: '/media', label: '媒体库' },
  { to: '/tasks', label: '任务中心' },
  { to: '/delete-candidates', label: '处置队列' },
];

const GROUP_3 = [
  { to: '/policies', label: '管理策略' },
  { to: '/advanced', label: '高级' },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <img src="/logo-48.png" srcSet="/logo-96.png 2x" className={styles.logoIcon} alt="" />
        ShelfDeck
      </div>
      <nav className={styles.nav}>
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
