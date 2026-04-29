import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import api from './services/api';
import { getUiStrings, normalizeLanguage } from './i18n';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const Admin = lazy(() => import('./pages/Admin'));
const Customization = lazy(() => import('./pages/Customization'));
const AdminGroups = lazy(() => import('./pages/AdminGroups'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminLogs = lazy(() => import('./pages/AdminLogs'));
const AdminAudit = lazy(() => import('./pages/AdminAudit'));
const AdminIcons = lazy(() => import('./pages/AdminIcons'));
const AdminBackup = lazy(() => import('./pages/AdminBackup'));

const ADMIN_VIEWER_ROLES = ['owner', 'admin', 'admin_readonly'];

function ProtectedRoute({ children, adminOnly = false, ownerOnly = false }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (ownerOnly && user?.role !== 'owner') return <Navigate to="/" replace />;
  if (adminOnly && !ADMIN_VIEWER_ROLES.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { isAuthenticated, user, updateUser } = useAuthStore();
  const ui = getUiStrings(normalizeLanguage('en'));

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return undefined;

    let cancelled = false;
    api.get('/auth/me')
      .then((res) => {
        if (!cancelled && res.data?.user) {
          updateUser(res.data.user);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id, updateUser]);

  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">{ui.common.loading}</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout>
                <Home />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <Admin />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/customization"
          element={
            <ProtectedRoute ownerOnly>
              <Layout>
                <Customization />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/groups"
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <AdminGroups />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <AdminUsers />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/logs"
          element={
            <ProtectedRoute ownerOnly>
              <Layout>
                <AdminLogs />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <ProtectedRoute ownerOnly>
              <Layout>
                <AdminAudit />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/icons"
          element={
            <ProtectedRoute adminOnly>
              <Layout>
                <AdminIcons />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/backup"
          element={
            <ProtectedRoute ownerOnly>
              <Layout>
                <AdminBackup />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
