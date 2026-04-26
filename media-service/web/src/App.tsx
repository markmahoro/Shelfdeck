import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import MediaLibrariesPage from './pages/MediaLibrariesPage';
import TranscodeConfigPage from './pages/TranscodeConfigPage';
import DoubanConfigPage from './pages/DoubanConfigPage';
import TaskMonitorPage from './pages/TaskMonitorPage';
import SystemConfigPage from './pages/SystemConfigPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="media-libraries" element={<MediaLibrariesPage />} />
        <Route path="transcode" element={<TranscodeConfigPage />} />
        <Route path="douban" element={<DoubanConfigPage />} />
        <Route path="tasks" element={<TaskMonitorPage />} />
        <Route path="system" element={<SystemConfigPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
