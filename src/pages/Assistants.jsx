import { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, KeyRound, Plug, PowerOff, Trash2 } from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import TopToastNotice from '../components/TopToastNotice';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { useBrandingLanguage } from '../stores/brandingStore';
import { formatMessage, getUiStrings, resolveAppLanguage } from '../i18n';
import { apiErrorMessage } from '../utils/apiErrors';
import { formatLocalDateTime } from '../utils/dateTime';

const card = 'rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xs';
const input = 'w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-hidden focus:ring-2 focus:ring-accent';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60';

function CopyField({ label, value, copy }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the value stays selectable.
    }
  };
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-dark dark:text-gray-100 select-all">{value}</code>
        <button type="button" onClick={onCopy} className={`${button} border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800`}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          {copied ? copy.copied : copy.copy}
        </button>
      </div>
    </div>
  );
}

function OwnerPanel({ ui, copy, formatDate, notify, confirm, onEnabledChange, refreshKey }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ kind: 'cimd', name: '', clientId: '', redirectUris: '' });
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const load = useCallback(() => api.get('/mcp/settings').then((res) => setState(res.data)), []);
  useEffect(() => {
    load().catch((err) => notify('error', apiErrorMessage(err, ui, copy.loadFailed)));
  }, [load, notify, ui, copy.loadFailed, refreshKey]);

  if (!state) return null;

  const toggle = async (enabled) => {
    setBusy(true);
    try {
      await api.put('/mcp/settings', { enabled });
      await load();
      onEnabledChange(enabled);
      notify('success', copy.enabledSaved);
    } catch (err) {
      notify('error', apiErrorMessage(err, ui, copy.loadFailed));
    } finally {
      setBusy(false);
    }
  };

  const addClient = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = form.kind === 'cimd'
        ? { kind: 'cimd', name: form.name, clientId: form.clientId.trim() }
        : { kind: 'registered', name: form.name, redirectUris: form.redirectUris.split('\n').map((line) => line.trim()).filter(Boolean) };
      const res = await api.post('/mcp/clients', body);
      if (res.data.clientSecret) setCredentials({ clientId: res.data.client.client_id, clientSecret: res.data.clientSecret });
      setForm({ kind: form.kind, name: '', clientId: '', redirectUris: '' });
      await load();
      notify('success', copy.added);
    } catch (err) {
      notify('error', apiErrorMessage(err, ui, ui.errors.mcp_client_change_failed));
    } finally {
      setBusy(false);
    }
  };

  const removeClient = (client) => confirm({
    title: formatMessage(copy.removeTitle, { name: client.name }),
    message: copy.removeMessage,
    confirmLabel: copy.remove,
    onConfirm: async () => {
      try {
        await api.delete(`/mcp/clients/${encodeURIComponent(client.id)}`);
        await load();
        notify('success', copy.removed);
      } catch (err) {
        notify('error', apiErrorMessage(err, ui, ui.errors.mcp_client_change_failed));
      }
    },
  });

  const killSwitch = () => confirm({
    title: copy.killConfirmTitle,
    message: copy.killConfirmMessage,
    confirmLabel: copy.killButton,
    onConfirm: async () => {
      try {
        const res = await api.post('/mcp/kill-switch');
        await load();
        notify('success', formatMessage(copy.killDone, { count: res.data.grantsRevoked }));
      } catch (err) {
        notify('error', apiErrorMessage(err, ui, copy.loadFailed));
      }
    },
  });

  const enabled = state.settings.enabled;
  return (
    <section className={card} aria-labelledby="assistants-owner-title">
      <h2 id="assistants-owner-title" className="text-lg font-bold text-dark dark:text-gray-100">{copy.ownerTitle}</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy.ownerIntro}</p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="assistants-enabled" className="text-sm font-semibold text-dark dark:text-gray-100">{copy.enabledLabel}</label>
        <select
          id="assistants-enabled"
          value={enabled ? 'on' : 'off'}
          disabled={busy || (!enabled && !state.configurable)}
          onChange={(event) => toggle(event.target.value === 'on')}
          className={`${input} max-w-40`}
        >
          <option value="off">{copy.enabledOff}</option>
          <option value="on">{copy.enabledOn}</option>
        </select>
      </div>
      <div className="mt-4">
        {state.endpoint
          ? <CopyField label={copy.endpointLabel} value={state.endpoint} copy={copy} />
          : <p className="text-sm text-amber-700 dark:text-amber-300" role="status">{copy.endpointMissing}</p>}
      </div>

      <h3 className="mt-8 text-base font-bold text-dark dark:text-gray-100">{copy.clientsTitle}</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy.clientsIntro}</p>
      {state.clients.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{copy.clientsEmpty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {state.clients.map((client) => (
            <li key={client.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-dark dark:text-gray-100 break-words">{client.name}</p>
                <p className="text-xs text-gray-500 break-all">{client.kind === 'cimd' ? copy.kindCimd : copy.kindRegistered} · {client.client_id}</p>
                <p className="text-xs text-gray-500">
                  {client.disabled_at
                    ? formatMessage(copy.disabledOn, { date: formatDate(client.disabled_at) })
                    : formatMessage(client.active_grants === 1 ? copy.activeConnectionsOne : copy.activeConnections, { count: client.active_grants })}
                </p>
              </div>
              {!client.disabled_at && (
                <button type="button" onClick={() => removeClient(client)} className={`${button} text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {copy.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {credentials && (
        <div className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4" role="alert">
          <p className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-100"><KeyRound className="h-4 w-4" aria-hidden="true" />{copy.secretTitle}</p>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">{copy.secretMessage}</p>
          <div className="mt-3 space-y-3">
            <CopyField label={copy.clientIdLabel} value={credentials.clientId} copy={copy} />
            <CopyField label={copy.clientSecretLabel} value={credentials.clientSecret} copy={copy} />
          </div>
          <button type="button" onClick={() => setCredentials(null)} className={`${button} mt-3 bg-dark text-white hover:bg-gray-800`}>{copy.secretDone}</button>
        </div>
      )}

      <form onSubmit={addClient} className="mt-6 space-y-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 p-4">
        <h4 className="font-semibold text-dark dark:text-gray-100">{copy.addTitle}</h4>
        <div>
          <label htmlFor="assistant-kind" className="text-sm font-medium text-gray-700 dark:text-gray-200">{copy.addKindLabel}</label>
          <select id="assistant-kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} className={`${input} mt-1`}>
            <option value="cimd">{copy.kindCimd}</option>
            <option value="registered">{copy.kindRegistered}</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">{form.kind === 'cimd' ? copy.addKindCimdHelp : copy.addKindRegisteredHelp}</p>
        </div>
        <div>
          <label htmlFor="assistant-name" className="text-sm font-medium text-gray-700 dark:text-gray-200">{copy.addNameLabel}</label>
          <input id="assistant-name" required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`${input} mt-1`} />
        </div>
        {form.kind === 'cimd' ? (
          <div>
            <label htmlFor="assistant-client-id" className="text-sm font-medium text-gray-700 dark:text-gray-200">{copy.addClientIdLabel}</label>
            <input id="assistant-client-id" type="url" required placeholder="https://" value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} className={`${input} mt-1`} />
          </div>
        ) : (
          <div>
            <label htmlFor="assistant-redirects" className="text-sm font-medium text-gray-700 dark:text-gray-200">{copy.addRedirectsLabel}</label>
            <textarea id="assistant-redirects" required rows={3} value={form.redirectUris} onChange={(event) => setForm({ ...form, redirectUris: event.target.value })} className={`${input} mt-1 font-mono`} />
          </div>
        )}
        <button type="submit" disabled={busy} className={`${button} bg-dark text-white hover:bg-gray-800`}>
          <Plug className="h-4 w-4" aria-hidden="true" />
          {copy.addSubmit}
        </button>
      </form>

      <div className="mt-8 rounded-2xl border border-red-100 dark:border-red-900/50 p-4">
        <h3 className="font-semibold text-red-700 dark:text-red-300">{copy.killTitle}</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{copy.killIntro}</p>
        <button type="button" onClick={killSwitch} className={`${button} mt-3 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30`}>
          <PowerOff className="h-4 w-4" aria-hidden="true" />
          {copy.killButton}
        </button>
      </div>
    </section>
  );
}

export default function Assistants() {
  const { user } = useAuthStore();
  const brandingLanguage = useBrandingLanguage();
  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const ui = getUiStrings(language);
  const copy = ui.assistants;
  const isOwner = user?.role === 'owner';
  const [enabled, setEnabled] = useState(null);
  const [connections, setConnections] = useState([]);
  const [notice, setNotice] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { open: confirm, dialogProps } = useConfirmDialog();

  const notify = useCallback((type, message) => setNotice({ type, message }), []);
  const formatDate = (value) => formatLocalDateTime(value, { locale: language, timeZone: user?.timeZone }) || value;

  const loadConnections = useCallback(async () => {
    const status = await api.get('/mcp/status');
    setEnabled(status.data.enabled);
    const res = await api.get('/mcp/connections');
    setConnections(res.data.connections);
  }, []);

  useEffect(() => {
    loadConnections().catch((err) => notify('error', apiErrorMessage(err, ui, copy.loadFailed)));
  }, [loadConnections, notify, ui, copy.loadFailed]);

  const disconnect = (connection) => confirm({
    title: formatMessage(copy.disconnectTitle, { name: connection.client_name }),
    message: copy.disconnectMessage,
    confirmLabel: copy.disconnect,
    onConfirm: async () => {
      try {
        await api.delete(`/mcp/connections/${encodeURIComponent(connection.id)}`);
        await loadConnections();
        setRefreshKey((value) => value + 1);
        notify('success', copy.disconnected);
      } catch (err) {
        notify('error', apiErrorMessage(err, ui, copy.loadFailed));
      }
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TopToastNotice notice={notice} onClose={() => setNotice(null)} closeLabel={ui.common.closeNotice} />
      <ConfirmDialog {...dialogProps} ui={ui} />

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-dark dark:text-gray-100">
          <Bot className="h-6 w-6 text-accent-dark dark:text-accent" aria-hidden="true" />
          {copy.pageTitle}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy.pageSubtitle}</p>
      </header>

      <section className={card} aria-labelledby="assistants-connections-title">
        <h2 id="assistants-connections-title" className="text-lg font-bold text-dark dark:text-gray-100">{copy.connectionsTitle}</h2>
        {enabled === false && connections.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{copy.connectionsDisabled}</p>
        ) : connections.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{copy.connectionsEmpty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {connections.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-dark dark:text-gray-100 break-words">{connection.client_name}</p>
                  <p className="text-xs text-gray-500">
                    {formatMessage(copy.connectedOn, { date: formatDate(connection.created_at) })}
                    {' · '}
                    {connection.last_used_at ? formatMessage(copy.lastUsed, { date: formatDate(connection.last_used_at) }) : copy.neverUsed}
                    {' · '}
                    {connection.scopes?.includes('frontdoor.preferences') ? copy.scopePreferences : copy.scopeReadOnly}
                  </p>
                </div>
                <button type="button" onClick={() => disconnect(connection)} className={`${button} border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-red-50 hover:text-red-600`}>
                  {copy.disconnect}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && (
        <OwnerPanel ui={ui} copy={copy} formatDate={formatDate} notify={notify} confirm={confirm} onEnabledChange={setEnabled} refreshKey={refreshKey} />
      )}
    </div>
  );
}
