import { NavLink } from 'react-router-dom';
import Icon from './Icon';

const primary = [
  ['/', '概览', 'overview'],
  ['/libraries', '媒体库', 'libraries'],
  ['/media', '媒体', 'media'],
  ['/people', '演员', 'people'],
  ['/tasks', '任务中心', 'tasks'],
  ['/cleanup', '清理建议', 'cleanup'],
];
const settings = [['/policies', '管理策略', 'policy'], ['/settings', '系统设置', 'settings']];

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const links = (items: string[][]) => items.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} title={label} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon name={icon} /><span>{label}</span></NavLink>);
  return <aside className={`sidebar ${open ? 'open' : ''}`}>
    <div className="brand"><img src="/logo-48.png" srcSet="/logo-96.png 2x" alt="" /><span>ShelfDeck</span></div>
    <nav aria-label="主要导航"><div className="nav-section">{links(primary)}</div><div className="nav-section"><div className="nav-label">设置</div>{links(settings)}</div></nav>
  </aside>;
}
