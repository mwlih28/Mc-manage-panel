import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { Spinner } from '@/components/ui/Spinner';
import { ThemeCssInjector } from '@/components/ThemeCssInjector';
import api from '@/lib/axios';

// Route-level code splitting — keeps the initial bundle small since most
// users only ever touch a handful of these pages in a given session, and
// admin-only pages never need to ship to non-admin users at all.
const LoginPage          = lazy(() => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage       = lazy(() => import('@/pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage  = lazy(() => import('@/pages/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const SetupPage          = lazy(() => import('@/pages/auth/SetupPage').then(m => ({ default: m.SetupPage })));
const DashboardPage      = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ServersPage        = lazy(() => import('@/pages/servers/ServersPage').then(m => ({ default: m.ServersPage })));
const ServerDetailPage   = lazy(() => import('@/pages/servers/ServerDetailPage').then(m => ({ default: m.ServerDetailPage })));
const AccountPage        = lazy(() => import('@/pages/AccountPage').then(m => ({ default: m.AccountPage })));
const MotdGeneratorPage  = lazy(() => import('@/pages/tools/MotdGeneratorPage').then(m => ({ default: m.MotdGeneratorPage })));
const LogoGeneratorPage  = lazy(() => import('@/pages/tools/LogoGeneratorPage').then(m => ({ default: m.LogoGeneratorPage })));
const AdminOverviewPage  = lazy(() => import('@/pages/admin/AdminOverviewPage').then(m => ({ default: m.AdminOverviewPage })));
const AdminUsersPage     = lazy(() => import('@/pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminNodesPage     = lazy(() => import('@/pages/admin/AdminNodesPage').then(m => ({ default: m.AdminNodesPage })));
const AdminServersPage   = lazy(() => import('@/pages/admin/AdminServersPage').then(m => ({ default: m.AdminServersPage })));
const AdminEggsPage      = lazy(() => import('@/pages/admin/AdminEggsPage').then(m => ({ default: m.AdminEggsPage })));
const AdminActivityPage  = lazy(() => import('@/pages/admin/AdminActivityPage').then(m => ({ default: m.AdminActivityPage })));
const AdminSettingsPage  = lazy(() => import('@/pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const AdminApiKeysPage   = lazy(() => import('@/pages/admin/AdminApiKeysPage').then(m => ({ default: m.AdminApiKeysPage })));
const AdminApiDocsPage   = lazy(() => import('@/pages/admin/AdminApiDocsPage').then(m => ({ default: m.AdminApiDocsPage })));
const AdminWebhooksPage  = lazy(() => import('@/pages/admin/AdminWebhooksPage').then(m => ({ default: m.AdminWebhooksPage })));
const AdminMigrationPage = lazy(() => import('@/pages/admin/AdminMigrationPage').then(m => ({ default: m.AdminMigrationPage })));
const AdminIntegrationsPage = lazy(() => import('@/pages/admin/AdminIntegrationsPage').then(m => ({ default: m.AdminIntegrationsPage })));
const PublicStatusPage   = lazy(() => import('@/pages/PublicStatusPage').then(m => ({ default: m.PublicStatusPage })));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0c' }}>
      <Spinner size="lg" />
    </div>
  );
}

export default function App() {
  const { i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      if (data['app.title']) document.title = data['app.title'];
    }).catch(() => {});
  }, []);

  // A logged-in user's saved language preference takes priority over the
  // browser-detected/localStorage language once we know who they are.
  useEffect(() => {
    if (user?.language && user.language !== i18n.language) {
      i18n.changeLanguage(user.language);
    }
  }, [user?.language, i18n]);

  return (
    <Suspense fallback={<RouteFallback />}>
      <ThemeCssInjector />
      <Routes>
        {/* Public routes */}
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/status/:slug" element={<PublicStatusPage />} />

        {/* Protected user routes */}
        <Route element={<RequireAuth />}>
          <Route element={<PanelLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/servers" element={<ServersPage />} />
            <Route path="/servers/:id" element={<ServerDetailPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/tools/motd-generator" element={<MotdGeneratorPage />} />
            <Route path="/tools/logo-generator" element={<LogoGeneratorPage />} />
          </Route>
        </Route>

        {/* Protected admin routes — completely separate layout */}
        <Route element={<RequireAuth requireAdmin />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/servers" element={<AdminServersPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/nodes" element={<AdminNodesPage />} />
            <Route path="/admin/eggs" element={<AdminEggsPage />} />
            <Route path="/admin/activity" element={<AdminActivityPage />} />
            <Route path="/admin/api-keys" element={<AdminApiKeysPage />} />
            <Route path="/admin/api-docs" element={<AdminApiDocsPage />} />
            <Route path="/admin/webhooks" element={<AdminWebhooksPage />} />
            <Route path="/admin/migration" element={<AdminMigrationPage />} />
            <Route path="/admin/integrations" element={<AdminIntegrationsPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
          </Route>
        </Route>

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
