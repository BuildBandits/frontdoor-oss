import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import BrandMark from '../components/BrandMark';
import AppFooter from '../components/AppFooter';
import api from '../services/api';
import { getUiStrings, normalizeLanguage } from '../i18n';
import { rememberReturnPath, takeReturnPath } from '../utils/returnPath';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loginWithToken } = useAuthStore();
  const [branding, setBranding] = useState(null);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [devLogin, setDevLogin] = useState(false);
  const [devRole, setDevRole] = useState('owner');
  const [devLoading, setDevLoading] = useState(false);
  const error = searchParams.get('error');
  const language = normalizeLanguage(branding?.defaultLanguage);
  const ui = getUiStrings(language);
  const redirect = searchParams.get('redirect');
  const validRedirect = redirect && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(redirect)
    ? redirect
    : null;
  const devRoleLabels = {
    owner: ui.admin.users.ownerBadge,
    admin: ui.admin.users.adminBadge,
    admin_readonly: ui.admin.users.readOnlyRole,
    user: ui.admin.users.userBadge,
  };

  useEffect(() => {
    api.get('/branding')
      .then((res) => setBranding(res.data.branding || null))
      .catch(() => setBranding(null))
      .finally(() => setBrandingLoading(false));
    api.get('/auth/dev-status')
      .then((res) => setDevLogin(res.data.devLogin === true))
      .catch(() => setDevLogin(false));
  }, []);

  useEffect(() => {
    // Page the user was trying to open before signing in (kept across the Microsoft round trip).
    rememberReturnPath(searchParams.get('next'));

    // If already authenticated, continue through the server-side app launcher.
    // For mode=redirect apps, the backend reads target_url and emits the SSO POST.
    if (isAuthenticated) {
      if (validRedirect) {
        window.location.href = `/api/apps/${validRedirect}/sso-redirect`;
      } else {
        navigate(takeReturnPath(), { replace: true });
      }
      return;
    }

    // Handle SSO callback: token is in httpOnly cookie, fetch profile via /api/auth/me
    // to avoid passing PII (email, role) through the URL.
    const ssoOk = searchParams.get('sso');
    if (ssoOk === 'ok') {
      api.get('/auth/me').then((res) => {
        loginWithToken(null, res.data.user);

        // Continue through the server-side app launcher: it resolves the app
        // target_url from the catalog and handles Redirect SSO/POST correctly.
        if (validRedirect) {
          window.location.href = `/api/apps/${validRedirect}/sso-redirect`;
        } else {
          navigate(takeReturnPath(), { replace: true });
        }
      }).catch(() => {
        // /api/auth/me failed — cookie may not have been set correctly, stay on login page
      });
      return;
    }

    if (!brandingLoading && branding?.hideLoginPage && !error && !ssoOk) {
      window.location.href = validRedirect
        ? `/api/auth/microsoft?redirect=${encodeURIComponent(validRedirect)}`
        : '/api/auth/microsoft';
    }
  }, [searchParams, error, isAuthenticated, loginWithToken, navigate, branding, brandingLoading, validRedirect]);

  const handleSSOLogin = () => {
    window.location.href = validRedirect
      ? `/api/auth/microsoft?redirect=${encodeURIComponent(validRedirect)}`
      : '/api/auth/microsoft';
  };

  const handleDevLogin = async () => {
    setDevLoading(true);
    try {
      const res = await api.post('/auth/dev-login', { role: devRole });
      loginWithToken(null, res.data.user);
      navigate(takeReturnPath(), { replace: true });
    } catch {
      setDevLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-gray-950">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Logo/Brand */}
          <div className="text-center mb-12">
            <div className="inline-flex mb-6">
              <BrandMark size="lg" />
            </div>
            <h1 className="text-4xl font-extrabold text-dark dark:text-gray-100 tracking-tight">
              {ui.login.title}
            </h1>
            {/*
              Subtitle temporarily removed.
              We may reintroduce a more focused description later.
            */}
          </div>

          {brandingLoading && (
            <div className="mb-6 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-500 dark:text-gray-400 text-sm text-center">
              {ui.login.loadingAuth}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm text-center">
              {ui.login.errors[error] || ui.login.errors.generic}
            </div>
          )}

          {!branding?.hideLoginPage && (
            <button
              onClick={handleSSOLogin}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-dark text-white rounded-xl font-semibold text-lg hover:bg-gray-800 transition-colors cursor-pointer"
              >
              <svg width="21" height="21" viewBox="0 0 21 21" fill="none">
                <rect width="10" height="10" fill="#F25022" />
                <rect x="11" width="10" height="10" fill="#7FBA00" />
                <rect y="11" width="10" height="10" fill="#00A4EF" />
                <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
              </svg>
              {ui.login.signIn}
            </button>
          )}

          {devLogin && (
            <div className="mt-6 p-4 bg-amber-50 border border-amber-300 rounded-xl">
              <p className="text-amber-800 text-xs font-semibold uppercase tracking-wide mb-3">{ui.login.devLoginTitle}</p>
              <div className="flex gap-2 mb-3">
                {['owner', 'admin', 'admin_readonly', 'user'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setDevRole(r)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      devRole === r
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white dark:bg-gray-900 text-amber-800 border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    {devRoleLabels[r]}
                  </button>
                ))}
              </div>
              <button
                onClick={handleDevLogin}
                disabled={devLoading}
                className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg font-semibold text-sm hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {devLoading ? ui.login.devLoginLoading : ui.login.devLoginEnterAs.replace('{role}', devRoleLabels[devRole] || devRole)}
              </button>
            </div>
          )}
        </div>
      </div>

      <AppFooter language={language} />
    </div>
  );
}
