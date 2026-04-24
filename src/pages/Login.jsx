import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import BrandMark from '../components/BrandMark';
import AppFooter from '../components/AppFooter';
import api from '../services/api';
import { getUiStrings, normalizeLanguage } from '../i18n';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loginWithToken } = useAuthStore();
  const [branding, setBranding] = useState(null);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const error = searchParams.get('error');
  const language = normalizeLanguage(branding?.defaultLanguage);
  const ui = getUiStrings(language);

  useEffect(() => {
    api.get('/branding')
      .then((res) => setBranding(res.data.branding || null))
      .catch(() => setBranding(null))
      .finally(() => setBrandingLoading(false));
  }, []);

  useEffect(() => {
    // If already authenticated, redirect to home
    if (isAuthenticated) {
      navigate('/', { replace: true });
      return;
    }

    // Handle SSO callback: token is in httpOnly cookie, fetch profile via /api/auth/me
    // to avoid passing PII (email, role) through the URL.
    const ssoOk = searchParams.get('sso');
    if (ssoOk === 'ok') {
      api.get('/auth/me').then((res) => {
        loginWithToken(null, res.data.user);

        // Check for redirect to a specific app subdomain (validated: only alphanumeric slugs)
        const redirect = searchParams.get('redirect');
        if (redirect && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(redirect)) {
          const baseDomain = window.location.hostname;
          window.location.href = `${window.location.protocol}//${redirect}.${baseDomain}`;
        } else {
          navigate('/', { replace: true });
        }
      }).catch(() => {
        // /api/auth/me failed — cookie may not have been set correctly, stay on login page
      });
      return;
    }

    if (!brandingLoading && branding?.hideLoginPage && !error && !ssoOk) {
      window.location.href = '/api/auth/microsoft';
    }
  }, [searchParams, error, isAuthenticated, loginWithToken, navigate, branding, brandingLoading]);

  const handleSSOLogin = () => {
    window.location.href = '/api/auth/microsoft';
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA]">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Logo/Brand */}
          <div className="text-center mb-12">
            <div className="inline-flex mb-6">
              <BrandMark size="lg" />
            </div>
            <h1 className="text-4xl font-extrabold text-dark tracking-tight">
              {ui.login.title}
            </h1>
            {/*
              Sottotitolo temporaneamente rimosso.
              Valutiamo in seguito se reintrodurre un testo descrittivo più mirato.
            */}
          </div>

          {brandingLoading && (
            <div className="mb-6 p-4 bg-white border border-gray-200 rounded-xl text-gray-500 text-sm text-center">
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
        </div>
      </div>

      <AppFooter language={language} />
    </div>
  );
}
