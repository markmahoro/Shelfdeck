import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import TranscodeConfigPage from './pages/TranscodeConfigPage';
import DoubanConfigPage from './pages/DoubanConfigPage';
import TaskMonitorPage from './pages/TaskMonitorPage';
import SystemConfigPage from './pages/SystemConfigPage';
import MoviePilotConfigPage from './pages/MoviePilotConfigPage';
import MediaManagePage from './pages/MediaManagePage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="media" element={<MediaManagePage />} />
        <Route path="transcode" element={<TranscodeConfigPage />} />
        <Route path="douban" element={<DoubanConfigPage />} />
        <Route path="tasks" element={<TaskMonitorPage />} />
        <Route path="system" element={<SystemConfigPage />} />
        <Route path="moviepilot" element={<MoviePilotConfigPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
