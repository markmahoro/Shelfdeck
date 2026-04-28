/**
 * [UI] TopNav 导航栏 — 页面切换 + 子库选择。
 */

import type { AppPage, SubLibraryInfo } from '../App';

const MAIN_NAV: { id: AppPage; label: string }[] = [
  { id: 'continueWatching', label: '继续看' },
  { id: 'mediaManage', label: '媒体库管理' },
  { id: 'activityLog', label: '实时日志' },
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
      {/* 左侧：子库选择 */}
      <div className="topNavLeft">
        <span className="topNavLibLabel">当前媒体库</span>
        <select
          className="topNavSelect"
          value={subLibraryId}
          onChange={(e) => onSubLibraryChange(e.target.value)}
          title="选择子库"
        >
          <option value="">全部子库</option>
          {subLibraries.map((sl) => (
            <option key={sl.uuid} value={sl.uuid}>
              {sl.name}
            </option>
          ))}
        </select>
      </div>

      {/* 右侧：导航 tab + 设置 */}
      <div className="topNavRight">
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

        <button
          type="button"
          className="navTab navTabIcon"
          onClick={onSettingsClick}
          title="设置"
          aria-label="打开设置"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
