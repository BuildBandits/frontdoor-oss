import { useEffect, useState } from 'react';
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

  // Ask the server again right after the expiry, so the bar goes away on time.
  useEffect(() => {
    if (!expiresAt) return undefined;
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now()) + 1000;
    const timer = setTimeout(() => { void refreshSession().catch(() => {}); }, delay);
    return () => clearTimeout(timer);
  }, [expiresAt, refreshSession]);

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
      <div role="status" className="sticky top-0 z-50 bg-amber-400 text-amber-950 dark:bg-amber-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span className="inline-flex items-center gap-2 min-w-0">
            <Eye className="w-4 h-4 shrink-0" />
            <span className="truncate">{formatMessage(ui.impersonation.banner, { name: user?.displayName || user?.email || '', time: endsAt })}</span>
          </span>
          <span className="inline-flex items-center gap-3">
            {stopFailed && <span className="text-xs">{ui.impersonation.stopFailed}</span>}
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="rounded-lg bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
            >
              {stopping ? ui.impersonation.stopping : ui.impersonation.stop}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
