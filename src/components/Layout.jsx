import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUp, Activity, BookOpen, ChevronDown, Home, LogOut, Menu, Monitor, Moon, Palette, RotateCcw, Settings, Sparkles, Sun, Users, UserCog, X, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { DEFAULT_COLOR_SCHEME, normalizeColorScheme, resolveAppColorScheme } from '../../shared/colorSchemes.js';
import BrandMark from './BrandMark';
import AppFooter from './AppFooter';
import UserAvatar from './UserAvatar';
import Tooltip from './Tooltip';
import api from '../services/api';
import { getSupportedLanguageOptions, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import PluginSurface from '../pluginHost/PluginSurface';
import { PLUGIN_SURFACES } from '../pluginHost/constants';
import {
  HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT,
  HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT,
  requestHomeTourHomepageDocs,
  requestHomeTourReplay,
} from '../utils/homeTour';

export default function Layout({ children }) {
  const {
    user,
    logout,
    updateHomeDesktopView,
    resetHomeDesktopView,
    updatePreferredLanguage,
    resetPreferredLanguage,
    updatePreferredColorScheme,
    resetPreferredColorScheme,
    resetAppOrder,
  } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [homeViewSaving, setHomeViewSaving] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [colorSchemeSaving, setColorSchemeSaving] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [defaultHomeDesktopView, setDefaultHomeDesktopView] = useState('cards');
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const [brandingColorScheme, setBrandingColorScheme] = useState(DEFAULT_COLOR_SCHEME);
  const [darkModeBetaEnabled, setDarkModeBetaEnabled] = useState(false);
  const [useEuropeanDateFormat, setUseEuropeanDateFormat] = useState(false);
  const [use24hTimeFormat, setUse24hTimeFormat] = useState(false);
  const [hideLoginPage, setHideLoginPage] = useState(false);
  const accountMenuRef = useRef(null);
  const role = user?.role;
  const canUseAdminPages = ['owner', 'admin', 'admin_readonly'].includes(role);
  const isOwner = role === 'owner';
  const showHomeNav = role !== 'user';
  const showLogoutAction = !hideLoginPage;

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  const handleTakeTour = () => {
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
    if (location.pathname !== '/') {
      navigate('/', { state: { replayHomeTour: true } });
      return;
    }
    requestHomeTourReplay();
  };

  const handleOpenHomepageGuide = () => {
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
    if (location.pathname !== '/') {
      navigate('/', { state: { openHomeTourHomepageDocs: true } });
      return;
    }
    requestHomeTourHomepageDocs();
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement
        && activeElement !== document.body
        && activeElement !== document.documentElement
      ) {
        activeElement.blur();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (!isShortcut) return;

      const activeElement = document.activeElement;
      const isTypingField = activeElement && (
        activeElement.tagName === 'INPUT'
        || activeElement.tagName === 'TEXTAREA'
        || activeElement.tagName === 'SELECT'
        || activeElement.isContentEditable
      );

      const targets = Array.from(document.querySelectorAll('[data-frontdoor-search-target="primary"]'));
      const target = [...targets].reverse().find((element) => (
        element instanceof HTMLElement && element.getClientRects().length > 0
      ));
      if (!(target instanceof HTMLElement)) return;

      if (isTypingField && activeElement === target) {
        return;
      }

      event.preventDefault();
      target.focus();
      if (typeof target.select === 'function') {
        target.select();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (!cancelled) {
          setDefaultHomeDesktopView(res.data?.branding?.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards');
          setBrandingLanguage(normalizeLanguage(res.data?.branding?.defaultLanguage));
          setBrandingColorScheme(normalizeColorScheme(res.data?.branding?.defaultColorScheme));
          setDarkModeBetaEnabled(res.data?.branding?.enableDarkModeBeta === true);
          setUseEuropeanDateFormat(res.data?.branding?.useEuropeanDateFormat === true);
          setUse24hTimeFormat(res.data?.branding?.use24hTimeFormat === true);
          setHideLoginPage(res.data?.branding?.hideLoginPage === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDefaultHomeDesktopView('cards');
          setBrandingLanguage('en');
          setBrandingColorScheme(DEFAULT_COLOR_SCHEME);
          setDarkModeBetaEnabled(false);
          setUseEuropeanDateFormat(false);
          setUse24hTimeFormat(false);
          setHideLoginPage(false);
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
      setBrandingColorScheme(normalizeColorScheme(event.detail?.defaultColorScheme));
      setDarkModeBetaEnabled(event.detail?.enableDarkModeBeta === true);
      setUseEuropeanDateFormat(event.detail?.useEuropeanDateFormat === true);
      setUse24hTimeFormat(event.detail?.use24hTimeFormat === true);
      setHideLoginPage(event.detail?.hideLoginPage === true);
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

  useEffect(() => {
    const openAccountMenuForTour = () => {
      setMobileMenuOpen(false);
      setAccountMenuOpen(true);
    };
    const closeAccountMenuForTour = () => {
      setAccountMenuOpen(false);
    };

    window.addEventListener(HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT, openAccountMenuForTour);
    window.addEventListener(HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT, closeAccountMenuForTour);
    return () => {
      window.removeEventListener(HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT, openAccountMenuForTour);
      window.removeEventListener(HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT, closeAccountMenuForTour);
    };
  }, []);

  const navLinkClass = (path) => `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    location.pathname === path
      ? 'bg-accent/20 text-dark dark:text-gray-100'
      : 'text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800'
  }`;

  const mobileNavIconClass = (path) => `inline-flex shrink-0 items-center justify-center rounded-2xl border p-2.5 transition-colors ${
    location.pathname === path
      ? 'border-accent bg-accent/20 text-dark dark:text-gray-100'
      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white'
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
    if (homeViewSaving) return;
    if (nextView === defaultHomeDesktopView) {
      if (user?.homeDesktopView == null) return;
      setHomeViewSaving(true);
      try {
        await resetHomeDesktopView();
      } finally {
        setHomeViewSaving(false);
      }
      return;
    }
    if (user?.homeDesktopView === nextView) return;
    setHomeViewSaving(true);
    try {
      await updateHomeDesktopView(nextView);
    } finally {
      setHomeViewSaving(false);
    }
  };

  const handleResetHomeView = async () => {
    if (homeViewSaving || user?.homeDesktopView == null) return;
    setHomeViewSaving(true);
    try {
      await resetHomeDesktopView();
    } finally {
      setHomeViewSaving(false);
    }
  };

  const handlePreferredLanguageChange = async (nextLanguage) => {
    if (languageSaving) return;
    if (nextLanguage === brandingLanguage) {
      if (user?.preferredLanguage == null) return;
      setLanguageSaving(true);
      try {
        await resetPreferredLanguage();
      } finally {
        setLanguageSaving(false);
      }
      return;
    }
    if (user?.preferredLanguage === nextLanguage) return;
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

  const handlePreferredColorSchemeChange = async (nextScheme) => {
    if (colorSchemeSaving) return;
    if (nextScheme === brandingColorScheme) {
      if (user?.preferredColorScheme == null) return;
      setColorSchemeSaving(true);
      try {
        await resetPreferredColorScheme();
      } finally {
        setColorSchemeSaving(false);
      }
      return;
    }
    if (user?.preferredColorScheme === nextScheme) return;
    setColorSchemeSaving(true);
    try {
      await updatePreferredColorScheme(nextScheme);
    } finally {
      setColorSchemeSaving(false);
    }
  };

  const handleResetPreferredColorScheme = async () => {
    if (colorSchemeSaving || user?.preferredColorScheme == null) return;
    setColorSchemeSaving(true);
    try {
      await resetPreferredColorScheme();
    } finally {
      setColorSchemeSaving(false);
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
  const hasHomeViewOverride = user?.homeDesktopView != null && user.homeDesktopView !== defaultHomeDesktopView;
  const effectiveLanguage = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const hasPreferredLanguageOverride = user?.preferredLanguage != null
    && normalizeLanguage(user.preferredLanguage) !== normalizeLanguage(brandingLanguage);
  const effectiveColorScheme = resolveAppColorScheme(user?.preferredColorScheme, brandingColorScheme);
  const hasColorSchemeOverride = user?.preferredColorScheme != null
    && normalizeColorScheme(user.preferredColorScheme) !== normalizeColorScheme(brandingColorScheme);
  const hasAppOrderOverride = Array.isArray(user?.appOrder) && user.appOrder.length > 0;
  const appOrderSavedLabel = hasAppOrderOverride
    ? formatOrderTimestamp(user.appOrderUpdatedAt)
    : null;
  const ui = getUiStrings(effectiveLanguage);
  const languageOptions = getSupportedLanguageOptions(ui);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-gray-950">
      <nav className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 shadow-sm shadow-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-3 gap-4">
            <Link to="/" className="flex items-center gap-3 shrink-0">
              <BrandMark />
              <span className="font-bold text-lg text-dark dark:text-gray-100">Frontdoor</span>
            </Link>

            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((value) => !value)}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white"
                aria-label={ui.common.openMenu}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>

            <div className="hidden md:flex items-center gap-2 min-w-0">
              {showHomeNav && (
                <Link to="/" className={navLinkClass('/')}>
                  <Home className="w-4 h-4" />
                  {ui.nav.home}
                </Link>
              )}

              {canUseAdminPages && (
                <>
                  <Link to="/admin" className={navLinkClass('/admin')}>
                    <Settings className="w-4 h-4" />
                    {ui.nav.apps}
                  </Link>
                  <Link to="/admin/users" className={navLinkClass('/admin/users')}>
                    <UserCog className="w-4 h-4" />
                    {ui.nav.users}
                  </Link>
                  <Link to="/admin/groups" className={navLinkClass('/admin/groups')}>
                    <Users className="w-4 h-4" />
                    {ui.nav.groups}
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

              <PluginSurface surface={PLUGIN_SURFACES.LAYOUT_NAV_DESKTOP} variant="nav" />

              <div ref={accountMenuRef} className="relative ml-3 pl-3 border-l border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((value) => !value)}
                  id="frontdoor-account-menu-button"
                  className="flex items-center gap-2 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
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
                  <span className="text-sm text-gray-600 dark:text-gray-300 hidden lg:block max-w-[140px] truncate">
                    {user?.displayName}
                  </span>
                  <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 hidden lg:block" />
                </button>

                {accountMenuOpen && (
                  <div
                    id="frontdoor-account-menu-panel"
                    className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-2 shadow-xl shadow-black/10"
                  >
                    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                      <p className="text-sm font-semibold text-dark dark:text-gray-100">{user?.displayName}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user?.email}</p>
                    </div>
                    <div className="px-1 py-2">
                      <div className="flex items-center justify-between gap-2 px-3 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          {ui.layout.personalHomeViewShort || ui.layout.personalHomeView}
                        </p>
                        {hasHomeViewOverride && (
                          <button
                            type="button"
                            onClick={handleResetHomeView}
                            disabled={homeViewSaving}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {ui.layout.restoreView}
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="sr-only" htmlFor="personal-home-view-select">{ui.layout.personalHomeView}</label>
                        <select
                          id="personal-home-view-select"
                          value={effectiveHomeView}
                          onChange={(event) => handleHomeViewChange(event.target.value)}
                          disabled={homeViewSaving}
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                        >
                          <option value="cards">{ui.layout.homeViewCards}</option>
                          <option value="compact">{ui.layout.homeViewCompact}</option>
                        </select>
                      </div>
                    </div>
                    <div className="px-1 py-2">
                      <div className="flex items-center justify-between gap-2 px-3 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          {ui.common.language}
                        </p>
                        {hasPreferredLanguageOverride && (
                          <button
                            type="button"
                            onClick={handleResetPreferredLanguage}
                            disabled={languageSaving}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {ui.layout.restoreLanguage}
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="sr-only" htmlFor="personal-language-select">{ui.common.language}</label>
                        <select
                          id="personal-language-select"
                          value={effectiveLanguage}
                          onChange={(event) => handlePreferredLanguageChange(event.target.value)}
                          disabled={languageSaving}
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                        >
                          {languageOptions.map((language) => (
                            <option key={language.code} value={language.code}>{language.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {darkModeBetaEnabled && (
                    <div className="px-1 py-2">
                      <div className="flex items-center justify-between gap-2 px-3 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          {ui.layout.colorScheme}
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950/55 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            {ui.layout.beta}
                          </span>
                        </p>
                        {hasColorSchemeOverride && (
                          <button
                            type="button"
                            onClick={handleResetPreferredColorScheme}
                            disabled={colorSchemeSaving}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {ui.layout.restoreColorScheme}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1 px-1">
                        {[
                          { code: 'light', Icon: Sun, label: ui.layout.colorSchemeLight },
                          { code: 'dark', Icon: Moon, label: ui.layout.colorSchemeDark },
                          { code: 'auto', Icon: Monitor, label: ui.layout.colorSchemeAuto },
                        ].map(({ code, Icon, label }) => {
                          const active = effectiveColorScheme === code;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => handlePreferredColorSchemeChange(code)}
                              disabled={colorSchemeSaving}
                              className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                                active
                                  ? 'border-accent bg-accent/20 text-dark dark:text-gray-100'
                                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-dark dark:hover:text-white'
                              }`}
                              aria-pressed={active}
                            >
                              <Icon className="h-4 w-4" />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}
                    {hasAppOrderOverride && (
                      <>
                        <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
                        <div className="px-1 py-2">
                          <div className="flex items-center justify-between gap-2 px-3 pb-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                              {ui.layout.appOrder}
                            </p>
                            <button
                              type="button"
                              onClick={handleResetAppOrder}
                              disabled={appOrderResetting}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
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
                    <PluginSurface
                      surface={PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU}
                      variant="menu"
                      className="px-1 py-1"
                    />
                    <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
                    <button
                      type="button"
                      onClick={handleOpenHomepageGuide}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-accent/10 hover:text-dark dark:hover:text-white"
                    >
                      <BookOpen className="w-4 h-4" />
                      {ui.layout.openHomepageGuide}
                    </button>
                    <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
                    <button
                      type="button"
                      onClick={handleTakeTour}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-accent/10 hover:text-dark dark:hover:text-white"
                    >
                      <Sparkles className="w-4 h-4" />
                      {ui.layout.takeTour}
                    </button>
                    <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
                    {showLogoutAction && (
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <LogOut className="w-4 h-4" />
                        {ui.nav.logout}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="max-w-7xl mx-auto px-4 py-4 max-h-[calc(100vh-4.5rem)] overflow-y-auto overscroll-contain space-y-3">
              <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {showHomeNav && (
                  <Tooltip content={ui.nav.home}>
                    <Link to="/" className={mobileNavIconClass('/')} aria-label={ui.nav.home}>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                        <Home className="w-4 h-4" />
                      </div>
                      <span className="sr-only">{ui.nav.home}</span>
                    </Link>
                  </Tooltip>
                )}

                {canUseAdminPages && (
                  <>
                    <Tooltip content={ui.nav.apps}>
                      <Link to="/admin" className={mobileNavIconClass('/admin')} aria-label={ui.nav.apps}>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                          <Settings className="w-4 h-4" />
                        </div>
                        <span className="sr-only">{ui.nav.apps}</span>
                      </Link>
                    </Tooltip>
                    <Tooltip content={ui.nav.users}>
                      <Link to="/admin/users" className={mobileNavIconClass('/admin/users')} aria-label={ui.nav.users}>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                          <UserCog className="w-4 h-4" />
                        </div>
                        <span className="sr-only">{ui.nav.users}</span>
                      </Link>
                    </Tooltip>
                    <Tooltip content={ui.nav.groups}>
                      <Link to="/admin/groups" className={mobileNavIconClass('/admin/groups')} aria-label={ui.nav.groups}>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                          <Users className="w-4 h-4" />
                        </div>
                        <span className="sr-only">{ui.nav.groups}</span>
                      </Link>
                    </Tooltip>
                    {isOwner && (
                      <Tooltip content={ui.nav.logs}>
                        <Link to="/admin/logs" className={mobileNavIconClass('/admin/logs')} aria-label={ui.nav.logs}>
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                            <Activity className="w-4 h-4" />
                          </div>
                          <span className="sr-only">{ui.nav.logs}</span>
                        </Link>
                      </Tooltip>
                    )}
                    {isOwner && (
                      <Tooltip content={ui.nav.audit}>
                        <Link to="/admin/audit" className={mobileNavIconClass('/admin/audit')} aria-label={ui.nav.audit}>
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                          <span className="sr-only">{ui.nav.audit}</span>
                        </Link>
                      </Tooltip>
                    )}
                    {isOwner && (
                      <Tooltip content={ui.nav.customize}>
                        <Link to="/admin/customization" className={mobileNavIconClass('/admin/customization')} aria-label={ui.nav.customize}>
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white dark:bg-gray-900">
                            <Palette className="w-4 h-4" />
                          </div>
                          <span className="sr-only">{ui.nav.customize}</span>
                        </Link>
                      </Tooltip>
                    )}
                  </>
                )}

                <PluginSurface surface={PLUGIN_SURFACES.LAYOUT_NAV_MOBILE} variant="mobile-nav" />
              </div>

              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/70 px-3 py-3">
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
                      <p className="text-sm font-medium text-dark dark:text-gray-100 truncate">{user?.displayName}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user?.email}</p>
                    </div>
                  </div>
                  {showLogoutAction && (
                    <button
                      onClick={handleLogout}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <LogOut className="w-4 h-4" />
                      {ui.nav.logout}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleTakeTour}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-accent/10 hover:text-dark dark:hover:text-white"
                >
                  <Sparkles className="w-4 h-4" />
                  {ui.layout.takeTour}
                </button>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {ui.layout.personalHomeViewShort || ui.layout.personalHomeView}
                  </p>
                  <label className="sr-only" htmlFor="mobile-personal-home-view-select">{ui.layout.personalHomeView}</label>
                  <select
                    id="mobile-personal-home-view-select"
                    value={effectiveHomeView}
                    onChange={(event) => handleHomeViewChange(event.target.value)}
                    disabled={homeViewSaving}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                  >
                    <option value="cards">{ui.layout.homeViewCards}</option>
                    <option value="compact">{ui.layout.homeViewCompact}</option>
                  </select>
                  {hasHomeViewOverride && (
                    <button
                      type="button"
                      onClick={handleResetHomeView}
                      disabled={homeViewSaving}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {ui.layout.restoreView}
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {ui.common.language}
                  </p>
                  <label className="sr-only" htmlFor="mobile-personal-language-select">{ui.common.language}</label>
                  <select
                    id="mobile-personal-language-select"
                    value={effectiveLanguage}
                    onChange={(event) => handlePreferredLanguageChange(event.target.value)}
                    disabled={languageSaving}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                  >
                    {languageOptions.map((language) => (
                      <option key={language.code} value={language.code}>{language.label}</option>
                    ))}
                  </select>
                  {hasPreferredLanguageOverride && (
                    <button
                      type="button"
                      onClick={handleResetPreferredLanguage}
                      disabled={languageSaving}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {ui.layout.restoreLanguage}
                    </button>
                  )}
                </div>

                {darkModeBetaEnabled && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      {ui.layout.colorScheme}
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950/55 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        {ui.layout.beta}
                      </span>
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { code: 'light', Icon: Sun, label: ui.layout.colorSchemeLight },
                        { code: 'dark', Icon: Moon, label: ui.layout.colorSchemeDark },
                        { code: 'auto', Icon: Monitor, label: ui.layout.colorSchemeAuto },
                      ].map(({ code, Icon, label }) => {
                        const active = effectiveColorScheme === code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => handlePreferredColorSchemeChange(code)}
                            disabled={colorSchemeSaving}
                            className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                              active
                                ? 'border-accent bg-accent/20 text-dark dark:text-gray-100'
                                : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-dark dark:hover:text-white'
                            }`}
                            aria-pressed={active}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {hasColorSchemeOverride && (
                      <button
                        type="button"
                        onClick={handleResetPreferredColorScheme}
                        disabled={colorSchemeSaving}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-60"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {ui.layout.restoreColorScheme}
                      </button>
                    )}
                  </div>
                )}
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
