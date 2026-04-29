import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUp, Activity, Check, ChevronDown, Globe, Home, LogOut, Menu, Palette, RotateCcw, Settings, Users, UserCog, X, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import BrandMark from './BrandMark';
import AppFooter from './AppFooter';
import UserAvatar from './UserAvatar';
import api from '../services/api';
import { getSupportedLanguageOptions, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

export default function Layout({ children }) {
  const {
    user,
    logout,
    updateHomeDesktopView,
    resetHomeDesktopView,
    updatePreferredLanguage,
    resetPreferredLanguage,
    resetAppOrder,
  } = useAuthStore();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [homeViewSaving, setHomeViewSaving] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [defaultHomeDesktopView, setDefaultHomeDesktopView] = useState('cards');
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const [useEuropeanDateFormat, setUseEuropeanDateFormat] = useState(false);
  const [use24hTimeFormat, setUse24hTimeFormat] = useState(false);
  const accountMenuRef = useRef(null);
  const role = user?.role;
  const canUseAdminPages = ['owner', 'admin', 'admin_readonly'].includes(role);
  const isOwner = role === 'owner';

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (!cancelled) {
          setDefaultHomeDesktopView(res.data?.branding?.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards');
          setBrandingLanguage(normalizeLanguage(res.data?.branding?.defaultLanguage));
          setUseEuropeanDateFormat(res.data?.branding?.useEuropeanDateFormat === true);
          setUse24hTimeFormat(res.data?.branding?.use24hTimeFormat === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDefaultHomeDesktopView('cards');
          setBrandingLanguage('en');
          setUseEuropeanDateFormat(false);
          setUse24hTimeFormat(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onBrandingUpdated = (event) => {
      setDefaultHomeDesktopView(event.detail?.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards');
      setBrandingLanguage(normalizeLanguage(event.detail?.defaultLanguage));
      setUseEuropeanDateFormat(event.detail?.useEuropeanDateFormat === true);
      setUse24hTimeFormat(event.detail?.use24hTimeFormat === true);
    };
    window.addEventListener('frontdoor:branding-updated', onBrandingUpdated);
    return () => window.removeEventListener('frontdoor:branding-updated', onBrandingUpdated);
  }, []);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 320);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const onMouseDown = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [accountMenuOpen]);

  const navLinkClass = (path) => `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    location.pathname === path
      ? 'bg-accent/20 text-dark'
      : 'text-gray-500 hover:text-dark hover:bg-gray-50'
  }`;

  const mobileNavLinkClass = (path) => `flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
    location.pathname === path
      ? 'bg-accent/20 text-dark'
      : 'text-gray-600 hover:text-dark hover:bg-gray-50'
  }`;

  const parseTimestamp = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value !== 'string') return new Date(value);
    if (/[zZ]$/.test(value) || /[+-]\d\d:\d\d$/.test(value)) {
      return new Date(value);
    }
    return new Date(`${value.replace(' ', 'T')}Z`);
  };

  const formatOrderTimestamp = (value) => {
    const parsed = parseTimestamp(value);
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    const date = useEuropeanDateFormat
      ? `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getFullYear()).padStart(4, '0')}`
      : `${String(parsed.getFullYear()).padStart(4, '0')}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    const time = new Intl.DateTimeFormat(use24hTimeFormat ? 'it-IT' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !use24hTimeFormat,
    }).format(parsed);
    return `${date} ${effectiveLanguage === 'it' ? 'alle' : 'at'} ${time}`;
  };

  const handleHomeViewChange = async (nextView) => {
    if (homeViewSaving || user?.homeDesktopView === nextView) return;
    setHomeViewSaving(true);
    try {
      await updateHomeDesktopView(nextView);
      setAccountMenuOpen(false);
    } finally {
      setHomeViewSaving(false);
    }
  };

  const handleResetHomeView = async () => {
    if (homeViewSaving || user?.homeDesktopView == null) return;
    setHomeViewSaving(true);
    try {
      await resetHomeDesktopView();
      setAccountMenuOpen(false);
    } finally {
      setHomeViewSaving(false);
    }
  };

  const handlePreferredLanguageChange = async (nextLanguage) => {
    if (languageSaving || user?.preferredLanguage === nextLanguage) return;
    setLanguageSaving(true);
    try {
      await updatePreferredLanguage(nextLanguage);
    } finally {
      setLanguageSaving(false);
    }
  };

  const handleResetPreferredLanguage = async () => {
    if (languageSaving || user?.preferredLanguage == null) return;
    setLanguageSaving(true);
    try {
      await resetPreferredLanguage();
    } finally {
      setLanguageSaving(false);
    }
  };

  const [appOrderResetting, setAppOrderResetting] = useState(false);

  const handleResetAppOrder = async () => {
    if (appOrderResetting || !Array.isArray(user?.appOrder) || user.appOrder.length === 0) return;
    setAppOrderResetting(true);
    try {
      await resetAppOrder();
      setAccountMenuOpen(false);
    } finally {
      setAppOrderResetting(false);
    }
  };

  const effectiveHomeView = user?.homeDesktopView ?? defaultHomeDesktopView;
  const hasHomeViewOverride = user?.homeDesktopView != null;
  const effectiveLanguage = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const hasPreferredLanguageOverride = user?.preferredLanguage != null;
  const hasAppOrderOverride = Array.isArray(user?.appOrder) && user.appOrder.length > 0;
  const appOrderSavedLabel = hasAppOrderOverride
    ? formatOrderTimestamp(user.appOrderUpdatedAt)
    : null;
  const ui = getUiStrings(effectiveLanguage);
  const languageOptions = getSupportedLanguageOptions(ui);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA]">
      <nav className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm shadow-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-3 gap-4">
            <Link to="/" className="flex items-center gap-3 shrink-0">
              <BrandMark />
              <span className="font-bold text-lg text-dark">Frontdoor</span>
            </Link>

            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((value) => !value)}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 transition-colors hover:bg-gray-50 hover:text-dark"
                aria-label={ui.common.openMenu}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>

            <div className="hidden md:flex items-center gap-2 min-w-0">
              <Link to="/" className={navLinkClass('/')}>
                <Home className="w-4 h-4" />
                {ui.nav.home}
              </Link>

              {canUseAdminPages && (
                <>
                  <Link to="/admin" className={navLinkClass('/admin')}>
                    <Settings className="w-4 h-4" />
                    {ui.nav.apps}
                  </Link>
                  <Link to="/admin/groups" className={navLinkClass('/admin/groups')}>
                    <Users className="w-4 h-4" />
                    {ui.nav.groups}
                  </Link>
                  <Link to="/admin/users" className={navLinkClass('/admin/users')}>
                    <UserCog className="w-4 h-4" />
                    {ui.nav.users}
                  </Link>
                  {isOwner && (
                    <Link to="/admin/logs" className={navLinkClass('/admin/logs')}>
                      <Activity className="w-4 h-4" />
                      {ui.nav.logs}
                    </Link>
                  )}
                  {isOwner && (
                    <Link to="/admin/audit" className={navLinkClass('/admin/audit')}>
                      <ShieldCheck className="w-4 h-4" />
                      {ui.nav.audit}
                    </Link>
                  )}
                  {isOwner && (
                    <Link to="/admin/customization" className={navLinkClass('/admin/customization')}>
                      <Palette className="w-4 h-4" />
                      {ui.nav.customize}
                    </Link>
                  )}
                </>
              )}

              <div ref={accountMenuRef} className="relative ml-3 pl-3 border-l border-gray-100">
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((value) => !value)}
                  className="flex items-center gap-2 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-gray-50"
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                >
                  <UserAvatar
                    userId={user?.id}
                    displayName={user?.displayName}
                    email={user?.email}
                    avatarColor={user?.avatarColor}
                    className="w-8 h-8"
                    initialsClassName="text-[10px]"
                  />
                  <span className="text-sm text-gray-600 hidden lg:block max-w-[140px] truncate">
                    {user?.displayName}
                  </span>
                  <ChevronDown className="w-4 h-4 text-gray-400 hidden lg:block" />
                </button>

                {accountMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl shadow-black/10">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <p className="text-sm font-semibold text-dark">{user?.displayName}</p>
                      <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                    </div>
                    <div className="px-1 py-2">
                      <div className="flex items-center justify-between gap-2 px-3 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                          {ui.layout.personalHomeViewShort || ui.layout.personalHomeView}
                        </p>
                        {hasHomeViewOverride ? (
                          <button
                            type="button"
                            onClick={handleResetHomeView}
                            disabled={homeViewSaving}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-dark disabled:opacity-60"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {ui.layout.restoreView}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent-dark">
                            <Check className="h-3 w-3" />
                            {ui.layout.defaultView}
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl border border-accent/15 bg-accent/5 p-1">
                        <label className="sr-only" htmlFor="personal-home-view-select">{ui.layout.personalHomeView}</label>
                        <div className="relative">
                          <Home className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          <select
                            id="personal-home-view-select"
                            value={effectiveHomeView}
                            onChange={(event) => handleHomeViewChange(event.target.value)}
                            disabled={homeViewSaving}
                            className="w-full appearance-none rounded-lg border-0 bg-white/90 py-2 pl-9 pr-8 text-sm font-medium text-dark shadow-inner ring-1 ring-accent/20 transition disabled:opacity-60"
                          >
                            <option value="cards">{ui.layout.homeViewCards}</option>
                            <option value="compact">{ui.layout.homeViewCompact}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="px-1 py-2">
                      <div className="flex items-center justify-between gap-2 px-3 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                          {ui.common.language}
                        </p>
                        {hasPreferredLanguageOverride ? (
                          <button
                            type="button"
                            onClick={handleResetPreferredLanguage}
                            disabled={languageSaving}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-dark disabled:opacity-60"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {ui.layout.restoreLanguage}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent-dark">
                            <Check className="h-3 w-3" />
                            {ui.layout.defaultLanguage}
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl border border-accent/15 bg-accent/5 p-1">
                        <label className="sr-only" htmlFor="personal-language-select">{ui.common.language}</label>
                        <div className="relative">
                          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          <select
                            id="personal-language-select"
                            value={effectiveLanguage}
                            onChange={(event) => handlePreferredLanguageChange(event.target.value)}
                            disabled={languageSaving}
                            className="w-full appearance-none rounded-lg border-0 bg-white/90 py-2 pl-9 pr-8 text-sm font-medium text-dark shadow-inner ring-1 ring-accent/20 transition disabled:opacity-60"
                          >
                            {languageOptions.map((language) => (
                              <option key={language.code} value={language.code}>{language.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                    {hasAppOrderOverride && (
                      <>
                        <div className="my-1 h-px bg-gray-100" />
                        <div className="px-1 py-2">
                          <div className="flex items-center justify-between gap-2 px-3 pb-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                              {ui.layout.appOrder}
                            </p>
                            <button
                              type="button"
                              onClick={handleResetAppOrder}
                              disabled={appOrderResetting}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-dark disabled:opacity-60"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {ui.layout.restoreOrder}
                            </button>
                          </div>
                          {appOrderSavedLabel && (
                            <p className="mx-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                              {ui.layout.savedOrderOn.replace('{date}', appOrderSavedLabel)}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                    <div className="my-1 h-px bg-gray-100" />
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <LogOut className="w-4 h-4" />
                      {ui.nav.logout}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white">
            <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
              <Link to="/" className={mobileNavLinkClass('/')}>
                <Home className="w-4 h-4" />
                {ui.nav.home}
              </Link>

              {canUseAdminPages && (
                <>
                  <Link to="/admin" className={mobileNavLinkClass('/admin')}>
                    <Settings className="w-4 h-4" />
                    {ui.nav.apps}
                  </Link>
                  <Link to="/admin/groups" className={mobileNavLinkClass('/admin/groups')}>
                    <Users className="w-4 h-4" />
                    {ui.nav.groups}
                  </Link>
                  <Link to="/admin/users" className={mobileNavLinkClass('/admin/users')}>
                    <UserCog className="w-4 h-4" />
                    {ui.nav.users}
                  </Link>
                  {isOwner && (
                    <Link to="/admin/logs" className={mobileNavLinkClass('/admin/logs')}>
                      <Activity className="w-4 h-4" />
                      {ui.nav.logs}
                    </Link>
                  )}
                  {isOwner && (
                    <Link to="/admin/audit" className={mobileNavLinkClass('/admin/audit')}>
                      <ShieldCheck className="w-4 h-4" />
                      {ui.nav.audit}
                    </Link>
                  )}
                  {isOwner && (
                    <Link to="/admin/customization" className={mobileNavLinkClass('/admin/customization')}>
                      <Palette className="w-4 h-4" />
                      {ui.nav.customize}
                    </Link>
                  )}
                </>
              )}

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 px-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    userId={user?.id}
                    displayName={user?.displayName}
                    email={user?.email}
                    avatarColor={user?.avatarColor}
                    className="w-9 h-9"
                    initialsClassName="text-[10px]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-dark truncate">{user?.displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <LogOut className="w-4 h-4" />
                  {ui.nav.logout}
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      <AppFooter language={effectiveLanguage} />

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-dark px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/20 transition-transform hover:-translate-y-0.5 hover:bg-gray-800"
          aria-label={ui.common.backToTop}
        >
          <ArrowUp className="h-4 w-4" />
          {ui.common.backToTop}
        </button>
      )}
    </div>
  );
}
