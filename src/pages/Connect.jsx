import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Bot, Check, EyeOff, Eye, Pencil, ShieldAlert } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useBrandingLanguage } from '../stores/brandingStore';
import { formatMessage, getUiStrings, resolveAppLanguage } from '../i18n';
import { apiErrorMessage } from '../utils/apiErrors';

// MCP consent page (docs/design/mcp/02-phase1-spec.md §4 rules 7–9). The
// server binds the request to this browser and accepts the decision only
// from this origin; the page itself is served with frame-ancestors 'none'.
// The user may untick frontdoor.preferences to connect read-only (ADR 0006).

const SCOPE_READ = 'frontdoor.read';
const SCOPE_PREFERENCES = 'frontdoor.preferences';

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8 shadow-xs">
        {children}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="mt-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-dark dark:text-gray-100">
        <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
        {title}
      </h2>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{children}</div>
    </section>
  );
}

export function ConnectError() {
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, useBrandingLanguage()));
  const code = searchParams.get('error');
  const message = apiErrorMessage({ code }, ui, ui.errors.mcp_consent_failed);
  return (
    <Shell>
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-6 w-6 shrink-0 text-red-500" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-bold text-dark dark:text-gray-100">{ui.connect.errorTitle}</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300" role="alert">{message}</p>
          <Link to="/" className="mt-5 inline-flex rounded-xl bg-dark px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{ui.connect.backHome}</Link>
        </div>
      </div>
    </Shell>
  );
}

export default function Connect() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, useBrandingLanguage()));
  const copy = ui.connect;
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [keepPreferences, setKeepPreferences] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get(`/mcp/authorizations/${encodeURIComponent(id)}`)
      .then((res) => { if (!cancelled) setRequest(res.data.authorization); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, ui, ui.errors.mcp_authorization_not_found)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per request id
  }, [id]);

  const decide = async (approve) => {
    setBusy(true);
    try {
      const scopes = request.scopes.filter((scope) => scope === SCOPE_READ || (scope === SCOPE_PREFERENCES && keepPreferences));
      const res = await api.post(`/mcp/authorizations/${encodeURIComponent(id)}/decision`, approve ? { approve, scopes } : { approve });
      // The server built this URL from the redirect URI it validated (rule 4).
      window.location.assign(res.data.location);
    } catch (err) {
      setError(apiErrorMessage(err, ui, ui.errors.mcp_consent_failed));
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-6 w-6 shrink-0 text-red-500" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-bold text-dark dark:text-gray-100">{copy.errorTitle}</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300" role="alert">{error}</p>
            <Link to="/" className="mt-5 inline-flex rounded-xl bg-dark px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{copy.backHome}</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!request) {
    return <Shell><p className="text-sm text-gray-500" role="status">{copy.loading}</p></Shell>;
  }

  return (
    <Shell>
      <div className="flex items-start gap-3">
        <Bot className="h-7 w-7 shrink-0 text-accent-dark dark:text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-dark dark:text-gray-100 break-words">{formatMessage(copy.title, { name: request.clientName })}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-words">
            {request.clientHost
              ? formatMessage(copy.requestedBy, { host: request.clientHost, redirect: request.redirectHost })
              : formatMessage(copy.returnsTo, { redirect: request.redirectHost })}
          </p>
        </div>
      </div>

      <Section icon={Eye} title={copy.canSeeTitle}>
        <ul className="list-disc space-y-1 pl-5">
          {request.exposedFields.map((field) => (
            <li key={field}>{copy[`field_${field}`] || field}</li>
          ))}
        </ul>
      </Section>
      <Section icon={Pencil} title={copy.canDoTitle}>
        {request.scopes.includes(SCOPE_PREFERENCES) ? (
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={keepPreferences}
              onChange={(event) => setKeepPreferences(event.target.checked)}
              disabled={busy}
              aria-labelledby="connect-preferences-label"
              aria-describedby="connect-preferences-help"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-dark focus:ring-2 focus:ring-accent"
            />
            <span>
              <span id="connect-preferences-label" className="block font-medium text-dark dark:text-gray-100">{copy.canDoPreferences}</span>
              <span id="connect-preferences-help" className="block text-xs text-gray-500 dark:text-gray-400">{copy.canDoPreferencesHelp}</span>
            </span>
          </label>
        ) : copy.canDoNothing}
      </Section>
      <Section icon={EyeOff} title={copy.neverTitle}>{copy.never}</Section>

      <p className="mt-5 text-sm font-medium text-dark dark:text-gray-100 break-words">
        {formatMessage(copy.signedInAs, { name: user?.displayName || '', email: user?.email || '' })}
      </p>
      <p className="mt-3 rounded-2xl bg-gray-50 dark:bg-gray-800/60 p-3 text-xs text-gray-500 dark:text-gray-400">{copy.typedNote}</p>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={busy}
          className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
        >
          {copy.deny}
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {busy ? copy.redirecting : copy.approve}
        </button>
      </div>
    </Shell>
  );
}
