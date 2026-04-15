import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import BrandMark from '../components/BrandMark';
import api from '../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loginWithToken } = useAuthStore();

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
    }
  }, [searchParams, isAuthenticated, loginWithToken, navigate]);

  const error = searchParams.get('error');

  const handleSSOLogin = () => {
    window.location.href = '/api/auth/microsoft';
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-12">
          <div className="inline-flex mb-6">
            <BrandMark size="lg" />
          </div>
          <h1 className="text-4xl font-extrabold text-dark tracking-tight">
            Frontdoor
          </h1>
          {/*
            Sottotitolo temporaneamente rimosso.
            Valutiamo in seguito se reintrodurre un testo descrittivo più mirato.
          */}
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm text-center">
            {error === 'sso_denied' && "Accesso negato. Riprova o contatta l'amministratore."}
            {error === 'sso_failed' && "Errore durante l'autenticazione. Riprova."}
            {error === 'sso_init_failed' && 'Errore di connessione con Microsoft. Riprova.'}
            {error === 'invalid_state' && 'Sessione scaduta. Riprova.'}
            {!['sso_denied', 'sso_failed', 'sso_init_failed', 'invalid_state'].includes(error) &&
              "Si è verificato un errore. Riprova."}
          </div>
        )}

        {/* SSO Button */}
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
          Accedi
        </button>
      </div>
    </div>
  );
}
