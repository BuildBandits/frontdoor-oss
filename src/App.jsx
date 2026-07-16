import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import api from './services/api';
import { getUiStrings, normalizeLanguage } from './i18n';
import { useColorScheme } from './hooks/useColorScheme';
import { useDocumentLanguage } from './hooks/useDocumentLanguage';
import PluginHostProvider, { usePluginRuntimeApi } from './pluginHost/PluginHostProvider';
import { usePluginRegistry } from './pluginHost/registry';
import { PLUGIN_ACCESS } from './pluginHost/constants';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const Admin = lazy(() => import('./pages/Admin'));
const Customization = lazy(() => import('./pages/Customization'));
const AdminGroups = lazy(() => import('./pages/AdminGroups'));
const AdminGroupTransfer = lazy(() => import('./pages/AdminGroupTransfer'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminLogs = lazy(() => import('./pages/AdminLogs'));
const AdminAudit = lazy(() => import('./pages/AdminAudit'));
const AdminPluginAudit = lazy(() => import('./pages/AdminPluginAudit'));
const AdminPluginDocs = lazy(() => import('./pages/AdminPluginDocs'));
const AdminIcons = lazy(() => import('./pages/AdminIcons'));
const AdminBackup = lazy(() => import('./pages/AdminBackup'));
const AdminPlugins = lazy(() => import('./pages/AdminPlugins'));

const ADMIN_VIEWER_ROLES = ['owner', 'admin', 'admin_readonly'];
const ADMIN_EDITOR_ROLES = ['owner', 'admin'];

function ProtectedRoute({
  children,
  adminOnly = false,
  adminEditorOnly = false,
  ownerOnly = false,
  allowedRoles = null,
}) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (ownerOnly && user?.role !== 'owner') return <Navigate to="/" replace />;
  if (adminOnly && !ADMIN_VIEWER_ROLES.includes(user?.role)) return <Navigate to="/" replace />;
  if (adminEditorOnly && !ADMIN_EDITOR_ROLES.includes(user?.role)) return <Navigate to="/" replace />;
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function resolveRouteElement(route, runtimeApi = null) {
  if (typeof route.render === 'function') {
    return route.render(runtimeApi);
  }

  if (route.element && typeof route.element === 'function') {
    const Element = route.element;
    return <Element />;
  }

  return route.element || null;
}

function wrapRouteAccess(route, element) {
  if (Array.isArray(route.roles) && route.roles.length > 0) {
    return <ProtectedRoute allowedRoles={route.roles}>{element}</ProtectedRoute>;
  }

  switch (route.access) {
    case PLUGIN_ACCESS.PUBLIC:
      return element;
    case PLUGIN_ACCESS.ADMIN:
      return <ProtectedRoute adminOnly>{element}</ProtectedRoute>;
    case PLUGIN_ACCESS.ADMIN_EDITOR:
      return <ProtectedRoute adminEditorOnly>{element}</ProtectedRoute>;
    case PLUGIN_ACCESS.OWNER:
      return <ProtectedRoute ownerOnly>{element}</ProtectedRoute>;
    case PLUGIN_ACCESS.AUTHENTICATED:
    default:
      return <ProtectedRoute>{element}</ProtectedRoute>;
  }
}

function AppRoutes() {
  const pluginRoutes = usePluginRegistry((snapshot) => snapshot.routes);
  const pluginRuntimeApi = usePluginRuntimeApi();
  const pluginsEnabled = pluginRuntimeApi?.pluginsEnabled === true;
  const { isAuthenticated, user, updateUser } = useAuthStore();
  const ui = getUiStrings(normalizeLanguage('en'));
  useColorScheme(user?.preferredColorScheme);
  useDocumentLanguage(user?.preferredLanguage);

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

  const coreRoutes = [
    { path: '/login', element: <Login />, access: PLUGIN_ACCESS.PUBLIC, layout: 'none' },
    { path: '/', element: <Home />, access: PLUGIN_ACCESS.AUTHENTICATED, layout: 'app' },
    { path: '/admin', element: <Admin />, access: PLUGIN_ACCESS.ADMIN, layout: 'app' },
    { path: '/admin/customization', element: <Customization />, access: PLUGIN_ACCESS.OWNER, layout: 'app' },
    { path: '/admin/groups', element: <AdminGroups />, access: PLUGIN_ACCESS.ADMIN, layout: 'app' },
    { path: '/admin/group-transfer', element: <AdminGroupTransfer />, access: PLUGIN_ACCESS.ADMIN_EDITOR, layout: 'app' },
    { path: '/admin/users', element: <AdminUsers />, access: PLUGIN_ACCESS.ADMIN, layout: 'app' },
    { path: '/admin/logs', element: <AdminLogs />, access: PLUGIN_ACCESS.OWNER, layout: 'app' },
    { path: '/admin/audit', element: <AdminAudit />, access: PLUGIN_ACCESS.OWNER, layout: 'app' },
    { path: '/admin/plugins/audit', element: <AdminPluginAudit />, access: PLUGIN_ACCESS.OWNER, layout: 'app' },
    { path: '/admin/plugins/docs', element: <AdminPluginDocs />, access: PLUGIN_ACCESS.ADMIN, layout: 'app' },
    { path: '/admin/icons', element: <AdminIcons />, access: PLUGIN_ACCESS.ADMIN, layout: 'app' },
    { path: '/admin/backup', element: <AdminBackup />, access: PLUGIN_ACCESS.OWNER, layout: 'app' },
    { path: '/admin/plugins', element: <AdminPlugins />, access: PLUGIN_ACCESS.ADMIN, layout: 'app' },
  ];

  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500 dark:text-gray-400">{ui.common.loading}</div>}>
      <Routes>
        {coreRoutes.map((route) => {
          const isPluginAdminRoute = route.path.startsWith('/admin/plugins');
          const element = !pluginsEnabled && isPluginAdminRoute
            ? <Navigate to="/" replace />
            : route.layout === 'app'
              ? <Layout>{resolveRouteElement(route, pluginRuntimeApi)}</Layout>
              : resolveRouteElement(route, pluginRuntimeApi);
          return (
            <Route
              key={route.path}
              path={route.path}
              element={wrapRouteAccess(route, element)}
            />
          );
        })}

        {pluginsEnabled && pluginRoutes.map((route) => {
          const element = route.layout === 'app'
            ? <Layout>{resolveRouteElement(route, pluginRuntimeApi)}</Layout>
            : resolveRouteElement(route, pluginRuntimeApi);
          return (
            <Route
              key={route.id}
              path={route.path}
              element={wrapRouteAccess(route, element)}
            />
          );
        })}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <PluginHostProvider>
      <AppRoutes />
    </PluginHostProvider>
  );
}
