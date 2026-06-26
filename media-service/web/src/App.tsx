import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import TranscodeConfigPage from './pages/TranscodeConfigPage';
import DoubanConfigPage from './pages/DoubanConfigPage';
import TaskMonitorPage from './pages/TaskMonitorPage';
import SystemConfigPage from './pages/SystemConfigPage';
import MoviePilotConfigPage from './pages/MoviePilotConfigPage';
import MediaManagePage from './pages/MediaManagePage';
import RuleTemplatesPage from './pages/RuleTemplatesPage';
import NodesPage from './pages/NodesPage';
import AdultConfigPage from './pages/AdultConfigPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="media" element={<MediaManagePage />} />
        <Route path="nodes" element={<NodesPage />} />
        <Route path="tasks" element={<TaskMonitorPage />} />
        <Route path="rules" element={<RuleTemplatesPage />} />
        <Route path="system" element={<SystemConfigPage />} />
        <Route path="douban" element={<DoubanConfigPage />} />
        <Route path="transcode" element={<TranscodeConfigPage />} />
        <Route path="adult" element={<AdultConfigPage />} />
        <Route path="moviepilot" element={<MoviePilotConfigPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
