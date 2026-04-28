/**
 * [UI] App 根组件 — v2 瘦客户端架构。
 *
 * 职责：页面路由、子库选择、全局任务轮询。不做配置管理、任务管理、策略计算。
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from './api/client';
import { createPoller } from './api/polling';
import { getBaseUrl } from './connection/baseUrl';
import TopNav from './components/TopNav';
import ConnectionGate from './connection/ConnectionGate';
import FloatingTaskButton from './components/FloatingTaskButton';
import SettingsPanel from './settings/SettingsPanel';
import ContinueWatchingPage from './pages/ContinueWatchingPage';
import MediaManagePage from './pages/MediaManagePage';
import ActivityLogPage from './pages/ActivityLogPage';
import type { MediaTask } from './models/task';

export type AppPage = 'continueWatching' | 'mediaManage' | 'activityLog';

export type SubLibraryInfo = {
  uuid: string;
  name: string;
  enabled: boolean;
};

export default function App() {
  const [page, setPage] = useState<AppPage>('continueWatching');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [subLibraries, setSubLibraries] = useState<SubLibraryInfo[]>([]);
  const [subLibraryId, setSubLibraryId] = useState<string>(''); // '' = 全部

  const baseUrl = getBaseUrl();

  // ── 子库列表 ──
  useEffect(() => {
    apiClient.getLibraryStatus().then((s) => {
      setSubLibraries(s.subLibraries.filter((sl) => sl.enabled));
    }).catch(() => {});
  }, []);

  // ── 任务轮询（400ms，全局） ──
  useEffect(() => {
    const poller = createPoller(
      () => apiClient.getTasks(),
      (data) => setTasks(data),
      400,
    );
    poller.start();
    return () => poller.stop();
  }, []);

  const onSettingsClick = useCallback(() => setSettingsOpen(true), []);

  return (
    <div className="appShell">
      <TopNav
        page={page}
        setPage={setPage}
        onSettingsClick={onSettingsClick}
        subLibraries={subLibraries}
        subLibraryId={subLibraryId}
        onSubLibraryChange={setSubLibraryId}
      />

      <ConnectionGate onSettingsOpen={onSettingsClick}>
        {page === 'continueWatching' && <ContinueWatchingPage tasks={tasks} subLibraryId={subLibraryId} />}
        {page === 'mediaManage' && <MediaManagePage tasks={tasks} subLibraryId={subLibraryId} />}
        {page === 'activityLog' && <ActivityLogPage />}
      </ConnectionGate>

      <FloatingTaskButton baseUrl={baseUrl} />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
