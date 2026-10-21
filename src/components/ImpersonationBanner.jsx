import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { formatMessage } from '../i18n';
import TopToastNotice from './TopToastNotice';

// Persistent bar shown on every page while an admin acts as another user.
export default function ImpersonationBanner({ ui, timeZone }) {
  const {
    user, impersonation, impersonationEndedNotice, refreshSession, stopImpersonation, dismissImpersonationEndedNotice,
  } = useAuthStore();
  const navigate = useNavigate();
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const expiresAt = impersonation?.expiresAt;
  const endRedirected = useRef(false);

  // Ask the server again right after the expiry, so the bar goes away on time.
  // With clock skew the server may still report it active: keep asking every 5 s.
  useEffect(() => {
    if (!expiresAt) return undefined;
    let timer;
    let cancelled = false;
    const check = async () => {
      try {
        const data = await refreshSession();
        if (!cancelled && data?.impersonation) timer = setTimeout(check, 5000);
      } catch {
        // Network error: keep trying until unmount or until the session changes.
        if (!cancelled) timer = setTimeout(check, 5000);
      }
    };
    timer = setTimeout(check, Math.max(0, Date.parse(expiresAt) - Date.now()) + 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [expiresAt, refreshSession]);

  // The session ended on its own: leave the impersonated user's pages, as Stop does.
  // Latched so it fires once per end, not on every re-render while the notice is shown.
  useEffect(() => {
    if (impersonation) endRedirected.current = false;
    else if (impersonationEndedNotice && !endRedirected.current) {
      endRedirected.current = true;
      navigate('/admin/users', { replace: true });
    }
  }, [impersonation, impersonationEndedNotice, navigate]);

  const endedNotice = impersonationEndedNotice ? { type: 'info', message: ui.impersonation.ended } : null;
  const toast = (
    <TopToastNotice notice={endedNotice} onClose={dismissImpersonationEndedNotice} closeLabel={ui.common.closeNotice} duration={5000} />
  );
  if (!impersonation) return toast;

  const handleStop = async () => {
    const targetUserId = user?.id;
    setStopping(true);
    setStopFailed(false);
    try {
      await stopImpersonation();
      navigate('/admin/users', { state: { expandUserId: targetUserId } });
    } catch {
      setStopFailed(true);
    } finally {
      setStopping(false);
    }
  };

  const endsAt = new Intl.DateTimeFormat(ui.common.dateLocale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(expiresAt));

  return (
    <>
      {toast}
      <div className="sticky top-0 z-50 bg-amber-400 text-amber-950 dark:bg-amber-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span className="inline-flex items-center gap-2 min-w-0">
            <Eye className="w-4 h-4 shrink-0" />
            <span role="status" className="truncate">{formatMessage(ui.impersonation.banner, { name: user?.displayName || user?.email || '', time: endsAt })}</span>
          </span>
          <span className="inline-flex items-center gap-3">
            {stopFailed && <span role="status" className="text-xs">{ui.impersonation.stopFailed}</span>}
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="rounded-lg bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-950 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-400 dark:focus-visible:ring-offset-amber-500"
            >
              {stopping ? ui.impersonation.stopping : ui.impersonation.stop}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
