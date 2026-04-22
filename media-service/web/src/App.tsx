import { Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import ConfigPage from './pages/ConfigPage';
import TaskCenterPage from './pages/TaskCenterPage';
import DoubanPage from './pages/DoubanPage';
import PathMappingPage from './pages/PathMappingPage';
import { auth } from './api/client';

function RequireAuth({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    auth
      .getStatus()
      .then((s) => {
        if (!s.pinSet) {
          window.location.hash = '#/setup';
        } else if (!sessionStorage.getItem('admin_session')) {
          window.location.hash = '#/login';
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => {
        window.location.hash = '#/login';
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  return authorized ? children : null;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="tasks" element={<TaskCenterPage />} />
          <Route path="douban" element={<DoubanPage />} />
          <Route path="paths" element={<PathMappingPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </HashRouter>
  );
}
