import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Login from './pages/Login';
import Home from './pages/Home';
import Admin from './pages/Admin';
import Personalizza from './pages/Personalizza';
import AdminGroups from './pages/AdminGroups';
import AdminUsers from './pages/AdminUsers';
import AdminLogs from './pages/AdminLogs';
import AdminAudit from './pages/AdminAudit';
import Layout from './components/Layout';

const ADMIN_VIEWER_ROLES = ['superadmin', 'admin', 'admin_readonly'];

function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (superAdminOnly && user?.role !== 'superadmin') return <Navigate to="/" replace />;
  if (adminOnly && !ADMIN_VIEWER_ROLES.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
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
        path="/admin/personalizza"
        element={
          <ProtectedRoute superAdminOnly>
            <Layout>
              <Personalizza />
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
          <ProtectedRoute superAdminOnly>
            <Layout>
              <AdminLogs />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/audit"
        element={
          <ProtectedRoute superAdminOnly>
            <Layout>
              <AdminAudit />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
