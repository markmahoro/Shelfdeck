import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { ErrorBoundary, Loading } from './components/ui';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const LibrariesPage = lazy(() => import('./pages/LibrariesPage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
const PeoplePage = lazy(() => import('./pages/PeoplePage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const CleanupPage = lazy(() => import('./pages/CleanupPage'));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const page = (element: React.ReactNode) => <Suspense fallback={<Loading />}>{element}</Suspense>;

export default function App() {
  return <ErrorBoundary><Routes>
    <Route element={<Layout />}>
      <Route index element={page(<OverviewPage />)} />
      <Route path="libraries" element={page(<LibrariesPage />)} />
      <Route path="media" element={page(<MediaPage />)} />
      <Route path="people" element={page(<PeoplePage />)} />
      <Route path="tasks" element={page(<TasksPage />)} />
      <Route path="cleanup" element={page(<CleanupPage />)} />
      <Route path="policies" element={page(<PoliciesPage />)} />
      <Route path="settings" element={page(<SettingsPage />)} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></ErrorBoundary>;
}
