import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { SetupPage } from '@/pages/auth/SetupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ServersPage } from '@/pages/servers/ServersPage';
import { ServerDetailPage } from '@/pages/servers/ServerDetailPage';
import { AccountPage } from '@/pages/AccountPage';
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { AdminNodesPage } from '@/pages/admin/AdminNodesPage';
import { AdminServersPage } from '@/pages/admin/AdminServersPage';
import { AdminEggsPage } from '@/pages/admin/AdminEggsPage';
import { AdminActivityPage } from '@/pages/admin/AdminActivityPage';
import { AdminSettingsPage } from '@/pages/admin/AdminSettingsPage';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { RequireAuth } from '@/components/layout/RequireAuth';
import api from '@/lib/axios';

export default function App() {
  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      if (data['app.title']) document.title = data['app.title'];
    }).catch(() => {});
  }, []);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route element={<PanelLayout />}>
          {/* User routes */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/servers/:id" element={<ServerDetailPage />} />
          <Route path="/account" element={<AccountPage />} />

          {/* Admin routes */}
          <Route element={<RequireAuth requireAdmin />}>
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/servers" element={<AdminServersPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/nodes" element={<AdminNodesPage />} />
            <Route path="/admin/eggs" element={<AdminEggsPage />} />
            <Route path="/admin/activity" element={<AdminActivityPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
          </Route>
        </Route>
      </Route>

      {/* Redirects */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
