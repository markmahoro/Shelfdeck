/**
 * [UI] TopNav 导航栏 — 页面切换 + 子库选择。
 */

import type { AppPage, SubLibraryInfo } from '../App';

const MAIN_NAV: { id: AppPage; label: string }[] = [
  { id: 'wall', label: '海报墙' },
  { id: 'mediaManage', label: '媒体库管理' },
  { id: 'history', label: '播放记录' },
];

export default function TopNav({
  page,
  setPage,
  onSettingsClick,
  subLibraries,
  subLibraryId,
  onSubLibraryChange,
}: {
  page: AppPage;
  setPage: (p: AppPage) => void;
  onSettingsClick: () => void;
  subLibraries: SubLibraryInfo[];
  subLibraryId: string;
  onSubLibraryChange: (id: string) => void;
}) {
  return (
    <nav className="topNav" aria-label="主导航">
      {MAIN_NAV.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`navTab${page === id ? ' navTabActive' : ''}`}
          onClick={() => setPage(id)}
        >
          {label}
        </button>
      ))}

      <select
        className="navSelect"
        value={subLibraryId}
        onChange={(e) => onSubLibraryChange(e.target.value)}
        title="选择子库"
        style={{ marginLeft: 12, padding: '4px 8px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
      >
        <option value="">全部子库</option>
        {subLibraries.map((sl) => (
          <option key={sl.uuid} value={sl.uuid}>
            {sl.name}
          </option>
        ))}
      </select>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className="navTab navTabIcon"
        onClick={onSettingsClick}
        title="设置"
        aria-label="打开设置"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
          <path
            fillRule="evenodd"
            d="M6.5 1.75a.25.25 0 0 1 .25-.25h2a.25.25 0 0 1 .25.25V3h-2.5V1.75zM13.25 6.5a.25.25 0 0 1-.175.232l-1.537.884a.25.25 0 0 1-.267.088l-.358-.179-.001-.001a.498.498 0 0 0-.608-.174l-.694.174a.25.25 0 0 1-.267-.088l-1.537-.884a.25.25 0 0 1-.093-.166l.001-.002L6.603 4.4a.498.498 0 0 0-.608.174l-.694-.174a.25.25 0 0 1 .089-.267l1.537-.884a.25.25 0 0 1 .267-.088l.358.179.001.001.001.002a.498.498 0 0 0 .174.608l-.174.694a.25.25 0 0 1-.088.267l-.884 1.537a.25.25 0 0 1-.166.093l-.002-.001-.002-.001a.498.498 0 0 0-.174-.608l.174-.694a.25.25 0 0 1 .088-.267l.884-1.537a.25.25 0 0 1 .232-.175h.633a.25.25 0 0 1 .25.25v2a.25.25 0 0 1-.25.25h-.633a.498.498 0 0 0-.608.174l-.174.694a.25.25 0 0 1-.267.088l-1.537.884a.25.25 0 0 1-.232.175H3.75a.25.25 0 0 1-.25-.25v-.633a.498.498 0 0 0-.174-.608l.174-.694a.25.25 0 0 1 .088-.267l.884-1.537a.25.25 0 0 1 .166-.093l.002.001.002.001a.498.498 0 0 0 .608-.174l.174-.694a.25.25 0 0 1 .267-.088l1.537-.884a.25.25 0 0 1 .175-.232V3.75a.25.25 0 0 1 .25-.25h.633a.498.498 0 0 0 .608-.174l.174-.694a.25.25 0 0 1 .267-.088l1.537-.884a.25.25 0 0 1 .232-.175h.633a.25.25 0 0 1 .25.25v2a.25.25 0 0 1-.25.25h-.633z"
          />
        </svg>
      </button>
    </nav>
  );
}
