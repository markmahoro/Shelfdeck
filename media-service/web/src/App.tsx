import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import MediaLibrariesPage from './pages/MediaLibrariesPage';
import TranscodeConfigPage from './pages/TranscodeConfigPage';
import TaskMonitorPage from './pages/TaskMonitorPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="media-libraries" element={<MediaLibrariesPage />} />
        <Route path="transcode" element={<TranscodeConfigPage />} />
        <Route path="tasks" element={<TaskMonitorPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
