import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import TaskMonitorPage from './pages/TaskMonitorPage';
import MediaManagePage from './pages/MediaManagePage';
import OffboardingCandidatesPage from './pages/OffboardingCandidatesPage';
import PoliciesPage from './pages/PoliciesPage';
import AdvancedPage from './pages/AdvancedPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="media" element={<MediaManagePage />} />
        <Route path="tasks" element={<TaskMonitorPage />} />
        <Route path="offboarding" element={<OffboardingCandidatesPage />} />
        <Route path="policies" element={<PoliciesPage />} />
        <Route path="advanced" element={<AdvancedPage />} />
        <Route path="rules" element={<Navigate to="/policies?tab=objectives" replace />} />
        <Route path="system" element={<Navigate to="/policies?tab=automation" replace />} />
        <Route path="douban" element={<Navigate to="/policies?tab=perception" replace />} />
        <Route path="adult" element={<Navigate to="/policies?tab=library" replace />} />
        <Route path="moviepilot" element={<Navigate to="/policies?tab=automation" replace />} />
        <Route path="transcode" element={<Navigate to="/advanced?tab=resources" replace />} />
        <Route path="nodes" element={<Navigate to="/advanced?tab=resources" replace />} />
        <Route path="capacity" element={<Navigate to="/advanced?tab=resources" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
